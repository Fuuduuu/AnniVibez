import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, sha256, snapshotRoot, sources } from './extract-timetables.mjs';

export function validateTimes(matrix, label) {
  const width = matrix[0]?.length;
  assert.ok(width > 0, `No trip times: ${label}`);
  matrix.forEach((row, r) => {
    assert.equal(row.length, width, `Time column count mismatch: ${label}`);
    row.forEach((time, c) => {
      assert.match(time, /^(?:[01]\d|2[0-3]):[0-5]\d$/, `Malformed time: ${label} row ${r + 1}`);
      if (r > 0) assert.ok(time >= matrix[r - 1][c], `Decreasing trip time: ${label} row ${r + 1}, column ${c + 1}`);
    });
  });
}

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === ',' || ch === '\n') {
      row.push(cell); cell = ''; closed = false;
      if (ch === '\n') { rows.push(row); row = []; }
    } else if (ch === '"') {
      assert.ok(cell === '' && !closed, 'Invalid CSV quote'); quoted = true;
    } else {
      assert.ok(!closed && ch !== '\r', 'Invalid CSV delimiter/line ending'); cell += ch;
    }
  }
  assert.ok(!quoted && row.length === 0 && cell === '', 'Incomplete CSV or missing final newline');
  return rows;
}

export function validateSnapshot(root = snapshotRoot) {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const expectedPdfs = sources.map(s => s.filename).sort();
  assert.deepEqual(readdirSync(join(root, 'pdf')).sort(), expectedPdfs, 'Exactly 10 expected PDFs required');
  assert.equal(manifest.pdfs.length, 10, 'Manifest PDF count mismatch');
  assert.deepEqual(manifest.pdfs.map(p => p.filename).sort(), expectedPdfs, 'Manifest PDF identities mismatch');
  for (const pdf of manifest.pdfs) {
    const bytes = readFileSync(join(root, 'pdf', pdf.filename));
    assert.equal(sha256(bytes), pdf.sha256, `PDF hash mismatch: ${pdf.filename}`);
    assert.equal(bytes.length, pdf.byteSize, `PDF byteSize mismatch: ${pdf.filename}`);
  }
  const regenerated = buildSnapshot(join(root, 'pdf'));
  assert.deepEqual(manifest, regenerated.manifest, 'Manifest mismatch: provenance, trip blocks, anomaly resolutions or coverage changed');
  assert.equal(manifest.tables.length, 17, 'Exactly 17 tables required');
  assert.deepEqual(readdirSync(join(root, 'tables')).sort(), regenerated.tables.map(t => t.filename).sort(), 'Table file set mismatch');
  let trips = 0, cells = 0;
  for (const table of regenerated.tables) {
    const content = readFileSync(join(root, 'tables', table.filename), 'utf8');
    const [header, ...rows] = parseCSV(content);
    assert.deepEqual(header, ['row', 'name', 'printed_stop_id', 'resolved_stop_id', ...table.trips.map(t => t.column)], `Trip header mismatch: ${table.filename}`);
    assert.equal(rows.length, table.rowCount, `Row count mismatch: ${table.filename}`);
    rows.forEach((row, i) => {
      assert.equal(row.length, header.length, `CSV width mismatch: ${table.filename}`);
      assert.equal(row[0], String(i + 1), 'Row order mismatch');
      assert.match(row[2], /^\d{7}-\d+$/, 'Malformed printed_stop_id');
      assert.ok(row[1].length > 0, 'Missing printed stop name');
    });
    validateTimes(rows.map(row => row.slice(4)), table.filename);
    assert.equal(content, table.content, `Source transcription mismatch: ${table.filename}; printed values and resolutions must match both PDF extraction paths`);
    trips += header.length - 4;
    cells += rows.reduce((sum, row) => sum + row.length - 4, 0);
  }
  assert.equal(trips, 121, 'Exactly 121 trips required');
  assert.equal(cells, 2140, 'Exactly 2140 timetable cells required');
  const anomalies = manifest.anomalies;
  assert.equal(anomalies.filter(a => a.state === 'STOP_ID_MISMATCH' && a.status === 'RESOLVED' && a.printedValue === '5900597-1' && a.resolvedValue === '5900013-1').length, 3, 'Aiand split required in all three day types');
  const napiResolutions = anomalies.filter(a => a.state === 'SOURCE_CONFLICT');
  assert.equal(napiResolutions.length, 6, 'Both Napi source rows require evidence on all three day types');
  for (const table of ['line1-er-loop', 'line1-l-loop', 'line1-p-loop']) {
    for (const row of [17, 18]) {
      const a = napiResolutions.find(a => a.table === table && a.row === row);
      assert.ok(a, `Missing Napi resolution: ${table} row ${row}`);
      assert.equal(a.printedValue, '5900508-1', 'Napi printed evidence must not change');
      assert.equal(a.resolvedValue, row === 17 ? '5900507-1' : '5900508-1', 'Napi resolved identity mismatch');
      assert.equal(a.status, 'RESOLVED');
      assert.ok(a.authority && a.evidence?.sourceUrl === 'https://api.peatus.ee/routing/v1/routers/estonia/index/graphql', 'Napi requires approved official evidence');
      assert.equal(a.evidence.position, row);
      assert.equal(a.evidence.stopCode, a.resolvedValue);
    }
  }
  assert.equal(anomalies.filter(a => a.state === 'SUSPECTED_TYPO' && a.printedValue === '06:04' && a.resolvedValue === null).length, 1, 'Printed Seminari 06:04 required');
  assert.equal(anomalies.filter(a => a.state === 'TRIP_KEY_ANOMALY' && a.status === 'UNRESOLVED').length, 1, 'Line 5 printed trip order anomaly required');
  assert.deepEqual(manifest.coverage.map(c => [c.line, c.dayType, c.status]), [['2', 'L', 'NO_SERVICE'], ['2', 'P', 'NO_SERVICE']], 'Line 2 L/P coverage mismatch');
  return { pdfs: 10, tables: 17, trips, cells };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(process.argv.length <= 3, 'Usage: node scripts/bus/validate-timetables.mjs [snapshot-folder]');
    const result = validateSnapshot(process.argv[2] ? resolve(process.argv[2]) : snapshotRoot);
    console.log(`${result.pdfs} PDFs\n${result.tables} tables\n${result.trips} trips\n${result.cells} timetable cells\nVALIDATION PASS`);
  } catch (error) { console.error(`VALIDATION FAIL: ${error.message}`); process.exitCode = 1; }
}
