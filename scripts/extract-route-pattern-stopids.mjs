import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUS_DATA } from '../src/data/busData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SOURCE_DIR_REL = path.join('docs', 'audit', 'raw', 'peatus-ee');
const SOURCE_DIR = path.join(repoRoot, SOURCE_DIR_REL);
const OUT_JSON = path.join(repoRoot, 'docs', 'audit', 'route-pattern-stopid-map.json');
const OUT_MD = path.join(repoRoot, 'docs', 'audit', 'route-pattern-stopid-report.md');

const LINE_REGEX = /^Liin\s*(\d+)/i;
const STOP_ID_REGEX = /^[0-9]+-[0-9]+$/;
const TIME_REGEX = /^\d{1,2}:\d{2}$/;
const DEPARTURE_MARKER = 'departure time was at';

function toLines(text) {
  return text.split(/\r?\n/);
}

function firstNonEmpty(lines) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function parseLineNumber(filename) {
  const match = filename.match(LINE_REGEX);
  return match ? match[1] : '';
}

function findMarkerIndex(lines, fromIdx) {
  for (let i = fromIdx; i >= 0; i -= 1) {
    if (lines[i].trim().toLowerCase() === DEPARTURE_MARKER) {
      return i;
    }
  }
  return -1;
}

function findStopNameBeforeMarker(lines, markerIdx) {
  for (let i = markerIdx - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    return trimmed;
  }
  return '';
}

function findTimeBetween(lines, fromIdx, toIdx) {
  for (let i = fromIdx; i <= toIdx; i += 1) {
    const trimmed = lines[i].trim();
    if (TIME_REGEX.test(trimmed)) return trimmed;
  }
  return null;
}

function parseStops(lines, sourceFile) {
  const stops = [];
  for (let i = 0; i < lines.length; i += 1) {
    const candidate = lines[i].trim();
    if (!STOP_ID_REGEX.test(candidate)) continue;

    const stopId = candidate;
    const markerIdx = findMarkerIndex(lines, i - 1);
    const stopName = markerIdx >= 0 ? findStopNameBeforeMarker(lines, markerIdx) : '';
    const time = markerIdx >= 0 ? findTimeBetween(lines, markerIdx + 1, i - 1) : null;
    const presentInBusData = Object.prototype.hasOwnProperty.call(BUS_DATA.by_code || {}, stopId);

    stops.push({
      seq: stops.length + 1,
      stopName: stopName || '(unknown)',
      stopId,
      time,
      sourceFile,
      presentInBusData,
    });
  }
  return stops;
}

function sortLineNumbers(values) {
  return [...new Set(values)]
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));
}

function collectDuplicates(stops) {
  const byName = new Map();
  for (const stop of stops) {
    const key = stop.stopName;
    if (!byName.has(key)) byName.set(key, new Set());
    byName.get(key).add(stop.stopId);
  }
  return [...byName.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([stopName, ids]) => ({
      stopName,
      stopIds: [...ids].sort(),
    }))
    .sort((a, b) => a.stopName.localeCompare(b.stopName, 'et'));
}

function stopIdSetsByLine(stops) {
  const map = new Map();
  for (const stop of stops) {
    const lineNo = stop.lineNumber;
    if (!map.has(lineNo)) map.set(lineNo, new Map());
    const stopMap = map.get(lineNo);
    if (!stopMap.has(stop.stopName)) stopMap.set(stop.stopName, new Set());
    stopMap.get(stop.stopName).add(stop.stopId);
  }
  return map;
}

function formatIdList(setLike) {
  return [...setLike].sort().join(', ');
}

function makeDirectionSection(stopMapByLine) {
  const wanted = [
    { line: '1', names: ['Näpi', 'Narva', 'Kauba', 'Raudteejaam', 'Polikliinik'] },
    { line: '3', names: ['Õie', 'Tulika', 'Haigla', 'Tõrma kalmistu'] },
    { line: '5', names: ['Kivi', 'Piiri', 'Kungla', 'Polikliinik', 'Kesk', 'Teater'] },
  ];

  const lines = [];
  for (const item of wanted) {
    lines.push(`### Liin ${item.line}`);
    const perLine = stopMapByLine.get(item.line) || new Map();
    for (const name of item.names) {
      const ids = perLine.get(name);
      lines.push(ids ? `- ${name}: ${formatIdList(ids)}` : `- ${name}: (not found in parsed files)`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildReport(mapData) {
  const allStops = mapData.patterns.flatMap(pattern =>
    pattern.stops.map(stop => ({
      ...stop,
      lineNumber: pattern.lineNumber,
      patternName: pattern.patternName,
    }))
  );

  const missing = allStops.filter(stop => !stop.presentInBusData);
  const duplicates = collectDuplicates(allStops);
  const stopMapByLine = stopIdSetsByLine(allStops);

  const patternRows = mapData.patterns
    .map(
      pattern =>
        `| ${pattern.lineNumber} | ${pattern.patternName} | ${pattern.sourceFile} | ${pattern.stops.length} |`
    )
    .join('\n');

  const duplicateRows =
    duplicates.length > 0
      ? duplicates.map(item => `| ${item.stopName} | ${item.stopIds.join(', ')} |`).join('\n')
      : '| (none) | - |';

  const missingRows =
    missing.length > 0
      ? missing.map(stop => `- ${stop.stopId} (${stop.stopName}) in ${stop.sourceFile}`).join('\n')
      : '- (none)';

  return [
    '# Route Pattern StopId Audit',
    '',
    `Generated: ${mapData.generatedAt}`,
    `Source dir: \`${mapData.sourceDir}\``,
    '',
    '## Parsed patterns',
    '',
    '| lineNumber | patternName | sourceFile | stopCount |',
    '|---|---|---|---:|',
    patternRows,
    '',
    '## StopIds missing from busData',
    '',
    `Count: **${missing.length}**`,
    '',
    missingRows,
    '',
    '## Duplicate stop names with multiple stopIds',
    '',
    '| stopName | stopIds |',
    '|---|---|',
    duplicateRows,
    '',
    '## Direction-pair examples',
    '',
    makeDirectionSection(stopMapByLine).trimEnd(),
    '',
    '## Note',
    '',
    'This audit establishes route-pattern / direction truth, not physical coordinate correctness.',
    '',
  ].join('\n');
}

async function main() {
  const fileNames = (await fs.readdir(SOURCE_DIR))
    .filter(name => name.toLowerCase().endsWith('.txt'))
    .sort((a, b) => a.localeCompare(b, 'et'));

  const patterns = [];
  for (const fileName of fileNames) {
    const fullPath = path.join(SOURCE_DIR, fileName);
    const text = await fs.readFile(fullPath, 'utf8');
    const lines = toLines(text);
    const patternName = firstNonEmpty(lines);
    const lineNumber = parseLineNumber(fileName);
    const stops = parseStops(lines, fileName);

    patterns.push({
      lineNumber,
      patternName,
      sourceFile: fileName,
      stops,
    });
  }

  const allStops = patterns.flatMap(pattern => pattern.stops);
  const uniqueStopIds = new Set(allStops.map(stop => stop.stopId));
  const lineNumbers = sortLineNumbers(patterns.map(pattern => pattern.lineNumber));

  const mapData = {
    generatedAt: new Date().toISOString(),
    sourceDir: SOURCE_DIR_REL.replaceAll('\\', '/'),
    patterns,
    summary: {
      patternCount: patterns.length,
      stopRefCount: allStops.length,
      uniqueStopIdCount: uniqueStopIds.size,
      lineNumbers,
    },
  };

  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
  await fs.writeFile(OUT_JSON, `${JSON.stringify(mapData, null, 2)}\n`, 'utf8');

  const report = buildReport(mapData);
  await fs.writeFile(OUT_MD, report, 'utf8');

  const missingCount = allStops.filter(stop => !stop.presentInBusData).length;
  console.log(`patterns=${mapData.summary.patternCount}`);
  console.log(`stopRefs=${mapData.summary.stopRefCount}`);
  console.log(`uniqueStopIds=${mapData.summary.uniqueStopIdCount}`);
  console.log(`missingStopIds=${missingCount}`);
}

await main();
