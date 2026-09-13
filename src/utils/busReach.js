import { BUS_DATA } from '../data/busData.js';

const groupByStopId = new Map();
for (const group of BUS_DATA.groups) {
  for (const stopId of group.codes) {
    if (groupByStopId.has(stopId) && groupByStopId.get(stopId) !== group) {
      throw new Error(`Ambiguous stop group membership: ${stopId}`);
    }
    groupByStopId.set(stopId, group);
  }
}
const patternById = new Map(BUS_DATA.patterns.map(pattern => [pattern.id, pattern]));

function concreteStopIds(ids) {
  if (!Array.isArray(ids)) throw new TypeError('Expected an array of concrete stop IDs');
  for (const id of ids) {
    if (typeof id !== 'string' || !Object.hasOwn(BUS_DATA.by_code, id) || !groupByStopId.has(id)) {
      throw new RangeError(`Unknown concrete stop ID: ${String(id)}`);
    }
  }
  return [...new Set(ids)];
}

// Single-point selection includes registered siblings; explicit arrays never expand.
export function createOriginContext(stopIdOrIds) {
  if (Array.isArray(stopIdOrIds)) return { stopIds: concreteStopIds(stopIdOrIds) };
  const [stopId] = concreteStopIds([stopIdOrIds]);
  return { stopIds: concreteStopIds(groupByStopId.get(stopId).codes) };
}

function orderedTripVisits(line, pattern, trip) {
  const timedSeqs = new Set((trip.stop_times || []).map(row => row.seq));
  const lineStops = new Map(line.stops.map(stop => [stop.seq, stop.code]));
  const patternStops = new Map(pattern.stops.map(stop => [stop.seq, stop.code]));
  return (trip.visits || []).filter(visit =>
    groupByStopId.has(visit.stopId) && visit.sourceRows.length > 0 &&
    visit.sourceRows.every(seq => timedSeqs.has(seq) &&
      lineStops.get(seq) === visit.stopId && patternStops.get(seq) === visit.stopId)
  ).slice().sort((a, b) => a.sourceRows[0] - b.sourceRows[0]);
}

const connectionKey = c => JSON.stringify([c.line, c.patternId, c.tripId, c.boardVisitIndex, c.alightVisitIndex, c.boardStopId, c.alightStopId]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function reachableDestinations(originContext, { service } = {}) {
  if (!['E-R', 'L', 'P'].includes(service)) throw new RangeError('An explicit E-R, L or P service is required');
  const originIds = new Set(concreteStopIds(originContext?.stopIds));
  const originGroups = new Set([...originIds].map(id => groupByStopId.get(id)));
  const destinations = new Map();

  for (const line of BUS_DATA.lines) {
    if (line.service !== service || BUS_DATA.coverage?.[line.line]?.[service] === 'NO_SERVICE') continue;
    const pattern = patternById.get(line.pattern_id);
    if (!pattern || pattern.line !== line.line || pattern.coverage?.service_status?.[service] === 'NO_SERVICE') continue;
    for (const trip of line.trips) {
      if (trip.dayType && trip.dayType !== service) continue;
      const visits = orderedTripVisits(line, pattern, trip);
      for (let boardIndex = 0; boardIndex < visits.length - 1; boardIndex++) {
        const board = visits[boardIndex];
        if (!originIds.has(board.stopId)) continue;
        for (const alight of visits.slice(boardIndex + 1)) {
          const group = groupByStopId.get(alight.stopId);
          if (originGroups.has(group)) continue;
          // Group only after a concrete, downstream, same-trip pair has been established.
          if (!destinations.has(group)) destinations.set(group, { stopIds: new Set(), lines: new Set(), connections: new Map() });
          const result = destinations.get(group);
          const connection = { line: line.line, patternId: pattern.id, tripId: trip.id,
            boardStopId: board.stopId, alightStopId: alight.stopId,
            boardVisitIndex: board.visitIndex, alightVisitIndex: alight.visitIndex };
          result.stopIds.add(alight.stopId);
          result.lines.add(line.line);
          result.connections.set(connectionKey(connection), connection);
        }
      }
    }
  }
  return [...destinations].map(([group, result]) => ({
    name: group.name,
    stopIds: [...result.stopIds].sort(compare),
    lines: [...result.lines].sort(compare),
    connections: [...result.connections].sort(([a], [b]) => compare(a, b)).map(([, connection]) => connection),
  })).sort((a, b) => a.name.localeCompare(b.name, 'et') || compare(a.stopIds.join(','), b.stopIds.join(',')));
}

const isTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const directTripKey = route => JSON.stringify([route.line, route.patternId, route.tripId]);

function timedTripVisits(line, pattern, trip) {
  const times = new Map(trip.stop_times.map(row => [row.seq, row.time]));
  // Published arrival/departure metadata must agree with the literal source cells.
  return orderedTripVisits(line, pattern, trip).filter(visit =>
    Number.isInteger(visit.visitIndex) && visit.visitIndex >= 0 &&
    isTime(visit.arrival) && isTime(visit.departure) && visit.arrival <= visit.departure &&
    visit.arrival === times.get(visit.sourceRows[0]) &&
    visit.departure === times.get(visit.sourceRows.at(-1))
  );
}

// Same-day direct routes only: the caller supplies both service and clock snapshot.
export function findDirectRoutes(originContext, target, { service, now } = {}) {
  if (!['E-R', 'L', 'P'].includes(service)) throw new RangeError('An explicit E-R, L or P service is required');
  if (!isTime(now)) throw new RangeError('An explicit now in HH:MM (00:00-23:59) is required');
  const originIds = new Set(concreteStopIds(originContext?.stopIds));
  const targetIds = new Set(concreteStopIds(target?.stopIds));
  const originGroups = new Set([...originIds].map(id => groupByStopId.get(id)));
  const candidatesByTrip = new Map();

  for (const line of BUS_DATA.lines) {
    if (line.service !== service || BUS_DATA.coverage?.[line.line]?.[service] === 'NO_SERVICE') continue;
    const pattern = patternById.get(line.pattern_id);
    if (!pattern || pattern.line !== line.line || pattern.coverage?.service_status?.[service] === 'NO_SERVICE') continue;
    for (const trip of line.trips) {
      if (trip.dayType && trip.dayType !== service) continue;
      const visits = timedTripVisits(line, pattern, trip);
      for (let boardIndex = 0; boardIndex < visits.length - 1; boardIndex++) {
        const board = visits[boardIndex];
        if (!originIds.has(board.stopId) || board.isLast || board.hasLaterVisit === false || board.departure < now) continue;
        for (const alight of visits.slice(boardIndex + 1)) {
          if (!targetIds.has(alight.stopId) || originGroups.has(groupByStopId.get(alight.stopId)) ||
              alight.visitIndex <= board.visitIndex || alight.arrival < board.departure) continue;
          const route = {
            line: line.line, patternId: pattern.id, tripId: trip.id, tripNo: trip.no,
            boardStopId: board.stopId, boardVisitIndex: board.visitIndex, departure: board.departure,
            alightStopId: alight.stopId, alightVisitIndex: alight.visitIndex, arrival: alight.arrival,
            destinationName: BUS_DATA.by_code[alight.stopId].name,
          };
          const key = directTripKey(route);
          if (!candidatesByTrip.has(key)) candidatesByTrip.set(key, []);
          candidatesByTrip.get(key).push(route);
        }
      }
    }
  }

  // Keep all candidate pairs until selection so future boarding ranking has exact visit evidence.
  const routes = [...candidatesByTrip.values()].map(candidates => candidates.sort((a, b) =>
    a.boardVisitIndex - b.boardVisitIndex || compare(a.arrival, b.arrival) ||
    a.alightVisitIndex - b.alightVisitIndex
  )[0]);
  return routes.sort((a, b) => compare(a.arrival, b.arrival) || compare(a.departure, b.departure) ||
    compare(directTripKey(a), directTripKey(b)));
}
