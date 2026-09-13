import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BUS_DATA } from '../../src/data/busData.js';

const moduleURL = new URL('../../src/utils/busReach.js', import.meta.url);
async function api(data) {
  const source = data && readFileSync(moduleURL, 'utf8').replace(
    "import { BUS_DATA } from '../data/busData.js';", `const BUS_DATA = ${JSON.stringify(data)};`);
  const core = await import(data ? `data:text/javascript;base64,${Buffer.from(source).toString('base64')}` : moduleURL.href);
  assert.equal(typeof core.findDirectRoutes, 'function', 'The direct-route API must be exported');
  return core;
}
const context = (...stopIds) => ({ stopIds });
const weekday = { service: 'E-R', now: '07:00' };
const OIE = context('5901010-1', '5901011-1');
const summary = r => [r.boardStopId, r.departure, r.alightStopId, r.arrival, r.destinationName];

test('Oie to Haigla: exact downstream point, times and trip/visit identity', async () => {
  const core = await api();
  const target = core.reachableDestinations(OIE, weekday).find(g => g.name === 'Haigla');
  const routes = core.findDirectRoutes(OIE, target, weekday);
  assert.deepEqual(summary(routes[0]), ['5901010-1', '07:22', '5900078-1', '07:35', 'Haigla']);
  assert.equal(routes[0].line, '3');
  assert.equal(routes[0].tripId, 'line3-er-koidula:reis_04');
  assert.equal(routes[0].tripNo, '04');
  assert.equal(routes[0].boardVisitIndex, 2);
  assert.equal(routes[0].alightVisitIndex, 10);
  assert.ok(routes.every(r => r.alightStopId !== '5900079-1'));
  assert.deepEqual(core.findDirectRoutes(OIE, context('5900079-1'), weekday), []);
});

test('Oie to Tammiku: opposite sibling boards at 07:05 and arrives at 07:08', async () => {
  const { findDirectRoutes } = await api();
  const routes = findDirectRoutes(OIE, context('5900777-1', '5900778-1'), weekday);
  assert.deepEqual(summary(routes[0]), ['5901011-1', '07:05', '5900777-1', '07:08', 'Tammiku']);
  assert.equal(routes[0].boardVisitIndex, 13);
  assert.equal(routes[0].alightVisitIndex, 14);
  assert.equal(routes[0].tripId, 'line3-er-keskvaljak:reis_01');
  assert.equal(routes[0].tripNo, '01');
});

test('Oie to Torma ranks 07:11 arrival ahead of the 07:43 long-way arrival', async () => {
  const { findDirectRoutes } = await api();
  const routes = findDirectRoutes(OIE, context('5900822-1', '5900823-1'), weekday);
  assert.deepEqual(summary(routes[0]), ['5901011-1', '07:05', '5900822-1', '07:11', 'T\u00f5rma kalmistu']);
  assert.deepEqual(summary(routes[1]), ['5901010-1', '07:22', '5900822-1', '07:43', 'T\u00f5rma kalmistu']);
});

test('G1: multi-group target labels never replace the actual matched alight identity', async () => {
  const { findDirectRoutes } = await api();
  const target = { name: 'P\u00f5hjakeskus', label: 'Map chip',
    stopIds: ['5900598-1', '5900079-1', '5900078-1'] };
  const routes = findDirectRoutes(OIE, target, weekday);
  assert.ok(routes.length > 0);
  assert.ok(routes.every(r => r.alightStopId === '5900078-1' && r.destinationName === 'Haigla'));
  assert.deepEqual(findDirectRoutes(OIE, { name: 'Haigla', stopIds: ['5900598-1'] }, weekday), []);
});

test('Line 2 return preserves all six real departures and arrivals, and no weekend service', async () => {
  const { findDirectRoutes } = await api();
  const origin = context('5900659-1');
  const target = context('5900565-1');
  const routes = findDirectRoutes(origin, target, { ...weekday, now: '00:00' });
  assert.deepEqual(routes.map(r => [r.departure, r.arrival]), [
    ['06:20', '06:40'], ['07:20', '07:40'], ['08:17', '08:37'],
    ['16:30', '16:50'], ['17:35', '17:55'], ['18:30', '18:50'],
  ]);
  assert.ok(routes.every(r => r.line === '2' && r.boardStopId === '5900659-1' &&
    r.alightStopId === '5900565-1' && r.destinationName === 'Piira'));
  for (const service of ['L', 'P']) assert.deepEqual(findDirectRoutes(origin, target, { service, now: '00:00' }), []);
});

test('Explicit now is inclusive, excludes expired boarding, and never consults the wall clock', async t => {
  const { findDirectRoutes } = await api();
  t.mock.method(globalThis, 'Date', class { constructor() { throw new Error('Wall clock forbidden'); } });
  const target = context('5900078-1');
  assert.equal(findDirectRoutes(OIE, target, { ...weekday, now: '07:22' })[0].departure, '07:22');
  assert.equal(findDirectRoutes(OIE, target, { ...weekday, now: '07:23' })[0].departure, '08:18');
  assert.deepEqual(findDirectRoutes(OIE, target, { ...weekday, now: '23:59' }), []);
});

function fixture(codes, trips) {
  const stops = codes.map((code, i) => ({ code, seq: i + 1 }));
  const ids = [...new Set(codes)];
  return {
    by_code: Object.fromEntries(ids.map(id => [id, { name: `Stop ${id}` }])),
    groups: ids.map(id => ({ name: `Group ${id}`, codes: [id] })),
    patterns: [{ id: 'p', line: 'X', stops }],
    coverage: { X: { 'E-R': 'SCHEDULED', L: 'NO_SERVICE', P: 'NO_SERVICE' } },
    lines: [{ line: 'X', service: 'E-R', pattern_id: 'p', stops,
      trips: trips.map(([id, times], index) => ({
        id, no: String(index + 1), dayType: 'E-R',
        stop_times: times.flatMap((time, i) => time == null ? [] : [{ seq: i + 1, time }]),
        visits: times.flatMap((time, i) => time == null ? [] : [{
          visitIndex: i, stopId: codes[i], sourceRows: [i + 1], arrival: time, departure: time,
          isLast: i === times.length - 1, hasLaterVisit: i < times.length - 1,
        }]),
      })),
    }],
  };
}

test('Ring ranking prefers a later departure with earlier arrival; repeated alights use the first match', async () => {
  const core = await api(fixture(['A', 'B', 'C', 'B', 'A'], [
    ['slow-ring', ['08:00', '08:50', '08:55', '09:00', '09:10']],
    ['fast', ['08:05', '08:15', '08:20', '08:25', '08:30']],
  ]));
  const routes = core.findDirectRoutes(context('A'), context('B'), weekday);
  assert.deepEqual(routes.map(r => [r.tripId, r.departure, r.arrival, r.alightVisitIndex]), [
    ['fast', '08:05', '08:15', 1], ['slow-ring', '08:00', '08:50', 1],
  ]);
  assert.deepEqual(core.findDirectRoutes(context('A'), context('A'), weekday), []);
});

test('One physical trip selects its earliest valid boarding occurrence, independent of input order', async () => {
  const data = fixture(['A', 'B', 'A', 'C', 'A'], [['trip', ['08:00', '08:05', '08:10', '08:15', '08:20']]]);
  const core = await api(data);
  const target = context('C');
  const routes = core.findDirectRoutes(context('B', 'A', 'A'), target, weekday);
  assert.equal(routes.length, 1);
  assert.deepEqual(summary(routes[0]), ['A', '08:00', 'C', '08:15', 'Stop C']);
  assert.equal(routes[0].boardVisitIndex, 0);
  assert.deepEqual(routes, core.findDirectRoutes(context('A', 'B'), target, weekday));
  const later = core.findDirectRoutes(context('A', 'B'), target, { ...weekday, now: '08:06' });
  assert.equal(later.length, 1);
  assert.equal(later[0].boardVisitIndex, 2);
  assert.equal(later[0].departure, '08:10');
  assert.deepEqual(core.findDirectRoutes(context('A'), context('B'), { ...weekday, now: '08:06' }), []);
  assert.deepEqual(core.findDirectRoutes(context('A'), target, { ...weekday, now: '08:16' }), []);
});

test('Trip identity dedupes repeated input records, not distinct trips with equal times', async () => {
  const data = fixture(['A', 'B'], [
    ['z', ['08:00', '08:10']], ['a', ['08:00', '08:10']], ['earlier', ['07:59', '08:10']],
  ]);
  data.lines.push(structuredClone(data.lines[0]));
  const core = await api(data);
  assert.deepEqual(core.findDirectRoutes(context('A'), context('B'), weekday).map(r => r.tripId), ['earlier', 'a', 'z']);
  data.lines.reverse();
  data.lines.forEach(line => line.trips.reverse());
  const reordered = await api(data);
  assert.deepEqual(reordered.findDirectRoutes(context('A'), context('B'), weekday),
    core.findDirectRoutes(context('A'), context('B'), weekday));
});

test('Multi-row visits board at departure and alight at arrival, never layover/terminal departure', async () => {
  const data = fixture(['A', 'A', 'B', 'B'], [['trip', ['08:00', '08:03', '08:10', '08:12']]]);
  data.lines[0].trips[0].visits = [
    { visitIndex: 0, stopId: 'A', sourceRows: [1, 2], arrival: '08:00', departure: '08:03', hasLaterVisit: true, isLast: false },
    { visitIndex: 1, stopId: 'B', sourceRows: [3, 4], arrival: '08:10', departure: '08:12', hasLaterVisit: false, isLast: true },
  ];
  const core = await api(data);
  assert.deepEqual(core.findDirectRoutes(context('A'), context('B'), { ...weekday, now: '08:02' }).map(summary),
    [['A', '08:03', 'B', '08:10', 'Stop B']]);
  assert.deepEqual(core.findDirectRoutes(context('A'), context('B'), { ...weekday, now: '08:04' }), []);
  assert.deepEqual(core.findDirectRoutes(context('B'), context('A'), weekday), []);
});

test('Piira loop and sibling Torma terminal cannot become loop-back destinations or boarding events', async () => {
  const { findDirectRoutes, createOriginContext } = await api();
  assert.deepEqual(findDirectRoutes(createOriginContext('5900565-1'), context('5900565-1'), weekday), []);
  assert.deepEqual(findDirectRoutes(createOriginContext('5900823-1'), context('5900822-1'), weekday), []);
  assert.deepEqual(findDirectRoutes(context('5900822-1'), context('5901011-1'), weekday), []);
  const line = BUS_DATA.lines.find(l => l.line === '1' && l.service === 'E-R');
  const core = await api({ ...BUS_DATA, lines: [{ ...line, trips: [line.trips[0]] }] });
  const routes = core.findDirectRoutes(context('5900565-1'), context('5900382-1'), { ...weekday, now: '06:20' });
  assert.deepEqual(routes.map(summary), [['5900565-1', '06:20', '5900382-1', '06:22', 'Palermo']]);
  assert.deepEqual(core.findDirectRoutes(context('5900565-1'), context('5900382-1'), { ...weekday, now: '06:21' }), []);
});

test('Exact IDs constrain routes: no implicit sibling expansion, name routing or displayCodes', async () => {
  const { findDirectRoutes } = await api();
  assert.deepEqual(findDirectRoutes({ ...context('5901011-1'), displayCodes: ['5901010-1'] }, context('5900078-1'), weekday), []);
  assert.deepEqual(findDirectRoutes(OIE, { ...context('5900079-1'), name: 'Haigla' }, weekday), []);
  assert.throws(() => findDirectRoutes(OIE, { name: 'Haigla' }, weekday), /stop|array/i);
  const data = fixture(['A', 'B'], [['t', ['08:00', '08:05']]]);
  data.groups.forEach(g => { g.name = 'Same text'; });
  const core = await api(data);
  assert.equal(core.findDirectRoutes(context('A'), context('B'), weekday)[0].destinationName, 'Stop B');
});

test('Missing trip visits and conflicting pattern/service/timetable evidence cannot invent a route', async () => {
  const base = fixture(['A', 'B', 'C'], [['t', ['08:00', '08:05', '08:10']]]);
  const mutations = [
    d => { d.lines[0].trips[0].stop_times = [{ seq: 1, time: '08:00' }]; },
    d => { d.lines[0].trips[0].visits = []; },
    d => { d.patterns[0].stops = d.patterns[0].stops.filter(s => s.code !== 'C'); },
    d => { d.patterns[0].line = 'other'; },
    d => { d.coverage.X['E-R'] = 'NO_SERVICE'; },
    d => { d.patterns[0].coverage = { service_status: { 'E-R': 'NO_SERVICE' } }; },
    d => { d.lines[0].trips[0].dayType = 'L'; },
    d => { d.lines[0].trips[0].visits[0].isLast = true; },
    d => { d.lines[0].trips[0].visits[0].hasLaterVisit = false; },
    d => { d.lines[0].trips[0].visits[2].arrival = '07:59'; },
  ];
  for (const mutate of mutations) {
    const data = structuredClone(base);
    mutate(data);
    const core = await api(data);
    assert.deepEqual(core.findDirectRoutes(context('A'), context('C'), weekday), []);
  }
  const split = fixture(['A', 'B', 'C'], [['first', ['08:00', null, null]], ['second', [null, '08:05', '08:10']]]);
  const core = await api(split);
  assert.deepEqual(core.findDirectRoutes(context('A'), context('C'), weekday), []);
});

test('Explicit valid service/time and concrete identities are required, including empty queries', async () => {
  const { findDirectRoutes } = await api();
  for (const now of [undefined, null, '', '7:00', '24:00', '12:60', '07:00:00']) {
    assert.throws(() => findDirectRoutes(OIE, context('5900078-1'), { service: 'E-R', now }), /now|HH:MM/i);
  }
  for (const service of [undefined, 'holiday']) {
    assert.throws(() => findDirectRoutes(OIE, context('5900078-1'), { service, now: '07:00' }), /service/i);
  }
  assert.throws(() => findDirectRoutes(context('unknown'), context('5900078-1'), weekday), /stop/i);
  assert.throws(() => findDirectRoutes(OIE, context('unknown'), weekday), /stop/i);
  assert.deepEqual(findDirectRoutes(context(), context('5900078-1'), weekday), []);
  assert.deepEqual(findDirectRoutes(OIE, context(), weekday), []);
});

test('Real route outputs retain same-trip evidence, stable ordering, unique trip identity and detached data', async () => {
  const core = await api();
  for (const service of ['E-R', 'L', 'P']) {
    for (const id of ['5901010-1', '5900565-1', '5900286-1']) {
      const origin = core.createOriginContext(id);
      const targets = core.reachableDestinations(origin, { service });
      for (const target of targets) {
        const routes = core.findDirectRoutes(origin, target, { service, now: '00:00' });
        assert.ok(routes.length > 0);
        const keys = routes.map(r => JSON.stringify([r.line, r.patternId, r.tripId]));
        assert.equal(new Set(keys).size, keys.length);
        assert.deepEqual(routes.map(r => `${r.arrival}|${r.departure}|${JSON.stringify([r.line, r.patternId, r.tripId])}`),
          routes.map(r => `${r.arrival}|${r.departure}|${JSON.stringify([r.line, r.patternId, r.tripId])}`).sort());
        for (const r of routes) {
          const line = BUS_DATA.lines.find(l => l.line === r.line && l.pattern_id === r.patternId && l.service === service);
          const trip = line.trips.find(t => t.id === r.tripId);
          const board = trip.visits.find(v => v.visitIndex === r.boardVisitIndex);
          const alight = trip.visits.find(v => v.visitIndex === r.alightVisitIndex);
          assert.ok(origin.stopIds.includes(r.boardStopId));
          assert.ok(target.stopIds.includes(r.alightStopId));
          assert.ok(r.boardVisitIndex < r.alightVisitIndex);
          assert.deepEqual([r.tripNo, r.boardStopId, r.departure, r.alightStopId, r.arrival, r.destinationName],
            [trip.no, board.stopId, board.departure, alight.stopId, alight.arrival, BUS_DATA.by_code[alight.stopId].name]);
        }
      }
    }
  }
  const target = context('5900078-1');
  const result = core.findDirectRoutes(OIE, target, weekday);
  result[0].destinationName = 'modified';
  assert.equal(core.findDirectRoutes(OIE, target, weekday)[0].destinationName, 'Haigla');
});
