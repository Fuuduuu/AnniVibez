import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { BUS_DATA } from '../../src/data/busData.js';
import { GTFS_STOP_COORDS_BY_ID } from '../../src/data/gtfsStopCoords.js';
import { generateModel, serializeModel } from './generate-bus-data.mjs';
import { parseCSV } from './validate-timetables.mjs';

const root = fileURLToPath(new URL('../../data/bus/rakvere/2026-09-13/', import.meta.url));
const runtimePath = fileURLToPath(new URL('../../src/data/busData.js', import.meta.url));
const generatorPath = fileURLToPath(new URL('./generate-bus-data.mjs', import.meta.url));
const busURL = new URL('../../src/utils/bus.js', import.meta.url).href;
// Resolve Vite's extensionless imports to the real files, without replacing source or data.
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === busURL && ['../data/busData', '../data/gtfsStopCoords'].includes(specifier)) {
    return nextResolve(new URL(specifier + '.js', context.parentURL).href, context);
  }
  return nextResolve(specifier, context);
} });
const { depsWithMeta } = await import(busURL);
hook.deregister();
const departures = (code, service = 'E-R', destination) => depsWithMeta(code, 999, { service, now: '00:00', ...(destination ? { destination } : {}) }).departures;
const lineTimes = (code, line, service = 'E-R', destination) => departures(code, service, destination).filter(d => d.line === line).map(d => d.time);
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const tables = Object.fromEntries(manifest.tables.map(t => [t.id, readFileSync(join(root, 'tables', t.filename), 'utf8')]));

test('actual runtime contains 17 tables, 7 patterns, 121 trips and all 2140 literal CSV cells', () => {
  assert.equal(BUS_DATA.lines.length, 17);
  assert.equal(BUS_DATA.patterns.length, 7);
  assert.equal(BUS_DATA.lines.reduce((n, l) => n + l.trips.length, 0), 121);
  assert.deepEqual(BUS_DATA.meta.sourceCounts, { pdfs: 10, tables: 17, trips: 121, cells: 2140 });
  let cells = 0;
  for (const table of manifest.tables) {
    const line = BUS_DATA.lines.find(l => l.sourceRef.table === table.id);
    const [, ...rows] = parseCSV(tables[table.id]);
    assert.equal(line.trips.length, table.trips.length);
    line.trips.forEach((trip, c) => {
      assert.deepEqual(trip.stop_times, rows.map(r => ({ seq: Number(r[0]), time: r[c + 4] })));
      cells += rows.length;
    });
  }
  assert.equal(cells, 2140);
});

test('actual runtime equals the fresh normalized model and candidate byte-for-byte', () => {
  const fresh = generateModel(manifest, tables);
  assert.ok(readFileSync(runtimePath, 'utf8') === serializeModel(fresh), 'Runtime bytes differ from freshly generated model');
  assert.deepEqual(BUS_DATA, fresh);
  assert.ok(readFileSync(runtimePath).equals(readFileSync(join(root, 'generated', 'busData.generated.js'))), 'Runtime bytes differ from candidate');
});

test('real bus.js returns exact weekday Oie times and both weekend directions', () => {
  assert.deepEqual(lineTimes('5901010-1', '3'), '06:22 07:22 08:18 09:33 11:33 13:33 15:33 17:38 18:33'.split(' '));
  assert.deepEqual(lineTimes('5901011-1', '3'), '07:05 08:05 10:19 12:20 14:19 16:19 17:19 18:19'.split(' '));
  for (const day of ['L', 'P']) for (const id of ['5901010-1', '5901011-1']) assert.ok(lineTimes(id, '3', day).length > 0);
});

test('real line 2 return routes Lihakombinaat to Piira without outbound arrival pollution', () => {
  const expected = ['06:20', '07:20', '08:17', '16:30', '17:35', '18:30'];
  assert.deepEqual(lineTimes('5900659-1', '2'), expected);
  assert.deepEqual(lineTimes('5900659-1', '2', 'E-R', '5900565-1'), expected);
  const back = BUS_DATA.lines.find(l => l.sourceRef?.table === 'line2-er-lihakombinaat-piira');
  assert.deepEqual(back.stops.slice(0, 4).map(s => s.code), ['5900659-1', '5900661-1', '5901201-1', '5900036-1']);
  assert.equal(back.stops.at(-1).code, '5900565-1');
  assert.deepEqual(BUS_DATA.coverage['2'], { 'E-R': 'SCHEDULED', L: 'NO_SERVICE', P: 'NO_SERVICE' });
  for (const day of ['L', 'P']) assert.deepEqual(lineTimes('5900659-1', '2', day), []);
});

test('real runtime has line 3 Keskvaljak weekends and line 5 Ragavere to Pohjakeskus on every service', () => {
  for (const day of ['L', 'P']) assert.ok(lineTimes('5900823-1', '3', day, '5900232-1').length > 0);
  for (const day of ['E-R', 'L', 'P']) {
    assert.equal(lineTimes('5900670-1', '5', day, '5900598-1').length, ({ 'E-R': 11, L: 7, P: 6 })[day]);
    assert.equal(lineTimes('5900598-1', '5', day, '5900670-1').length, ({ 'E-R': 11, L: 7, P: 6 })[day]);
  }
});

test('real runtime preserves FIX01 at Piira, Lihakombinaat, Torma, Ragavere and Pohjakeskus', () => {
  const expectedEnds = new Set(['5900565-1', '5900659-1', '5900822-1', '5900670-1', '5900598-1']);
  assert.deepEqual(new Set(BUS_DATA.lines.map(l => l.stops.at(-1).code)), expectedEnds);
  for (const line of BUS_DATA.lines) {
    const start = line.stops[0], end = line.stops.at(-1);
    const startTimes = line.trips.map(t => t.stop_times.find(st => st.seq === start.seq).time).sort();
    const matching = code => departures(code, line.service).filter(d => d.line === line.line && d.dir === line.direction).map(d => d.time);
    assert.deepEqual(matching(start.code), startTimes);
    assert.deepEqual(matching(end.code), end.code === start.code ? startTimes : []);
    assert.deepEqual(departures(end.code, line.service, line.stops[1].code).filter(d => d.line === line.line && d.dir === line.direction).map(d => d.time), end.code === start.code ? startTimes : []);
  }
});

test('real runtime preserves resolved Napi/Aiand IDs and every timetable stop has matching coordinates', () => {
  for (const line of BUS_DATA.lines) {
    for (const stop of line.stops) {
      const point = GTFS_STOP_COORDS_BY_ID[stop.resolvedStopId];
      assert.ok(point, `Missing coordinates: ${stop.resolvedStopId}`);
      assert.equal(point.stopName, stop.name);
      assert.ok(Number.isFinite(point.lat) && Number.isFinite(point.lon));
    }
    if (line.line === '1') assert.deepEqual(line.stops.slice(16, 18).map(s => [s.printedStopId, s.code]), [['5900508-1', '5900507-1'], ['5900508-1', '5900508-1']]);
    for (const stop of line.stops.filter(s => s.name === 'Aiand')) assert.deepEqual([stop.printedStopId, stop.code], ['5900597-1', '5900013-1']);
  }
});

test('explicit CLI output is deterministic, equals runtime, and rejects incomplete arguments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'annivibe-data03-'));
  try {
    const output = join(dir, 'nested', 'busData.js');
    const run = args => spawnSync(process.execPath, [generatorPath, ...args], { encoding: 'utf8' });
    const first = run([root, '--output', output]);
    assert.equal(first.status, 0, first.stderr);
    const bytes = readFileSync(output);
    assert.ok(bytes.equals(readFileSync(runtimePath)), 'Explicit output bytes differ from runtime');
    const second = run([root, '--output', output]);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(readFileSync(output), bytes);
    assert.notEqual(run([root, '--output']).status, 0);
    assert.notEqual(run([root, '--unknown', output]).status, 0);
  } finally {
    assert.ok(resolve(dir).startsWith(join(resolve(tmpdir()), 'annivibe-data03-')));
    rmSync(dir, { recursive: true, force: true });
  }
});
