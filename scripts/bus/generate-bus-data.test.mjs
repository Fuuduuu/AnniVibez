import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseCSV } from './validate-timetables.mjs';

const root = fileURLToPath(new URL('../../data/bus/rakvere/2026-09-13/', import.meta.url));
const generator = fileURLToPath(new URL('./generate-bus-data.mjs', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const tables = Object.fromEntries(manifest.tables.map(t => [t.id, readFileSync(join(root, 'tables', t.filename), 'utf8')]));
const api = async () => {
  assert.ok(existsSync(generator), 'Generator must exist');
  return import('./generate-bus-data.mjs');
};
const model = async () => (await api()).generateModel(manifest, tables);

test('all 2140 source cells and trip metadata survive exactly across 17 tables and 121 trips', async () => {
  const data = await model();
  assert.equal(data.lines.length, 17);
  assert.equal(data.lines.reduce((n, l) => n + l.trips.length, 0), 121);
  assert.equal(data.meta.sourceCounts.pdfs, 10);
  let cells = 0;
  for (const table of manifest.tables) {
    const line = data.lines.find(l => l.sourceRef.table === table.id);
    const [, ...rows] = parseCSV(tables[table.id]);
    assert.equal(line.trips.length, table.trips.length);
    assert.equal(line.stops.length, rows.length);
    table.trips.forEach((trip, c) => {
      const generated = line.trips[c];
      assert.equal(generated.no, trip.printedReis);
      assert.equal(generated.block, trip.block);
      assert.equal(generated.dayType, table.dayType);
      assert.deepEqual(generated.sourceRef, { table: table.id, pdf: table.sourcePdf, column: trip.column });
      assert.deepEqual(generated.stop_times, rows.map(r => ({ seq: Number(r[0]), time: r[c + 4] })));
      cells += rows.length;
    });
    rows.forEach((r, i) => {
      assert.equal(line.stops[i].printedStopId, r[2]);
      assert.equal(line.stops[i].resolvedStopId, r[3] || null);
      assert.equal(line.stops[i].code, r[3] || null);
    });
  }
  assert.equal(cells, 2140);
  assert.equal(data.meta.sourceCounts.cells, cells);
  assert.doesNotMatch(JSON.stringify(data), /offset_min|sample_start_times|sample_time|txt-sample-only/);
});

test('both Oie concrete stop points have exact weekday and weekend schedules', async () => {
  const data = await model();
  const times = (code, day) => data.lines.filter(l => l.line === '3' && l.service === day)
    .flatMap(l => l.trips.flatMap(t => t.stop_times.filter(st => l.stops[st.seq - 1].code === code).map(st => st.time)));
  assert.deepEqual(times('5901010-1', 'E-R'), '06:22 07:22 08:18 09:33 11:33 13:33 15:33 17:38 18:33'.split(' '));
  assert.deepEqual(times('5901011-1', 'E-R'), '07:05 08:05 10:19 12:20 14:19 16:19 17:19 18:19'.split(' '));
  for (const day of ['L', 'P']) for (const code of ['5901010-1', '5901011-1']) assert.ok(times(code, day).length > 0);
});

test('line 2 return and both full line 5 directions exist for each scheduled service', async () => {
  const data = await model();
  const back = data.lines.find(l => l.sourceRef.table === 'line2-er-lihakombinaat-piira');
  assert.deepEqual(back.stops.slice(0, 4).map(s => s.name), ['Lihakombinaat', 'Roodev\u00e4lja', 'Papiaru', 'Arkna tee']);
  assert.equal(back.stops.at(-1).name, 'Piira');
  for (const day of ['E-R', 'L', 'P']) {
    const lines = data.lines.filter(l => l.line === '5' && l.service === day);
    assert.equal(lines.length, 2);
    assert.ok(lines.every(l => l.trips.length === ({ 'E-R': 11, L: 7, P: 6 })[day]));
    assert.equal(new Set(lines.map(l => l.pattern_id)).size, 2);
  }
});

test('Aiand resolution and all unresolved Napi rows retain evidence without invented routing IDs', async () => {
  const data = await model();
  assert.deepEqual(data.anomalies, manifest.anomalies);
  for (const l of data.lines.filter(l => l.line === '1')) {
    for (const seq of [17, 18]) {
      const s = l.stops[seq - 1];
      assert.equal(s.printedStopId, '5900508-1');
      assert.equal(s.resolvedStopId, null);
      assert.equal(s.identityStatus, 'UNRESOLVED');
      assert.equal(s.anomalies[0].state, 'SOURCE_CONFLICT');
      for (const t of l.trips) {
        const v = t.visits.find(v => v.sourceRows.includes(seq));
        assert.deepEqual(v.sourceRows, [seq]);
        assert.equal(v.stopId, null);
        assert.equal(v.arrival, t.stop_times[seq - 1].time);
        assert.equal(v.departure, v.arrival);
      }
    }
  }
  for (const l of data.lines.filter(l => l.sourceRef.table.includes('pohjakeskus-ragavere'))) {
    const s = l.stops[5];
    assert.equal(s.printedStopId, '5900597-1');
    assert.equal(s.resolvedStopId, '5900013-1');
    assert.equal(s.identityStatus, 'RESOLVED');
    assert.ok(s.anomalies[0].authority);
  }
  assert.equal(data.by_code['5900508-1'], undefined);
  assert.ok(Object.values(data.by_code).every(s => !('lat' in s) && !('lon' in s)));
});

test('visits merge only consecutive confirmed IDs, retain terminal flags and first/last times', async () => {
  const { buildVisits } = await api();
  const stops = ['a', 'a', 'b', 'a', null, null].map((code, i) => ({ seq: i + 1, code, name: 'Same name' }));
  const times = ['10:00', '10:02', '10:03', '10:04', '10:05', '10:06'].map((time, i) => ({ seq: i + 1, time }));
  const visits = buildVisits(stops, times);
  assert.equal(visits.length, 5);
  assert.deepEqual(visits[0], { visitIndex: 0, stopId: 'a', sourceRows: [1, 2], arrival: '10:00', departure: '10:02', isFirst: true, isLast: false, isIntermediate: false, hasLaterVisit: true });
  assert.deepEqual(visits.map(v => v.sourceRows), [[1, 2], [3], [4], [5], [6]]);
  assert.ok(visits.slice(1, -1).every(v => v.isIntermediate && v.hasLaterVisit));
  assert.ok(visits.at(-1).isLast && !visits.at(-1).hasLaterVisit);
  const one = buildVisits(stops.slice(0, 1), times.slice(0, 1))[0];
  assert.ok(one.isFirst && one.isLast && !one.isIntermediate && !one.hasLaterVisit);
});

test('coverage is manifest-derived and absence alone means UNKNOWN', async () => {
  const { generateModel } = await api();
  const data = await model();
  assert.deepEqual(data.coverage['2'], { 'E-R': 'SCHEDULED', L: 'NO_SERVICE', P: 'NO_SERVICE' });
  const noAuthority = structuredClone(manifest);
  noAuthority.coverage = [];
  assert.equal(generateModel(noAuthority, tables).coverage['2'].L, 'UNKNOWN');
  const conflict = structuredClone(manifest);
  conflict.coverage.push({ line: '2', dayType: 'E-R', status: 'NO_SERVICE' });
  assert.throws(() => generateModel(conflict, tables), /coverage/i);
});

test('pattern IDs and serialized output are independent of input enumeration order', async () => {
  const { generateModel, serializeModel } = await api();
  const original = await model();
  const reversed = structuredClone(manifest);
  reversed.tables.reverse();
  reversed.pdfs.reverse();
  assert.equal(serializeModel(original), serializeModel(generateModel(reversed, Object.fromEntries(Object.entries(tables).reverse()))));
  assert.equal(Object.keys(original.patterns).length, 7);
  assert.equal(new Set(original.lines.map(l => l.pattern_id)).size, 7);
  const renamed = { ...tables, 'line1-er-loop': tables['line1-er-loop'].replace('Piira', 'Renamed') };
  assert.deepEqual(generateModel(manifest, renamed).patterns.map(p => p.id), original.patterns.map(p => p.id));
});

test('candidate loads through unchanged bus.js and returns exact resolved-stop departures', async () => {
  const data = await model();
  assert.ok(Array.isArray(data.patterns), 'Current bus.js requires a patterns array');
  const source = readFileSync(new URL('../../src/utils/bus.js', import.meta.url), 'utf8')
    .replace("import { BUS_DATA } from '../data/busData';", `const BUS_DATA = ${JSON.stringify(data)};`)
    .replace("'../data/gtfsStopCoords'", JSON.stringify(new URL('../../src/data/gtfsStopCoords.js', import.meta.url).href));
  const bus = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const departures = bus.depsWithMeta('5901010-1', 99, { service: 'E-R', now: '00:00' }).departures;
  assert.deepEqual(departures.filter(d => d.line === '3').map(d => d.time), '06:22 07:22 08:18 09:33 11:33 13:33 15:33 17:38 18:33'.split(' '));
  const back = data.lines.find(l => l.sourceRef.table === 'line2-er-lihakombinaat-piira');
  const routed = bus.depsWithMeta(back.stops[0].code, 99, { service: 'E-R', now: '00:00', destination: back.stops.at(-1).code }).departures;
  assert.deepEqual(routed.filter(d => d.line === '2').map(d => d.time), back.trips.map(t => t.stop_times[0].time));
});

test('malformed input, missing tables, conflicting stop resolutions and duplicate trip columns fail closed', async () => {
  const { generateModel } = await api();
  const absent = { ...tables };
  delete absent['line1-er-loop'];
  assert.throws(() => generateModel(manifest, absent), /table/i);
  assert.throws(() => generateModel(manifest, { ...tables, 'line1-er-loop': tables['line1-er-loop'].replace('06:20', '25:00') }), /time/i);
  assert.throws(() => generateModel(manifest, { ...tables, 'line1-er-loop': tables['line1-er-loop'].replace('5900508-1,,', '5900508-1,5900508-1,') }), /identity/i);
  const unapproved = structuredClone(manifest);
  unapproved.anomalies = unapproved.anomalies.filter(a => a.state !== 'STOP_ID_MISMATCH');
  assert.throws(() => generateModel(unapproved, tables), /identity/i);
  const duplicate = structuredClone(manifest);
  duplicate.tables[0].trips[1].column = duplicate.tables[0].trips[0].column;
  assert.throws(() => generateModel(duplicate, tables), /trip/i);
});

test('CLI generates identical bytes without PDFs or a working PDF extractor', async () => {
  await api();
  const dir = mkdtempSync(join(tmpdir(), 'annivibe-gen01-'));
  try {
    cpSync(join(root, 'manifest.json'), join(dir, 'manifest.json'));
    mkdirSync(join(dir, 'tables'));
    for (const t of manifest.tables) cpSync(join(root, 'tables', t.filename), join(dir, 'tables', t.filename));
    const run = () => spawnSync(process.execPath, [generator, dir], { encoding: 'utf8', env: { ...process.env, PDFTOTEXT: 'not-an-executable' } });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const path = join(dir, 'generated', 'busData.generated.js');
    const bytes = readFileSync(path);
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(existsSync(join(dir, 'pdf')), false);
  } finally {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '\\annivibe-gen01-') || resolve(dir).startsWith(resolve(tmpdir()) + '/annivibe-gen01-'));
    rmSync(dir, { recursive: true, force: true });
  }
});
