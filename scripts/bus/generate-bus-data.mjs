import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, validateTimes } from './validate-timetables.mjs';

const snapshotRoot = fileURLToPath(new URL('../../data/bus/rakvere/2026-09-13/', import.meta.url));
const dayTypes = ['E-R', 'L', 'P'];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const digest = value => createHash('sha256').update(value).digest('hex');
const ordered = entries => Object.fromEntries(entries.sort(([a], [b]) => compare(a, b)));

export function buildVisits(stops, stopTimes) {
  const visits = [];
  assert.equal(stops.length, stopTimes.length, 'Visit time count mismatch');
  stops.forEach((stop, i) => {
    assert.equal(stop.seq, stopTimes[i].seq, 'Visit time sequence mismatch');
    const previous = visits.at(-1);
    // Null means unresolved identity, never permission to merge two source rows.
    if (stop.code !== null && previous?.stopId === stop.code) {
      previous.sourceRows.push(stop.seq);
      previous.departure = stopTimes[i].time;
    } else {
      visits.push({ visitIndex: visits.length, stopId: stop.code, sourceRows: [stop.seq], arrival: stopTimes[i].time, departure: stopTimes[i].time });
    }
  });
  return visits.map((v, i) => ({ ...v, isFirst: i === 0, isLast: i === visits.length - 1,
    isIntermediate: i > 0 && i < visits.length - 1, hasLaterVisit: i < visits.length - 1 }));
}

function parseStops(table, csv, anomalies) {
  assert.equal(typeof csv, 'string', `Missing table: ${table.id}`);
  assert.ok(table.trips.length > 0, `Empty trips: ${table.id}`);
  assert.equal(new Set(table.trips.map(t => t.column)).size, table.trips.length, `Duplicate trip column: ${table.id}`);
  const [header, ...rows] = parseCSV(csv);
  assert.deepEqual(header, ['row', 'name', 'printed_stop_id', 'resolved_stop_id', ...table.trips.map(t => t.column)], `Trip header mismatch: ${table.id}`);
  assert.equal(rows.length, table.rowCount, `Row count mismatch: ${table.id}`);
  const stops = rows.map((row, i) => {
    assert.equal(row.length, header.length, `CSV width mismatch: ${table.id}`);
    assert.equal(row[0], String(i + 1), `Row order mismatch: ${table.id}`);
    const [, name, printedStopId, resolved] = row;
    assert.ok(name.length > 0, `Missing stop name: ${table.id}`);
    assert.match(printedStopId, /^\d{7}-\d+$/, `Invalid printed identity: ${table.id}`);
    const resolvedStopId = resolved || null;
    if (resolvedStopId !== null) assert.match(resolvedStopId, /^\d{7}-\d+$/, `Invalid resolved identity: ${table.id}`);
    const evidence = anomalies.filter(a => a.table === table.id && a.row === i + 1);
    const identityEvidence = evidence.filter(a => ['SOURCE_CONFLICT', 'STOP_ID_MISMATCH'].includes(a.state));
    assert.ok(identityEvidence.length <= 1, `Conflicting identity evidence: ${table.id} row ${i + 1}`);
    const resolution = identityEvidence[0];
    if (resolution) {
      assert.equal(printedStopId, resolution.printedValue, `Printed identity conflicts with manifest: ${table.id}`);
      assert.equal(resolvedStopId, resolution.resolvedValue, `Resolved identity conflicts with manifest: ${table.id}`);
      if (resolvedStopId === null) assert.equal(resolution.status, 'UNRESOLVED', 'Invalid unresolved identity status');
      else assert.ok(resolution.status === 'RESOLVED' && resolution.authority, 'Identity resolution requires explicit authority');
    } else {
      assert.equal(resolvedStopId, printedStopId, `Unapproved identity resolution: ${table.id} row ${i + 1}`);
    }
    return { seq: i + 1, name, code: resolvedStopId, printedStopId, resolvedStopId,
      identityStatus: resolvedStopId === null ? 'UNRESOLVED' : resolvedStopId === printedStopId ? 'AS_PRINTED' : 'RESOLVED',
      sourceRef: { table: table.id, pdf: table.sourcePdf, row: i + 1 }, anomalies: evidence };
  });
  validateTimes(rows.map(row => row.slice(4)), table.id);
  return { stops, rows };
}

export function generateModel(manifest, tables) {
  assert.equal(manifest.schemaVersion, 1, 'Unsupported source manifest version');
  assert.equal(new Set(manifest.tables.map(t => t.id)).size, manifest.tables.length, 'Duplicate table ID');
  assert.equal(new Set(manifest.pdfs.map(p => p.filename)).size, manifest.pdfs.length, 'Duplicate PDF reference');
  assert.deepEqual(Object.keys(tables).sort(), manifest.tables.map(t => t.id).sort(), 'Table set mismatch');
  const lines = [], patterns = new Map(), stopLookup = new Map();
  let cells = 0, tripCount = 0;
  for (const table of [...manifest.tables].sort((a, b) => compare(a.id, b.id))) {
    assert.ok(dayTypes.includes(table.dayType), `Unknown day type: ${table.id}`);
    const pdf = manifest.pdfs.find(p => p.filename === table.sourcePdf);
    assert.ok(pdf && pdf.line === table.line && pdf.dayType === table.dayType && pdf.tables.includes(table.id), `Invalid PDF reference: ${table.id}`);
    const { stops, rows } = parseStops(table, tables[table.id], manifest.anomalies);
    // Keep every occurrence in the identity sequence, including unresolved evidence.
    const sequence = JSON.stringify([table.line, stops.map(s => s.code === null ? ['UNRESOLVED', s.printedStopId] : ['RESOLVED', s.code])]);
    const patternId = `line${table.line}_${digest(sequence)}`;
    const sourceRef = { table: table.id, pdf: table.sourcePdf };
    const direction = stops.map(s => s.name).join(' - ');
    if (!patterns.has(patternId)) {
      patterns.set(patternId, { id: patternId, line: table.line, direction,
        stop_ids: stops.map(s => s.code),
        stops: stops.map(({ sourceRef: _source, anomalies: _anomalies, ...s }) => s), sourceRefs: [] });
    }
    patterns.get(patternId).sourceRefs.push(sourceRef);
    for (const stop of stops) {
      if (stop.code === null) continue;
      if (!stopLookup.has(stop.code)) stopLookup.set(stop.code, new Set());
      stopLookup.get(stop.code).add(stop.name);
    }
    const trips = table.trips.map((trip, c) => {
      assert.ok(typeof trip.printedReis === 'string' && trip.printedReis.length > 0 && typeof trip.block === 'string', `Invalid trip metadata: ${table.id}`);
      const stop_times = rows.map(row => ({ seq: Number(row[0]), time: row[c + 4] }));
      cells += stop_times.length;
      tripCount++;
      return { id: `${table.id}:${trip.column}`, no: trip.printedReis, block: trip.block, dayType: table.dayType,
        sourceRef: { ...sourceRef, column: trip.column }, stop_times, visits: buildVisits(stops, stop_times) };
    });
    lines.push({ line: table.line, service: table.dayType, direction, pattern_id: patternId,
      operator: pdf.operator, printedEffectiveDate: pdf.printedEffectiveDate,
      source: 'normalized-csv', sourceRef, stops, trips });
  }
  const lineNumbers = [...new Set([...lines.map(l => l.line), ...manifest.coverage.map(c => c.line)])].sort(compare);
  function coverageFor(lineNumber, selectedLines) {
    return Object.fromEntries(dayTypes.map(day => {
      const explicit = manifest.coverage.filter(c => c.line === lineNumber && c.dayType === day);
      assert.ok(explicit.length <= 1, 'Duplicate service coverage');
      const state = explicit[0]?.status;
      assert.ok(state === undefined || ['SCHEDULED', 'NO_SERVICE', 'UNKNOWN'].includes(state), 'Invalid service coverage');
      const scheduled = selectedLines.some(l => l.line === lineNumber && l.service === day && l.trips.length > 0);
      assert.ok(!scheduled || state === undefined || state === 'SCHEDULED', 'Service coverage conflicts with trips');
      return [day, scheduled ? 'SCHEDULED' : state === 'NO_SERVICE' ? 'NO_SERVICE' : 'UNKNOWN'];
    }));
  }
  const coverage = Object.fromEntries(lineNumbers.map(line => [line, coverageFor(line, lines)]));
  for (const p of patterns.values()) {
    p.coverage = { schedule_source: 'normalized-csv', service_status: coverageFor(p.line, lines.filter(l => l.pattern_id === p.id)) };
    p.coverage.available_services = dayTypes.filter(day => p.coverage.service_status[day] === 'SCHEDULED');
  }
  const by_code = ordered([...stopLookup].map(([id, names]) => {
    const sorted = [...names].sort(compare);
    return [id, { name: sorted[0], names: sorted, coordinateStatus: 'NOT_IN_SOURCE' }];
  }));
  // Groups are display metadata only; trips and patterns keep concrete stop IDs.
  const groupNames = [...new Set(Object.values(by_code).flatMap(s => s.names))].sort(compare);
  const groups = groupNames.map(name => ({ name, codes: Object.keys(by_code).filter(id => by_code[id].names.includes(name)), purpose: 'DISPLAY_ONLY' }));
  return { by_code, groups, patterns: [...patterns.values()].sort((a, b) => compare(a.id, b.id)), lines, dayTypes: [...dayTypes], coverage,
    anomalies: structuredClone(manifest.anomalies),
    meta: { schemaVersion: 1, scope: 'GENERATED_CANDIDATE_NOT_RUNTIME', snapshotDate: manifest.snapshotDate,
      sourceCounts: { pdfs: manifest.pdfs.length, tables: lines.length, trips: tripCount, cells },
      sourcePdfs: [...manifest.pdfs].sort((a, b) => compare(a.filename, b.filename)),
      coverageEvidence: [...manifest.coverage].sort((a, b) => compare(`${a.line}:${a.dayType}`, `${b.line}:${b.dayType}`)) } };
}

export function serializeModel(model) {
  return `// Generated from manifest.json and tables/*.csv. Do not edit.\nexport const BUS_DATA = ${JSON.stringify(model, null, 2)};\n`;
}

export function generateCandidate(root = snapshotRoot) {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  assert.ok(manifest.tables.every(t => /^[a-z0-9-]+\.csv$/.test(t.filename)), 'Invalid table filename');
  assert.deepEqual(readdirSync(join(root, 'tables')).sort(), manifest.tables.map(t => t.filename).sort(), 'Table file set mismatch');
  const tables = Object.fromEntries(manifest.tables.map(t => [t.id, readFileSync(join(root, 'tables', t.filename), 'utf8')]));
  const model = generateModel(manifest, tables);
  const output = serializeModel(model);
  const directory = join(root, 'generated');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'busData.generated.js');
  writeFileSync(path, output, 'utf8');
  return { path, sha256: digest(output), ...model.meta.sourceCounts, patterns: Object.keys(model.patterns).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(process.argv.length <= 3, 'Usage: node scripts/bus/generate-bus-data.mjs [snapshot-folder]');
    console.log(JSON.stringify(generateCandidate(process.argv[2] ? resolve(process.argv[2]) : snapshotRoot), null, 2));
  } catch (error) { console.error(`GENERATION FAIL: ${error.message}`); process.exitCode = 1; }
}
