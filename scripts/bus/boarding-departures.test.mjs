import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BUS_DATA as current } from '../../src/data/busData.js';
import { BUS_DATA as generated } from '../../data/bus/rakvere/2026-09-13/generated/busData.generated.js';

const busSource = readFileSync(new URL('../../src/utils/bus.js', import.meta.url), 'utf8');
async function loadBus(data) {
  const source = busSource
    .replace("import { BUS_DATA } from '../data/busData';", `const BUS_DATA = ${JSON.stringify(data)};`)
    .replace("'../data/gtfsStopCoords'", JSON.stringify(new URL('../../src/data/gtfsStopCoords.js', import.meta.url).href));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const times = (bus, origin, options = {}) => bus.depsWithMeta(origin, 999, { service: 'E-R', now: '00:00', ...options }).departures.map(d => d.time);
const isolate = (data, line, trips = line.trips) => ({ ...data, lines: [{ ...line, trips }] });

for (const [label, data] of [['current', current], ['generated', generated]]) {
  test(`${label}: Lihakombinaat outbound arrivals are not departures`, async () => {
    const line = data.lines.find(l => l.line === '2' && l.service === 'E-R' && l.stops.at(-1).code === '5900659-1');
    assert.ok(line && line.trips.length);
    assert.deepEqual(times(await loadBus(isolate(data, line)), '5900659-1'), []);
  });

  test(`${label}: Piira loop keeps first occurrences and rejects final occurrences`, async () => {
    const line = data.lines.find(l => l.line === '1' && l.service === 'E-R');
    const bus = await loadBus(isolate(data, line, [line.trips[0]]));
    assert.equal(line.stops[0].code, '5900565-1');
    assert.equal(line.stops.at(-1).code, '5900565-1');
    assert.deepEqual(times(bus, '5900565-1'), ['06:20']);
    assert.deepEqual(times(bus, '5900565-1', { now: '06:21' }), []);
    assert.deepEqual(times(bus, '5900565-1', { destination: line.stops[1].code }), ['06:20']);
    assert.deepEqual(times(bus, '5900565-1', { now: '06:21', destination: line.stops[1].code }), []);
  });

  test(`${label}: Torma terminal point is arrival-only; starting point remains boardable`, async () => {
    for (const line of data.lines.filter(l => l.line === '3' && l.trips.length)) {
      const bus = await loadBus(isolate(data, line));
      assert.equal(line.stops[0].code, '5900823-1');
      assert.equal(line.stops.at(-1).code, '5900822-1');
      assert.deepEqual(times(bus, '5900822-1', { service: line.service }), []);
      assert.deepEqual(times(bus, '5900823-1', { service: line.service }), line.trips.map(t => t.stop_times[0].time).sort());
    }
  });

  test(`${label}: non-terminal Oie queries retain exact stored times, downstream filtering and output shape`, async () => {
    const line = data.lines.find(l => l.line === '3' && l.service === 'E-R' && l.stops.some(s => s.code === '5901010-1'));
    const origin = line.stops.find(s => s.code === '5901010-1');
    const destination = line.stops.find(s => s.seq === origin.seq + 1);
    const bus = await loadBus(isolate(data, line));
    const expected = line.trips.map(t => t.stop_times.find(st => st.seq === origin.seq).time).sort();
    assert.deepEqual(times(bus, origin.code), expected);
    assert.deepEqual(times(bus, origin.code, { destination: destination.code }), expected);
    assert.deepEqual(times(bus, line.stops.at(-1).code, { destination: origin.code }), []);
    assert.deepEqual(Object.keys(bus.depsWithMeta(origin.code, 1, { service: 'E-R', now: '00:00' }).departures[0]), ['line', 'v', 'dir', 'time', 'originStopId']);
    if (label === 'generated') assert.deepEqual(expected, '06:22 07:22 08:18 09:33 11:33 13:33 15:33 17:38 18:33'.split(' '));
  });
}

test('generated: Lihakombinaat return starts remain boardable in the full candidate', async () => {
  const bus = await loadBus(generated);
  assert.deepEqual(times(bus, '5900659-1'), ['06:20', '07:20', '08:17', '16:30', '17:35', '18:30']);
  assert.deepEqual(times(bus, '5900659-1', { destination: '5900565-1' }), ['06:20', '07:20', '08:17', '16:30', '17:35', '18:30']);
});

test('generated: Ragavere and Pohjakeskus board only at the starting end in both directions and all services', async () => {
  for (const line of generated.lines.filter(l => l.line === '5')) {
    assert.ok(['5900670-1', '5900598-1'].includes(line.stops[0].code));
    const bus = await loadBus(isolate(generated, line));
    assert.deepEqual(times(bus, line.stops[0].code, { service: line.service }), line.trips.map(t => t.stop_times[0].time).sort());
    assert.deepEqual(times(bus, line.stops.at(-1).code, { service: line.service }), []);
  }
});

test('generated: Napi stop points remain separate boarding occurrences, without name-based dedupe', async () => {
  const line = generated.lines.find(l => l.line === '1' && l.service === 'E-R');
  const bus = await loadBus(isolate(generated, line, [line.trips[0]]));
  assert.deepEqual(times(bus, '5900507-1'), ['06:48']);
  assert.deepEqual(times(bus, '5900508-1'), ['06:50']);
  assert.deepEqual(times(bus, ['5900507-1', '5900508-1']), ['06:48', '06:50']);
});

function fixture(codes, tripRows, visits) {
  const stops = codes.map((code, i) => ({ seq: i + 1, code, name: code }));
  return {
    by_code: Object.fromEntries(codes.map(code => [code, { name: code }])), groups: [],
    patterns: [{ id: 'fixture', stop_ids: codes }],
    lines: [{ line: 'X', service: 'E-R', pattern_id: 'fixture', direction: 'fixture', stops,
      trips: [{ id: 'trip', stop_times: tripRows.map(([seq, time]) => ({ seq, time })), ...(visits ? { visits } : {}) }] }],
  };
}

test('later stops must be in this trip, not just its pattern or a different trip', async () => {
  const data = fixture(['A', 'B', 'C'], [[1, '08:00']]);
  data.lines[0].trips.push({ id: 'other', stop_times: [{ seq: 2, time: '09:00' }, { seq: 3, time: '09:10' }] });
  const bus = await loadBus(data);
  assert.deepEqual(times(bus, 'A'), []);
  assert.deepEqual(times(bus, 'A', { destination: 'C' }), []);
  assert.deepEqual(times(bus, 'B'), ['09:00']);
});

test('each repeated origin needs its own downstream destination in the same trip', async () => {
  const bus = await loadBus(fixture(['A', 'B', 'A', 'C', 'A'], [[1, '08:00'], [2, '08:05'], [3, '08:10'], [4, '08:15'], [5, '08:20']]));
  assert.deepEqual(times(bus, ['A', 'A']), ['08:00', '08:10']);
  assert.deepEqual(times(bus, 'A', { destination: 'B' }), ['08:00']);
  assert.deepEqual(times(bus, 'A', { destination: 'B', now: '08:06' }), []);
  assert.deepEqual(times(bus, 'A', { destination: 'C' }), ['08:00', '08:10']);
});

test('explicit multi-row visits publish one departure event and no terminal arrival/layover rows', async () => {
  const visits = [{ sourceRows: [1, 2] }, { sourceRows: [3] }, { sourceRows: [4, 5] }];
  const bus = await loadBus(fixture(['A', 'A', 'B', 'A', 'A'], [[1, '08:00'], [2, '08:02'], [3, '08:05'], [4, '08:10'], [5, '08:12']], visits));
  assert.deepEqual(times(bus, 'A'), ['08:02']);
  assert.deepEqual(times(bus, 'A', { destination: 'B' }), ['08:02']);
  assert.deepEqual(times(bus, 'A', { now: '08:03' }), []);
});

test('sequence numbers, not array positions, identify later occurrences; equal timestamps are allowed', async () => {
  const bus = await loadBus(fixture(['A', 'B', 'C'], [[3, '08:05'], [1, '08:00'], [2, '08:00']]));
  assert.deepEqual(times(bus, 'A'), ['08:00']);
  assert.deepEqual(times(bus, 'B'), ['08:00']);
  assert.deepEqual(times(bus, 'C'), []);
});
