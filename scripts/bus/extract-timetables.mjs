import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const snapshotRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/bus/rakvere/2026-09-13');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const dayNames = { 'E-R': 'esmaspäev kuni reede', L: 'laupäev', P: 'pühapäev, riiklikud pühad' };
const routes = { '1': ['loop'], '2': ['piira-lihakombinaat', 'lihakombinaat-piira'], '3': ['keskvaljak', 'koidula'], '5': ['ragavere-pohjakeskus', 'pohjakeskus-ragavere'] };
export const sources = ['1', '2', '3', '5'].flatMap(line => (line === '2' ? ['E-R'] : ['E-R', 'L', 'P']).map(dayType => {
  const filename = line === '5' ? `Llinnaliin 5 sõiduplaan ${dayType} alates 011225.pdf` : `Linnaliin nr ${line} ${dayNames[dayType]}.pdf`;
  return {
    filename, line, dayType,
    // HostUrl values observed in the original PDFs' Windows Zone.Identifier streams.
    sourceUrl: `https://rakvere.ee/sites/default/files/documents/${line === '5' ? '2025-12' : '2025-08'}/${encodeURIComponent(filename)}`,
    tableIds: routes[line].map(route => `line${line}-${dayType === 'E-R' ? 'er' : dayType.toLowerCase()}-${route}`),
  };
}));

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const HINT = /^\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?$/;
const STOP = /^\d{7}-\d+$/;
const linesOf = text => text.replace(/\r/g, '').split(/[\n\f]/).filter(l => l.trim());

function finish(table, tables) {
  if (!table) return;
  assert.ok(table.rows.length, 'Empty timetable');
  assert.equal(new Set(table.trips).size, table.trips.length, 'Duplicate printed trip ID within table');
  assert.ok(table.trips.every(t => /^\d{2}$/.test(t)), 'Malformed printed trip ID');
  assert.equal(table.blocks.length, table.trips.length, 'Trip block count mismatch');
  assert.ok(table.blocks.every(b => /^[1-5]-\d{2}$/.test(b)), 'Malformed trip block');
  tables.push(table);
}

// Xpdf -table preserves physical columns. Discover columns from the Reis header,
// not hard-coded page coordinates; never interpret segment hints as departures.
export function parseTableText(text) {
  const tables = [], lines = linesOf(text);
  let table, columns, inRows = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headings = [...line.matchAll(/\bReis\b/g)];
    if (headings.length) {
      finish(table, tables);
      columns = headings.map(m => m.index);
      const cells = value => columns.map((start, c) => value.slice(start, columns[c + 1]).trim());
      table = { trips: cells(lines[++i] ?? ''), blocks: cells(lines[++i] ?? ''), rows: [] };
      inRows = true;
      continue;
    }
    if (/Töötamise päevad/.test(line)) inRows = false;
    if (!inRows || !/^\s*\d+\s/.test(line)) continue;
    const prefix = line.slice(0, columns[0]).trim();
    const match = prefix.match(/^(\d+)\s+(.+?)\s+(?:\d+,\d+\s+)*(\d{7}-\d+)(?:\s+(.*))?$/);
    assert.ok(match, `Malformed table row: ${line}`);
    assert.ok(!match[4] || HINT.test(match[4]), `Unexpected travel hint: ${prefix}`);
    const times = columns.map((start, c) => line.slice(start, columns[c + 1]).trim());
    assert.ok(times.every(t => TIME.test(t)), `Malformed/missing time cell: ${line}`);
    const row = Number(match[1]);
    assert.equal(row, table.rows.length + 1, 'Non-consecutive source row');
    table.rows.push({ row, name: match[2], printedStopId: match[3], times });
  }
  finish(table, tables);
  return tables;
}

// Independent content-stream parser: no physical column slicing or shared row
// parser. Agreement with -table is mandatory for every source row and trip header.
export function parseRawText(text) {
  const tables = [], lines = linesOf(text);
  let table, inRows = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (/^Reis(?:\s+Reis)*$/.test(line)) {
      finish(table, tables);
      table = { trips: lines[++i].trim().split(/\s+/), blocks: lines[++i].trim().split(/\s+/), rows: [] };
      assert.equal(table.trips.length, line.split(/\s+/).length, 'Reis header count mismatch');
      inRows = true;
      continue;
    }
    if (/Töötamise päevad/.test(line)) inRows = false;
    if (!inRows || !/^\d+\s/.test(line)) continue;
    if (!/\b\d{7}-\d+\b/.test(line)) {
      const continuation = lines[i + 1]?.trim();
      assert.ok(/^(?:\d+,\d+\s+)+\d{7}-\d+\s/.test(continuation ?? ''), `Unverified raw row continuation: ${line}`);
      line += ` ${continuation}`;
      i++;
    }
    const tokens = line.split(/\s+/), row = Number(tokens.shift());
    const stopIndex = tokens.findIndex(t => STOP.test(t));
    assert.ok(stopIndex > 0, `Missing printed stop_id: ${line}`);
    const prefix = tokens.slice(0, stopIndex);
    while (/^\d+,\d+$/.test(prefix.at(-1))) prefix.pop();
    const tail = tokens.slice(stopIndex + 1);
    if (tail.length === table.trips.length + 1) assert.ok(HINT.test(tail.shift()), 'Unexpected raw travel hint');
    assert.equal(tail.length, table.trips.length, `Time cell count mismatch: ${line}`);
    assert.ok(tail.every(t => TIME.test(t)), `Malformed time cell: ${line}`);
    assert.equal(row, table.rows.length + 1, 'Raw source row sequence mismatch');
    table.rows.push({ row, name: prefix.join(' '), printedStopId: tokens[stopIndex], times: tail });
  }
  finish(table, tables);
  return tables;
}

export function reconcileExtractions(physical, raw, source) {
  const tables = structuredClone(physical), artifacts = [];
  tables.forEach((table, i) => table.rows.forEach((row, r) => {
    const other = raw[i]?.rows[r];
    if (source.tableIds[i] === 'line3-er-keskvaljak' && row.row === 10 &&
        row.printedStopId === '5900056-1' && row.name === 'Carl Robert Jakobs5o,n1i82' &&
        other?.name === 'Carl Robert Jakobsoni') {
      artifacts.push({ state: 'EXTRACTION_ARTIFACT', status: 'RESOLVED_EXTRACTION_ONLY', table: source.tableIds[i], row: row.row, field: 'name', tableModeValue: row.name, rawModeValue: other.name, resolvedValue: other.name, evidence: 'DATA01 PDF visual inspection and raw content stream: distance 5,182 overlaps the stop-name cell in table-mode extraction. No source identity or timetable value changed.' });
      row.name = other.name;
    }
  }));
  assert.deepEqual(tables, raw, `Extraction path mismatch: ${source.filename ?? source.tableIds.join(',')}`);
  return { tables, artifacts };
}

export function normalizeTable(source, { line, id }) {
  const anomalies = [];
  if (line === '1' && source.rows.some(row => row.name === 'Näpi')) {
    assert.ok(['line1-er-loop', 'line1-l-loop', 'line1-p-loop'].includes(id), 'Napi resolution requires an approved table');
    assert.equal(source.rows.length, 32, 'Napi resolution requires the verified 32-position pattern');
    assert.deepEqual(source.rows.filter(row => row.name === 'Näpi').map(row => row.row), [17, 18], 'Napi position mismatch');
    assert.deepEqual(source.rows.slice(15, 19).map(row => row.printedStopId), ['5900485-1', '5900508-1', '5900508-1', '5900484-1'], 'Napi position context mismatch');
  }
  const rows = source.rows.map(row => {
    let resolvedStopId = row.printedStopId;
    if (line === '5' && row.name === 'Aiand') {
      assert.equal(row.printedStopId, '5900597-1', 'Aiand printed identity changed; review required');
      resolvedStopId = '5900013-1';
      anomalies.push({ state: 'STOP_ID_MISMATCH', status: 'RESOLVED', table: id, row: row.row, printedValue: row.printedStopId, resolvedValue: resolvedStopId, authority: 'DATA01 explicit human decision: Aiand only; printed source retained.' });
    }
    if (line === '1' && row.name === 'Näpi') {
      assert.equal(row.printedStopId, '5900508-1', 'Napi printed identity changed; review required');
      resolvedStopId = row.row === 17 ? '5900507-1' : '5900508-1';
      anomalies.push({ state: 'SOURCE_CONFLICT', status: 'RESOLVED', table: id, row: row.row,
        printedValue: row.printedStopId, resolvedValue: resolvedStopId,
        reason: 'PDF repeats 5900508-1. Live Peatus line-1 pattern distinguishes positions 17 and 18; printed IDs and all times retained, with no visit collapse.',
        authority: 'COORD01 scope amendment explicitly approves this evidence-backed position-specific resolution.',
        evidence: { sourceUrl: 'https://api.peatus.ee/routing/v1/routers/estonia/index/graphql',
          observedAt: '2026-09-13T11:21:47Z', routeId: 'estonia:c6d03d4884b9ed8b357a2728e233944b',
          patternId: 'estonia:c6d03d4884b9ed8b357a2728e233944b:1:01', position: row.row,
          gtfsId: row.row === 17 ? 'estonia:109242' : 'estonia:32522', stopCode: resolvedStopId,
          query: '{ route(id:"estonia:c6d03d4884b9ed8b357a2728e233944b") { gtfsId shortName longName patterns { code stops { gtfsId code name } } } }' } });
    }
    if (id === 'line2-er-piira-lihakombinaat' && row.name === 'Seminari') {
      assert.equal(row.times[source.trips.indexOf('01')], '06:04', 'Seminari printed 06:04 changed');
      anomalies.push({ state: 'SUSPECTED_TYPO', status: 'UNRESOLVED', table: id, row: row.row, trip: '01', printedValue: '06:04', resolvedValue: null, reason: 'Keep the printed 06:04; do not substitute 06:01.' });
    }
    return { ...row, resolvedStopId };
  });
  if (source.trips.some((t, i) => i > 0 && Number(t) < Number(source.trips[i - 1]))) {
    anomalies.push({ state: 'TRIP_KEY_ANOMALY', status: 'UNRESOLVED', table: id, printedValue: source.trips, resolvedValue: null, reason: 'Printed column order retained, including Reis 14 before Reis 12; no renumbering or sorting.' });
  }
  return { ...source, rows, anomalies };
}

const csvCell = value => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
export function toCSV(table) {
  return [
    ['row', 'name', 'printed_stop_id', 'resolved_stop_id', ...table.trips.map(t => `reis_${t}`)],
    ...table.rows.map(r => [r.row, r.name, r.printedStopId, r.resolvedStopId, ...r.times]),
  ].map(row => row.map(csvCell).join(',')).join('\n') + '\n';
}

function pdftotext(file, mode) {
  try {
    return execFileSync(process.env.PDFTOTEXT || 'pdftotext', [mode, '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000, windowsHide: true });
  } catch (error) {
    throw new Error(`PDF extraction failed for ${file}. Requires Xpdf pdftotext (-table and -raw); set PDFTOTEXT to its executable path. ${error.message}`);
  }
}

export function buildSnapshot(pdfDirectory) {
  for (const source of sources) assert.ok(existsSync(join(pdfDirectory, source.filename)), `Missing source PDF: ${source.filename}`);
  const pdfs = [], tables = [], anomalies = [];
  for (const source of sources) {
    const file = join(pdfDirectory, source.filename), bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', `Invalid PDF: ${source.filename}`);
    const physicalText = pdftotext(file, '-table');
    const compared = reconcileExtractions(parseTableText(physicalText), parseRawText(pdftotext(file, '-raw')), source);
    const physical = compared.tables;
    anomalies.push(...compared.artifacts);
    assert.equal(physical.length, source.tableIds.length, `Table count mismatch: ${source.filename}`);
    const printedEffectiveDate = physicalText.match(/Sõiduplaan kehtib:\s*(\d{2}\.\d{2}\.\d{4})/)?.[1];
    const operator = physicalText.match(/Liini teenindab:\s*([^\r\n]+)/)?.[1].trim();
    assert.ok(printedEffectiveDate && operator, `Missing printed provenance: ${source.filename}`);
    pdfs.push({ filename: source.filename, line: source.line, dayType: source.dayType, retrievedAt: '2026-09-13', printedEffectiveDate, operator, sha256: sha256(bytes), byteSize: bytes.length, sourceUrl: source.sourceUrl, tables: source.tableIds });
    physical.forEach((table, i) => {
      const id = source.tableIds[i], normalized = normalizeTable(table, { line: source.line, id });
      tables.push({ id, filename: `${id}.csv`, sourcePdf: source.filename, line: source.line, dayType: source.dayType, sourceTableIndex: i + 1, rowCount: table.rows.length, trips: table.trips.map((reis, c) => ({ column: `reis_${reis}`, printedReis: reis, block: table.blocks[c] })), content: toCSV(normalized) });
      anomalies.push(...normalized.anomalies);
    });
  }
  return { manifest: {
    schemaVersion: 1, snapshotDate: '2026-09-13', scope: 'SOURCE_ONLY_NOT_RUNTIME',
    provenance: { retrievedAt: 'Date supplied by the human for these ten local official-source PDFs; not inferred from printed effective dates or PDF creation metadata.', sourceUrls: 'Original local PDF Zone.Identifier HostUrl evidence, captured in DATA01.', printedValues: 'Never overwritten. resolved_stop_id is separate routing identity: DATA01 approves Aiand and COORD01 approves the evidence-backed Napi positions recorded in anomalies. Blank remains reserved for unresolved identities.' },
    extraction: { tool: 'Xpdf pdftotext', modes: ['-table', '-raw'], verification: 'AGREE_EXCEPT_EXPLICIT_NAME_EXTRACTION_ARTIFACT', layout: 'Reis-header-derived character columns independently checked against content-stream token rows; no page-coordinate overrides.', rawContinuation: 'A numbered name-only row may join one immediate distance/stop_id continuation; any name disagreement requires an explicit extraction artifact.', ignoredAsGates: ['segment travel hints', 'footer total duration'] },
    pdfs, tables: tables.map(({ content, ...metadata }) => metadata),
    coverage: ['L', 'P'].map(dayType => ({ line: '2', dayType, status: 'NO_SERVICE', authority: 'DATA01 explicit human decision for this snapshot; not inferred from missing generated trips.' })),
    anomalies,
  }, tables };
}

export function writeSnapshot(sourceDirectory, outputDirectory = snapshotRoot) {
  // Validate the whole source set and both modes before writing any output.
  const snapshot = buildSnapshot(sourceDirectory);
  const manifestFile = join(outputDirectory, 'manifest.json');
  const allowedTables = snapshot.tables.map(t => t.filename);
  if (existsSync(join(outputDirectory, 'tables'))) {
    assert.ok(readdirSync(join(outputDirectory, 'tables')).every(f => allowedTables.includes(f)), 'Unexpected table file; refusing to overwrite/clean');
  }
  mkdirSync(join(outputDirectory, 'pdf'), { recursive: true });
  mkdirSync(join(outputDirectory, 'tables'), { recursive: true });
  for (const source of sources) {
    const from = join(sourceDirectory, source.filename), to = join(outputDirectory, 'pdf', source.filename);
    if (resolve(from) !== resolve(to)) {
      if (existsSync(to)) assert.equal(sha256(readFileSync(to)), sha256(readFileSync(from)), 'Existing PDF differs; refusing overwrite');
      else copyFileSync(from, to);
    }
  }
  for (const table of snapshot.tables) writeFileSync(join(outputDirectory, 'tables', table.filename), table.content, 'utf8');
  writeFileSync(manifestFile, JSON.stringify(snapshot.manifest, null, 2) + '\n', 'utf8');
  return snapshot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
      console.log('Usage: node scripts/bus/extract-timetables.mjs [--source-dir <ten-PDF-folder>] [--output <snapshot-folder>]\nDefaults to regenerating the checked-in snapshot. Requires Xpdf pdftotext on PATH or PDFTOTEXT.');
    } else {
      const options = {};
      for (let i = 0; i < args.length; i += 2) {
        assert.ok(['--source-dir', '--output'].includes(args[i]) && args[i + 1], 'Unknown/missing extraction argument');
        options[args[i]] = resolve(args[i + 1]);
      }
      const result = writeSnapshot(options['--source-dir'] || join(snapshotRoot, 'pdf'), options['--output'] || snapshotRoot);
      console.log(`Extracted ${result.manifest.pdfs.length} PDFs into ${result.tables.length} tables; all times, stop IDs and trip headers agree across both modes; ${result.manifest.anomalies.filter(a => a.state === 'EXTRACTION_ARTIFACT').length} explicit name-extraction artifact(s).`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
