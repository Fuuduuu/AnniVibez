import { BUS_DATA } from '../data/busData';

const STOP_POINTS = Object.entries(BUS_DATA.by_code || {})
  .map(([code, stop]) => ({
    code,
    name: stop?.name || '',
    lat: Number(stop?.lat),
    lon: Number(stop?.lon),
  }))
  .filter(p => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon));

const NAME_TO_CODES = STOP_POINTS.reduce((acc, p) => {
  if (!acc.has(p.name)) acc.set(p.name, []);
  acc.get(p.name).push(p.code);
  return acc;
}, new Map());

const NEARBY_NAME_PAIR = new Map([
  ['Õie', 'Tulika'],
  ['Tulika', 'Õie'],
]);

function hav(a, b, c, e) {
  const R = 6371000;
  const p = Math.PI / 180;
  const f =
    Math.sin(((c - a) * p) / 2) ** 2 +
    Math.cos(a * p) * Math.cos(c * p) * Math.sin(((e - b) * p) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(f));
}

function toStopChoice(point, dist) {
  const code = point.code;
  const name = point.name;
  return {
    code,
    stopId: code,
    name,
    groupName: name,
    lat: point.lat,
    lon: point.lon,
    dist: Math.round(dist),
    // Keep existing caller compatibility while preserving stopId routing.
    codes: [code],
    displayCodes: [...(NAME_TO_CODES.get(name) || [code])],
  };
}

export function wd() {
  const d = new Date().getDay();
  return d === 0 ? 'P' : d === 6 ? 'L' : 'E-R';
}

export function nearest(lat, lon) {
  const ranked = STOP_POINTS
    .map(p => ({ point: p, dist: hav(lat, lon, p.lat, p.lon) }))
    .sort((a, b) => a.dist - b.dist);

  const best = ranked[0];
  if (!best) return null;

  const byName = new Map();
  for (const entry of ranked) {
    const name = entry.point.name;
    if (!byName.has(name)) byName.set(name, entry);
  }

  const bestDist = best.dist;
  const eligible = [...byName.values()].filter(entry => entry.dist <= 500 && entry.dist - bestDist <= 450);

  const ordered = [];
  const seenNames = new Set();
  function pushEntry(entry) {
    const name = entry?.point?.name;
    if (!entry || !name || seenNames.has(name)) return;
    seenNames.add(name);
    ordered.push(entry);
  }

  pushEntry(best);
  const pairName = NEARBY_NAME_PAIR.get(best.point.name);
  if (pairName) {
    const pairEntry = eligible.find(entry => entry.point.name === pairName);
    pushEntry(pairEntry);
  }
  for (const entry of eligible) pushEntry(entry);

  const candidates = ordered
    .slice(0, 3)
    .map(entry => toStopChoice(entry.point, entry.dist));

  const primary = toStopChoice(best.point, best.dist);
  return {
    ...primary,
    candidates: candidates.length > 0 ? candidates : [primary],
  };
}

const PATTERN_BY_ID = new Map((BUS_DATA.patterns || []).map(p => [p.id, p]));

function nowHHMM(override) {
  if (typeof override === 'string' && /^\d{2}:\d{2}$/.test(override)) return override;
  const nowDate = new Date();
  return (
    String(nowDate.getHours()).padStart(2, '0') +
    ':' +
    String(nowDate.getMinutes()).padStart(2, '0')
  );
}

function uniq(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function resolveStopIds(input) {
  if (input == null) return [];
  if (Array.isArray(input)) return uniq(input.flatMap(resolveStopIds));

  if (typeof input === 'object') {
    if (Array.isArray(input.codes)) return resolveStopIds(input.codes);
    if (input.code) return resolveStopIds(String(input.code));
    if (input.stopId) return resolveStopIds(String(input.stopId));
    if (input.name) return resolveStopIds(String(input.name));
    return [];
  }

  const value = String(input).trim();
  if (!value) return [];

  if (BUS_DATA.by_code?.[value]) return [value];

  const group = BUS_DATA.groups?.find(g => g.name === value);
  if (group?.codes?.length) return uniq(group.codes);

  return uniq(NAME_TO_CODES.get(value) || []);
}

function hasDestinationValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function emptyReason({
  hasDestination,
  destinationCodes,
  originFound,
  patternFound,
  directionFound,
  service,
}) {
  if (hasDestination && destinationCodes.length === 0) return 'Valitud sihtkohta ei leitud';
  if (!originFound) return `Täna enam busse pole · ${service}`;
  if (hasDestination && !patternFound) return 'Valitud suunas sobivat liini ei leitud';
  if (hasDestination && !directionFound) return 'Valitud suunas sobivat liini ei leitud';
  if (hasDestination) return `Valitud suunas täna enam busse pole · ${service}`;
  return `Täna enam busse pole · ${service}`;
}

export function depsWithMeta(originInput, lim = 3, options = {}) {
  const originCodes = resolveStopIds(originInput);
  const destinationValue = options.destination;
  const hasDestination = hasDestinationValue(destinationValue);
  const destinationCodes = hasDestination ? resolveStopIds(destinationValue) : [];
  const service = options.service || wd();
  const now = nowHHMM(options.now);

  if (!originCodes.length) {
    return { departures: [], reason: 'Vali peatus, et näha väljumisi' };
  }

  const originSet = new Set(originCodes);
  const destinationSet = new Set(destinationCodes);

  const results = [];
  let originFound = false;
  let patternFound = false;
  let directionFound = false;

  for (const line of BUS_DATA.lines || []) {
    if (line.service !== service) continue;

    const stops = line.stops || [];
    const originStops = stops.filter(stop => originSet.has(stop.code));
    if (!originStops.length) continue;
    originFound = true;

    if (hasDestination && destinationCodes.length === 0) continue;

    const pattern = line.pattern_id ? PATTERN_BY_ID.get(line.pattern_id) : null;
    if (hasDestination && pattern?.stop_ids?.length) {
      const hasOriginInPattern = pattern.stop_ids.some(code => originSet.has(code));
      const hasDestinationInPattern = pattern.stop_ids.some(code => destinationSet.has(code));
      if (!hasOriginInPattern || !hasDestinationInPattern) continue;
    }

    const destinationStops = hasDestination
      ? stops.filter(stop => destinationSet.has(stop.code))
      : [];

    if (hasDestination && !destinationStops.length) continue;
    if (hasDestination) patternFound = true;

    const validOriginSeqs = new Set();
    if (!hasDestination) {
      for (const originStop of originStops) validOriginSeqs.add(originStop.seq);
    } else {
      for (const originStop of originStops) {
        for (const destinationStop of destinationStops) {
          if (destinationStop.seq > originStop.seq) {
            validOriginSeqs.add(originStop.seq);
          }
        }
      }
    }

    if (!validOriginSeqs.size) continue;
    if (hasDestination) directionFound = true;

    const stopBySeq = new Map(stops.map(stop => [stop.seq, stop]));
    for (const trip of line.trips || []) {
      const tripStopTimes = trip.stop_times || [];
      if (!tripStopTimes.length) continue;

      if (hasDestination) {
        const seqsInTrip = new Set(tripStopTimes.map(st => st.seq));
        let hasValidPair = false;
        for (const originSeq of validOriginSeqs) {
          if (!seqsInTrip.has(originSeq)) continue;
          for (const destinationStop of destinationStops) {
            if (destinationStop.seq > originSeq && seqsInTrip.has(destinationStop.seq)) {
              hasValidPair = true;
              break;
            }
          }
          if (hasValidPair) break;
        }
        if (!hasValidPair) continue;
      }

      for (const st of tripStopTimes) {
        if (!validOriginSeqs.has(st.seq) || st.time < now) continue;
        const stop = stopBySeq.get(st.seq);
        results.push({
          line: line.line,
          v: line.variant || '',
          dir: line.direction,
          time: st.time,
          originStopId: stop?.code || null,
        });
      }
    }
  }

  results.sort((a, b) => a.time.localeCompare(b.time));
  const seen = new Set();
  const departures = [];
  for (const r of results) {
    const key = `${r.line}|${r.v}|${r.time}`;
    if (!seen.has(key)) {
      seen.add(key);
      departures.push(r);
    }
    if (departures.length >= lim) break;
  }

  return {
    departures,
    reason:
      departures.length > 0
        ? ''
        : emptyReason({
            hasDestination,
            destinationCodes,
            originFound,
            patternFound,
            directionFound,
            service,
          }),
  };
}

export function deps(codes, lim = 3) {
  return depsWithMeta(codes, lim).departures;
}
