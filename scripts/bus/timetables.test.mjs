import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTableText, parseRawText, normalizeTable, reconcileExtractions, snapshotRoot, writeSnapshot, toCSV } from './extract-timetables.mjs';
import { validateSnapshot, validateTimes, parseCSV } from './validate-timetables.mjs';

// Deliberately out-of-order trip IDs and a travel hint unlike the actual interval.
const tableText = [
  'Nr. Peatus                Reis   Reis',
  '                          14     12',
  '                          5-01   5-03',
  '1 Aiand 5900597-1 00:09'.padEnd(26) + '12:33  13:33',
  '2 Rohu 5900653-1'.padEnd(26) + '12:36  13:36',
  'Töötamise päevad          1-5    1-5',
].join('\n');
const rawText = [
  'Reis Reis', '14 12', '5-01 5-03',
  '1 Aiand 5900597-1 00:09 12:33 13:33',
  '2 Rohu 5900653-1 12:36 13:36',
  'Töötamise päevad 1-5 1-5',
].join('\n');

test('two parsers preserve column identity, printed values and times, not travel hints', () => {
  const [table] = parseTableText(tableText);
  assert.deepEqual(table, parseRawText(rawText)[0]);
  assert.deepEqual(table.trips, ['14', '12']);
  assert.deepEqual(table.blocks, ['5-01', '5-03']);
  assert.deepEqual(table.rows[0], { row: 1, name: 'Aiand', printedStopId: '5900597-1', times: ['12:33', '13:33'] });
  assert.deepEqual(table.rows[1].times, ['12:36', '13:36']);
});

test('missing/malformed matrix cells fail rather than consume a travel hint', () => {
  assert.throws(() => parseTableText(tableText.replace('12:33', '     ')), /time|cell/i);
  assert.throws(() => parseTableText(tableText.replace('13:33', '13.33')), /time|cell/i);
  assert.throws(() => parseRawText(rawText.replace('13:33', '13.33')), /time|cell/i);
});

test('raw split name/distance text rejoins only a verified immediate continuation', () => {
  const wrapped = rawText.replace('1 Aiand 5900597-1', '1 Aiand\n2,775 5900597-1');
  assert.deepEqual(parseRawText(wrapped), parseRawText(rawText));
  assert.throws(() => parseRawText(rawText.replace('1 Aiand 5900597-1', '1 Aiand\n2 Other 5900597-1')), /continuation|stop_id/i);
});

test('only the observed line 3 name/distance overlap is an explicit extraction exception', () => {
  const raw = [{ trips: ['01'], blocks: ['3-02'], rows: [{ row: 10, name: 'Carl Robert Jakobsoni', printedStopId: '5900056-1', times: ['06:57'] }] }];
  const physical = structuredClone(raw);
  physical[0].rows[0].name = 'Carl Robert Jakobs5o,n1i82';
  const source = { tableIds: ['line3-er-keskvaljak'] };
  const result = reconcileExtractions(physical, raw, source);
  assert.deepEqual(result.tables, raw);
  assert.equal(result.artifacts[0].state, 'EXTRACTION_ARTIFACT');
  assert.equal(result.artifacts[0].tableModeValue, 'Carl Robert Jakobs5o,n1i82');
  physical[0].rows[0].times[0] = '06:58';
  assert.throws(() => reconcileExtractions(physical, raw, source), /mismatch/i);
});

test('normalization changes only approved Aiand identity and leaves Napi unresolved', () => {
  const aiand = normalizeTable(parseRawText(rawText)[0], { line: '5', id: 'line5-er-return' });
  assert.equal(aiand.rows[0].printedStopId, '5900597-1');
  assert.equal(aiand.rows[0].resolvedStopId, '5900013-1');
  assert.equal(aiand.anomalies[0].state, 'STOP_ID_MISMATCH');
  const source = { trips: ['01'], blocks: ['1-01'], rows: [
    { row: 1, name: 'Näpi', printedStopId: '5900508-1', times: ['06:48'] },
    { row: 2, name: 'Näpi', printedStopId: '5900508-1', times: ['06:50'] },
  ] };
  const napi = normalizeTable(source, { line: '1', id: 'line1-er-loop' });
  assert.deepEqual(napi.rows.map(r => r.resolvedStopId), ['', '']);
  assert.ok(napi.anomalies.every(a => a.state === 'SOURCE_CONFLICT' && a.status === 'UNRESOLVED'));
});

test('time validation allows equal consecutive timestamps but rejects reversal or bad HH:MM', () => {
  assert.doesNotThrow(() => validateTimes([['06:04'], ['06:04'], ['06:05']], 'fixture'));
  assert.throws(() => validateTimes([['06:04'], ['06:01']], 'fixture'), /decreas/i);
  for (const bad of ['6:04', '24:01', '06:60', '', '06.04']) {
    assert.throws(() => validateTimes([[bad]], 'fixture'), /time/i);
  }
});

test('CSV quoting preserves names and literal leading-zero times', () => {
  const table = { trips: ['01'], rows: [{ row: 1, name: 'Name, "quoted"', printedStopId: '5900565-1', resolvedStopId: '5900565-1', times: ['06:04'] }] };
  assert.deepEqual(parseCSV(toCSV(table))[1], ['1', 'Name, "quoted"', '5900565-1', '5900565-1', '06:04']);
  assert.throws(() => parseCSV('"unfinished'), /Incomplete/);
});

test('a missing PDF stops extraction before any snapshot output is created', () => {
  const dir = mkdtempSync(join(tmpdir(), 'annivibe-data01-tests-'));
  try {
    const input = join(dir, 'input'), output = join(dir, 'output');
    mkdirSync(input);
    assert.throws(() => writeSnapshot(input, output), /Missing source PDF/);
    assert.equal(existsSync(output), false);
  } finally {
    assert.ok(dir.startsWith(join(tmpdir(), 'annivibe-data01-tests-')));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('real PDF snapshot has independently specified totals and literal anomaly fixtures', () => {
  assert.deepEqual(validateSnapshot(snapshotRoot), { pdfs: 10, tables: 17, trips: 121, cells: 2140 });
  const get = name => readFileSync(join(snapshotRoot, 'tables', name), 'utf8');
  assert.match(get('line2-er-piira-lihakombinaat.csv'), /6,Seminari,5900726-1,5900726-1,06:04,07:01/);
  assert.match(get('line1-er-loop.csv'), /17,Näpi,5900508-1,,06:48/);
  assert.match(get('line1-er-loop.csv'), /18,Näpi,5900508-1,,06:50/);
  assert.match(get('line5-er-pohjakeskus-ragavere.csv'), /reis_10,reis_14,reis_12,reis_16/);
});

test('validator rejects edited cells, printed IDs/names, anomaly decisions, coverage and missing evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'annivibe-data01-tests-'));
  try {
    cpSync(snapshotRoot, dir, { recursive: true });
    const file = join(dir, 'tables', 'line2-er-piira-lihakombinaat.csv');
    const original = readFileSync(file, 'utf8');
    for (const [from, to] of [['06:04', '06:01'], ['5900726-1', '5900727-1'], ['Seminari', 'Changed']]) {
      writeFileSync(file, original.replace(from, to));
      assert.throws(() => validateSnapshot(dir), /mismatch|decreas/i);
    }
    writeFileSync(file, original);
    const manifestFile = join(dir, 'manifest.json');
    const manifestText = readFileSync(manifestFile, 'utf8');
    for (const mutate of [m => { m.anomalies = []; }, m => { m.coverage[0].status = 'SERVICE'; }]) {
      const m = JSON.parse(manifestText); mutate(m);
      writeFileSync(manifestFile, JSON.stringify(m));
      assert.throws(() => validateSnapshot(dir), /manifest|coverage/i);
    }
    writeFileSync(manifestFile, manifestText);
    writeFileSync(join(dir, 'pdf', JSON.parse(manifestText).pdfs[0].filename), 'not a PDF');
    assert.throws(() => validateSnapshot(dir), /hash|PDF/i);
  } finally {
    assert.ok(dir.startsWith(join(tmpdir(), 'annivibe-data01-tests-')));
    rmSync(dir, { recursive: true, force: true });
  }
});
