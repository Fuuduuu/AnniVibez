import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const AUDIT_DIR = path.join(ROOT, 'docs', 'audit');
const GTFS_DIR = path.join(ROOT, '.artifacts', 'gtfs');
const CACHE_ZIP_PATH = path.join(GTFS_DIR, 'estonia_unified_gtfs.zip');
const DISCOVERY_PATH = path.join(AUDIT_DIR, 'route-geometry-source-discovery.json');
const PATTERN_MAP_PATH = path.join(AUDIT_DIR, 'route-pattern-stopid-map.json');
const SHAPES_PATH = path.join(GTFS_DIR, 'shapes.txt');
const OUTPUT_PATH = path.join(ROOT, 'src', 'data', 'routeShapes.js');

const TARGET_LINES = ['1', '2', '3', '5'];
const MAX_POINTS_PER_SHAPE = 700;

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

async function streamCsvRows(filePath, onHeader, onRow) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let hasHeader = false;
  for await (const rawLine of rl) {
    const line = rawLine.replace(/\uFEFF/g, '');
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    if (!hasHeader) {
      hasHeader = true;
      onHeader(cells);
      continue;
    }
    onRow(cells);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walkFindByBasename(rootDir, fileName) {
  const target = fileName.toLowerCase();
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase() === target) {
        return full;
      }
    }
  }
  return null;
}

function ensureShapesTxt(zipPath, destinationDir) {
  if (fs.existsSync(path.join(destinationDir, 'shapes.txt'))) return;

  const extractRoot = path.join(destinationDir, '_extract_shapes');
  fs.mkdirSync(extractRoot, { recursive: true });

  const tarRes = spawnSync('tar', ['-xf', zipPath, '-C', extractRoot], { encoding: 'utf8' });
  let extracted = !tarRes.error && tarRes.status === 0;

  if (!extracted) {
    const zipQ = zipPath.replace(/'/g, "''");
    const outQ = extractRoot.replace(/'/g, "''");
    const psCmd = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `[System.IO.Compression.ZipFile]::ExtractToDirectory('${zipQ}','${outQ}',$true)`,
    ].join('; ');
    const psRes = spawnSync('powershell', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8' });
    extracted = !psRes.error && psRes.status === 0;
    if (!extracted) {
      throw new Error(
        `Could not extract GTFS ZIP for shapes.txt: ${psRes.stderr || psRes.stdout || tarRes.stderr || tarRes.stdout || 'unknown error'}`
      );
    }
  }

  const foundShapes = walkFindByBasename(extractRoot, 'shapes.txt');
  if (!foundShapes) {
    throw new Error('shapes.txt not found in cached GTFS ZIP.');
  }

  fs.copyFileSync(foundShapes, path.join(destinationDir, 'shapes.txt'));
}

function simplifyPoints(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const result = [];
  const step = Math.ceil((points.length - 1) / (maxPoints - 1));
  result.push(points[0]);
  for (let i = step; i < points.length - 1; i += step) {
    result.push(points[i]);
  }
  const last = points[points.length - 1];
  const prev = result[result.length - 1];
  if (!prev || prev.lat !== last.lat || prev.lon !== last.lon) {
    result.push(last);
  }
  return result;
}

function toNum6(value) {
  return Number(Number(value).toFixed(6));
}

function makeDirectionLabel(lineNumber, patternName) {
  return `Liin ${lineNumber} · ${patternName}`;
}

async function main() {
  if (!fs.existsSync(CACHE_ZIP_PATH)) {
    throw new Error(`Missing GTFS cache ZIP: ${path.relative(ROOT, CACHE_ZIP_PATH)}`);
  }

  const discovery = readJson(DISCOVERY_PATH);
  const patternMap = readJson(PATTERN_MAP_PATH);

  if (discovery?.recommendation?.result !== 'GTFS shapes usable') {
    throw new Error(`Geometry recommendation is not usable: ${discovery?.recommendation?.result || 'unknown'}`);
  }

  await fsp.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fsp.mkdir(GTFS_DIR, { recursive: true });

  ensureShapesTxt(CACHE_ZIP_PATH, GTFS_DIR);

  const selectedShapes = [];
  for (const lineNumber of TARGET_LINES) {
    const linePatterns = (patternMap?.patterns || []).filter((p) => String(p?.lineNumber || '') === lineNumber);
    const lineDiscovery = (discovery?.lines || []).find((l) => String(l?.lineNumber || '') === lineNumber);
    if (!lineDiscovery) throw new Error(`Missing discovery line data for line ${lineNumber}`);

    for (const pattern of linePatterns) {
      const examples = (lineDiscovery.shapePatternExamples || [])
        .filter((example) => String(example?.patternName || '') === String(pattern.patternName || ''))
        .sort((a, b) => Number(b.overlapScore || 0) - Number(a.overlapScore || 0));

      const selected = examples[0];
      if (!selected?.shapeId) {
        throw new Error(`No shapeId mapping for line ${lineNumber} pattern ${pattern.patternName}`);
      }

      selectedShapes.push({
        lineNumber,
        patternName: pattern.patternName,
        sourceFile: pattern.sourceFile,
        shapeId: selected.shapeId,
        overlapScore: Number(selected.overlapScore || 0),
        directionLabel: makeDirectionLabel(lineNumber, pattern.patternName),
        stopIds: (pattern.stops || []).map((stop) => String(stop.stopId || '').trim()).filter(Boolean),
      });
    }
  }

  const wantedShapeIds = new Set(selectedShapes.map((entry) => entry.shapeId));
  const pointsByShape = new Map();

  let idxShapeId = -1;
  let idxLat = -1;
  let idxLon = -1;
  let idxSeq = -1;

  await streamCsvRows(
    SHAPES_PATH,
    (headers) => {
      idxShapeId = headers.indexOf('shape_id');
      idxLat = headers.indexOf('shape_pt_lat');
      idxLon = headers.indexOf('shape_pt_lon');
      idxSeq = headers.indexOf('shape_pt_sequence');
      if (idxShapeId < 0 || idxLat < 0 || idxLon < 0 || idxSeq < 0) {
        throw new Error('shapes.txt missing required GTFS columns.');
      }
    },
    (cells) => {
      const shapeId = String(cells[idxShapeId] || '').trim();
      if (!wantedShapeIds.has(shapeId)) return;
      const lat = Number(cells[idxLat]);
      const lon = Number(cells[idxLon]);
      const seq = Number(cells[idxSeq]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(seq)) return;

      if (!pointsByShape.has(shapeId)) pointsByShape.set(shapeId, []);
      pointsByShape.get(shapeId).push({ seq, lat, lon });
    }
  );

  const routeShapesByLine = Object.fromEntries(TARGET_LINES.map((line) => [line, []]));

  for (const selected of selectedShapes) {
    const shapeRows = pointsByShape.get(selected.shapeId) || [];
    shapeRows.sort((a, b) => a.seq - b.seq);

    const rawPoints = shapeRows.map((point) => ({
      lat: toNum6(point.lat),
      lon: toNum6(point.lon),
    }));

    const points = simplifyPoints(rawPoints, MAX_POINTS_PER_SHAPE);
    if (!points.length) {
      throw new Error(`Selected shape ${selected.shapeId} has no geometry points.`);
    }
    if (!selected.stopIds.length) {
      throw new Error(`Pattern ${selected.patternName} has no stopIds.`);
    }

    routeShapesByLine[selected.lineNumber].push({
      lineNumber: selected.lineNumber,
      patternName: selected.patternName,
      directionLabel: selected.directionLabel,
      sourceFile: selected.sourceFile,
      shapeId: selected.shapeId,
      overlapScore: Number(selected.overlapScore.toFixed(3)),
      stopIds: selected.stopIds,
      points,
    });
  }

  for (const line of TARGET_LINES) {
    routeShapesByLine[line].sort((a, b) => a.patternName.localeCompare(b.patternName, 'et'));
  }

  const output = [
    '// Auto-generated by scripts/generate-route-shapes.mjs',
    '// Source: docs/audit/route-geometry-source-discovery.json + docs/audit/route-pattern-stopid-map.json',
    `// Generated: ${new Date().toISOString()}`,
    'export const ROUTE_SHAPES_BY_LINE = ' + JSON.stringify(routeShapesByLine, null, 2) + ';',
    '',
  ].join('\n');

  await fsp.writeFile(OUTPUT_PATH, output, 'utf8');

  const counts = Object.fromEntries(
    TARGET_LINES.map((line) => [
      line,
      routeShapesByLine[line].map((shape) => ({
        patternName: shape.patternName,
        shapeId: shape.shapeId,
        pointCount: shape.points.length,
      })),
    ])
  );

  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
  console.log(JSON.stringify(counts, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
