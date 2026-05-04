import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import https from 'node:https';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const AUDIT_DIR = path.join(ROOT, 'docs', 'audit');
const GTFS_DIR = path.join(ROOT, '.artifacts', 'gtfs');
const SOURCE_DISCOVERY_PATH = path.join(AUDIT_DIR, 'gtfs-source-discovery.json');
const ROUTE_PATTERN_MAP_PATH = path.join(AUDIT_DIR, 'route-pattern-stopid-map.json');
const OUTPUT_JSON_PATH = path.join(AUDIT_DIR, 'route-geometry-source-discovery.json');
const OUTPUT_REPORT_PATH = path.join(AUDIT_DIR, 'route-geometry-source-discovery-report.md');
const CACHE_ZIP_PATH = path.join(GTFS_DIR, 'estonia_unified_gtfs.zip');

const TARGET_LINES = ['1', '2', '3', '5'];
const REQUIRED_GTFS_FILES = ['stops.txt', 'routes.txt', 'trips.txt', 'shapes.txt', 'stop_times.txt'];

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

function downloadFile(url, destination, depth = 0) {
  if (depth > 6) throw new Error(`Too many redirects for ${url}`);
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        resolve(downloadFile(new URL(res.headers.location, url).toString(), destination, depth + 1));
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`Download failed ${url} (${status})`));
        return;
      }
      const file = fs.createWriteStream(destination);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
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

function ensureExtractedFiles(zipPath, destinationDir, files) {
  const missing = files.filter((f) => !fs.existsSync(path.join(destinationDir, f)));
  if (!missing.length) return [];

  const extractRoot = path.join(destinationDir, '_extract_full');
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
        `Could not extract GTFS ZIP: ${psRes.stderr || psRes.stdout || tarRes.stderr || tarRes.stdout || 'unknown error'}`
      );
    }
  }

  const stillMissing = [];
  for (const f of missing) {
    const found = walkFindByBasename(extractRoot, f);
    if (!found) {
      stillMissing.push(f);
      continue;
    }
    fs.copyFileSync(found, path.join(destinationDir, f));
  }
  return stillMissing;
}

function endpointFingerprint(shapeStat) {
  if (
    !shapeStat ||
    !Number.isFinite(shapeStat.startLat) ||
    !Number.isFinite(shapeStat.startLon) ||
    !Number.isFinite(shapeStat.endLat) ||
    !Number.isFinite(shapeStat.endLon)
  ) {
    return null;
  }
  return `${shapeStat.startLat.toFixed(4)},${shapeStat.startLon.toFixed(4)}->${shapeStat.endLat.toFixed(4)},${shapeStat.endLon.toFixed(4)}`;
}

function jaccardOverlap(setA, setB) {
  let inter = 0;
  for (const v of setA) {
    if (setB.has(v)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

function confidenceLabel(score) {
  if (score >= 0.75) return 'high';
  if (score >= 0.45) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

async function main() {
  await fsp.mkdir(AUDIT_DIR, { recursive: true });
  await fsp.mkdir(GTFS_DIR, { recursive: true });

  const sourceDiscovery = readJson(SOURCE_DISCOVERY_PATH);
  const routePatternMap = readJson(ROUTE_PATTERN_MAP_PATH);

  const recommendedSource =
    sourceDiscovery?.summary?.recommendedSource?.url ||
    sourceDiscovery?.results?.find((r) => r?.reachable && String(r?.contentType || '').includes('zip'))?.url ||
    null;

  let cacheUsed = fs.existsSync(CACHE_ZIP_PATH);
  let downloadedNow = false;
  if (!cacheUsed) {
    if (!recommendedSource) throw new Error('No recommended GTFS source found.');
    await downloadFile(recommendedSource, CACHE_ZIP_PATH);
    cacheUsed = true;
    downloadedNow = true;
  }

  const missingAfterExtract = ensureExtractedFiles(CACHE_ZIP_PATH, GTFS_DIR, REQUIRED_GTFS_FILES);
  const gtfsPath = Object.fromEntries(REQUIRED_GTFS_FILES.map((name) => [name, path.join(GTFS_DIR, name)]));
  const hasFile = Object.fromEntries(
    REQUIRED_GTFS_FILES.map((name) => [name, fs.existsSync(gtfsPath[name]) && !missingAfterExtract.includes(name)])
  );

  // Build route-pattern stop-code truth.
  const patternByLine = new Map();
  const targetStopIdsByLine = new Map(TARGET_LINES.map((line) => [line, new Set()]));

  for (const p of routePatternMap?.patterns || []) {
    const line = String(p?.lineNumber || '').trim();
    if (!TARGET_LINES.includes(line)) continue;
    if (!patternByLine.has(line)) patternByLine.set(line, []);

    const stopIdSet = new Set();
    for (const stop of p?.stops || []) {
      const stopId = String(stop?.stopId || '').trim();
      if (!stopId) continue;
      stopIdSet.add(stopId);
      targetStopIdsByLine.get(line).add(stopId);
    }

    patternByLine.get(line).push({
      patternName: p.patternName,
      sourceFile: p.sourceFile,
      stopIds: stopIdSet,
    });
  }

  // Parse stops.txt to map route-pattern stop_code -> GTFS stop_id used in stop_times.
  const stopIdToStopCode = new Map();
  const stopCodeToStopId = new Map();
  if (hasFile['stops.txt']) {
    let idxStopId = -1;
    let idxStopCode = -1;
    await streamCsvRows(
      gtfsPath['stops.txt'],
      (headers) => {
        idxStopId = headers.indexOf('stop_id');
        idxStopCode = headers.indexOf('stop_code');
      },
      (cells) => {
        const stopId = String(cells[idxStopId] || '').trim();
        const stopCode = String(cells[idxStopCode] || '').trim();
        if (!stopId || !stopCode) return;
        stopIdToStopCode.set(stopId, stopCode);
        if (!stopCodeToStopId.has(stopCode)) {
          stopCodeToStopId.set(stopCode, stopId);
        }
      }
    );
  }

  const targetGtfsStopIdsByLine = new Map(TARGET_LINES.map((line) => [line, new Set()]));
  const unmappedPatternStopCodes = [];
  for (const line of TARGET_LINES) {
    for (const stopCode of targetStopIdsByLine.get(line)) {
      const gtfsStopId = stopCodeToStopId.get(stopCode);
      if (!gtfsStopId) {
        unmappedPatternStopCodes.push({ line, stopCode });
        continue;
      }
      targetGtfsStopIdsByLine.get(line).add(gtfsStopId);
    }
  }

  const stopIdToLines = new Map();
  for (const line of TARGET_LINES) {
    for (const gtfsStopId of targetGtfsStopIdsByLine.get(line)) {
      if (!stopIdToLines.has(gtfsStopId)) stopIdToLines.set(gtfsStopId, new Set());
      stopIdToLines.get(gtfsStopId).add(line);
    }
  }

  // 1) Scan stop_times and collect only trips that touch our target stopId universe.
  const candidateTripLineCounts = new Map(); // tripId -> Map(line -> count)
  const candidateTripLineStops = new Map(); // tripId -> Map(line -> Set(stopId))
  if (hasFile['stop_times.txt']) {
    let idxTripId = -1;
    let idxStopId = -1;
    await streamCsvRows(
      gtfsPath['stop_times.txt'],
      (headers) => {
        idxTripId = headers.indexOf('trip_id');
        idxStopId = headers.indexOf('stop_id');
      },
      (cells) => {
        const tripId = String(cells[idxTripId] || '').trim();
        const gtfsStopId = String(cells[idxStopId] || '').trim();
        if (!tripId || !gtfsStopId) return;
        const linesForStop = stopIdToLines.get(gtfsStopId);
        if (!linesForStop) return;
        const stopCode = stopIdToStopCode.get(gtfsStopId);
        if (!stopCode) return;

        if (!candidateTripLineCounts.has(tripId)) {
          candidateTripLineCounts.set(tripId, new Map());
          candidateTripLineStops.set(tripId, new Map());
        }
        const counts = candidateTripLineCounts.get(tripId);
        const stopMap = candidateTripLineStops.get(tripId);
        for (const line of linesForStop) {
          counts.set(line, (counts.get(line) || 0) + 1);
          if (!stopMap.has(line)) stopMap.set(line, new Set());
          stopMap.get(line).add(stopCode);
        }
      }
    );
  }

  const candidateTripIds = new Set(candidateTripLineCounts.keys());

  // 2) Parse trips, keep candidate trips only.
  const tripMetaById = new Map();
  if (hasFile['trips.txt']) {
    let idxTripId = -1;
    let idxRouteId = -1;
    let idxShapeId = -1;
    let idxDirection = -1;
    let idxHeadsign = -1;
    await streamCsvRows(
      gtfsPath['trips.txt'],
      (headers) => {
        idxTripId = headers.indexOf('trip_id');
        idxRouteId = headers.indexOf('route_id');
        idxShapeId = headers.indexOf('shape_id');
        idxDirection = headers.indexOf('direction_id');
        idxHeadsign = headers.indexOf('trip_headsign');
      },
      (cells) => {
        const tripId = String(cells[idxTripId] || '').trim();
        if (!candidateTripIds.has(tripId)) return;
        tripMetaById.set(tripId, {
          tripId,
          routeId: String(cells[idxRouteId] || '').trim(),
          shapeId: String(cells[idxShapeId] || '').trim(),
          directionId: String(cells[idxDirection] || '').trim(),
          headsign: String(cells[idxHeadsign] || '').trim(),
        });
      }
    );
  }

  // 3) Parse routes for only used route_ids.
  const usedRouteIds = new Set(Array.from(tripMetaById.values()).map((t) => t.routeId).filter(Boolean));
  const routeMetaById = new Map();
  if (hasFile['routes.txt']) {
    let idxRouteId = -1;
    let idxShort = -1;
    let idxLong = -1;
    await streamCsvRows(
      gtfsPath['routes.txt'],
      (headers) => {
        idxRouteId = headers.indexOf('route_id');
        idxShort = headers.indexOf('route_short_name');
        idxLong = headers.indexOf('route_long_name');
      },
      (cells) => {
        const routeId = String(cells[idxRouteId] || '').trim();
        if (!usedRouteIds.has(routeId)) return;
        routeMetaById.set(routeId, {
          routeId,
          routeShortName: String(cells[idxShort] || '').trim(),
          routeLongName: String(cells[idxLong] || '').trim(),
        });
      }
    );
  }

  // 4) Assign each candidate trip to a single Rakvere line by strongest stop-id evidence.
  const assignedTrips = [];
  const ambiguousTripCount = { value: 0 };
  for (const [tripId, counts] of candidateTripLineCounts.entries()) {
    const tripMeta = tripMetaById.get(tripId);
    if (!tripMeta) continue;
    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) continue;
    const [bestLine, bestCount] = ranked[0];
    const secondCount = ranked[1]?.[1] || 0;
    // require at least 3 matching stop ids and a non-tie lead
    if (bestCount < 3 || bestCount === secondCount) {
      ambiguousTripCount.value += 1;
      continue;
    }
    const lineStopIds = candidateTripLineStops.get(tripId)?.get(bestLine) || new Set();
    assignedTrips.push({
      ...tripMeta,
      lineNumber: bestLine,
      matchedStopIds: lineStopIds,
    });
  }

  const lineStats = Object.fromEntries(
    TARGET_LINES.map((line) => [
      line,
      {
        lineNumber: line,
        patternCount: (patternByLine.get(line) || []).length,
        patternNames: (patternByLine.get(line) || []).map((p) => p.patternName),
        routeIds: [],
        routeLongNames: [],
        tripCount: 0,
        tripsWithShape: 0,
        tripsWithoutShape: 0,
        uniqueShapeIds: [],
        directionIds: [],
        headsignSamples: [],
        dominantShapeIds: [],
        geometryDistinctByEndpoints: false,
        mappedPatternCoverage: 0,
        mappedPatternNames: [],
        shapePatternExamples: [],
        patternMatchConfidence: 'none',
      },
    ])
  );

  const routeIdsByLine = new Map(TARGET_LINES.map((line) => [line, new Set()]));
  const routeLongByLine = new Map(TARGET_LINES.map((line) => [line, new Set()]));
  const shapeUsageByLine = new Map(TARGET_LINES.map((line) => [line, new Map()]));
  const shapeIdsByLine = new Map(TARGET_LINES.map((line) => [line, new Set()]));
  const shapeMatchedStopsByLine = new Map(TARGET_LINES.map((line) => [line, new Map()]));
  const relevantShapeIds = new Set();

  for (const trip of assignedTrips) {
    const s = lineStats[trip.lineNumber];
    s.tripCount += 1;
    routeIdsByLine.get(trip.lineNumber).add(trip.routeId);
    const routeLong = routeMetaById.get(trip.routeId)?.routeLongName;
    if (routeLong) routeLongByLine.get(trip.lineNumber).add(routeLong);
    if (trip.directionId && !s.directionIds.includes(trip.directionId)) s.directionIds.push(trip.directionId);
    if (trip.headsign && s.headsignSamples.length < 12 && !s.headsignSamples.includes(trip.headsign)) {
      s.headsignSamples.push(trip.headsign);
    }

    if (!trip.shapeId) {
      s.tripsWithoutShape += 1;
      continue;
    }
    s.tripsWithShape += 1;
    relevantShapeIds.add(trip.shapeId);
    shapeIdsByLine.get(trip.lineNumber).add(trip.shapeId);
    const usage = shapeUsageByLine.get(trip.lineNumber);
    usage.set(trip.shapeId, (usage.get(trip.shapeId) || 0) + 1);

    const byShape = shapeMatchedStopsByLine.get(trip.lineNumber);
    if (!byShape.has(trip.shapeId)) byShape.set(trip.shapeId, new Set());
    for (const stopId of trip.matchedStopIds) byShape.get(trip.shapeId).add(stopId);
  }

  // 5) Parse shapes for relevant shape ids.
  const shapeStats = new Map();
  const allShapeIds = new Set();
  let totalShapePointCount = 0;
  if (hasFile['shapes.txt']) {
    let idxShapeId = -1;
    let idxLat = -1;
    let idxLon = -1;
    let idxSeq = -1;
    await streamCsvRows(
      gtfsPath['shapes.txt'],
      (headers) => {
        idxShapeId = headers.indexOf('shape_id');
        idxLat = headers.indexOf('shape_pt_lat');
        idxLon = headers.indexOf('shape_pt_lon');
        idxSeq = headers.indexOf('shape_pt_sequence');
      },
      (cells) => {
        const shapeId = String(cells[idxShapeId] || '').trim();
        if (!shapeId) return;
        totalShapePointCount += 1;
        allShapeIds.add(shapeId);
        if (!relevantShapeIds.has(shapeId)) return;

        if (!shapeStats.has(shapeId)) {
          shapeStats.set(shapeId, {
            pointCount: 0,
            minSeq: Number.POSITIVE_INFINITY,
            maxSeq: Number.NEGATIVE_INFINITY,
            startLat: null,
            startLon: null,
            endLat: null,
            endLon: null,
          });
        }
        const st = shapeStats.get(shapeId);
        const lat = Number(cells[idxLat]);
        const lon = Number(cells[idxLon]);
        const seq = Number(cells[idxSeq]);
        st.pointCount += 1;
        if (Number.isFinite(seq) && seq < st.minSeq) {
          st.minSeq = seq;
          st.startLat = lat;
          st.startLon = lon;
        }
        if (Number.isFinite(seq) && seq > st.maxSeq) {
          st.maxSeq = seq;
          st.endLat = lat;
          st.endLon = lon;
        }
      }
    );
  }

  // 6) Evaluate confidence and direction/pattern distinguishability.
  for (const line of TARGET_LINES) {
    const s = lineStats[line];
    s.routeIds = Array.from(routeIdsByLine.get(line)).sort();
    s.routeLongNames = Array.from(routeLongByLine.get(line)).sort();
    s.uniqueShapeIds = Array.from(shapeIdsByLine.get(line)).sort();
    s.dominantShapeIds = Array.from(shapeUsageByLine.get(line).entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([shapeId, tripCount]) => ({ shapeId, tripCount }));

    const endpointFingerprints = new Set();
    for (const shapeId of s.uniqueShapeIds) {
      const fp = endpointFingerprint(shapeStats.get(shapeId));
      if (fp) endpointFingerprints.add(fp);
    }
    s.geometryDistinctByEndpoints = endpointFingerprints.size >= 2;

    const coveredPatterns = new Set();
    const shapeExamples = [];
    const patterns = patternByLine.get(line) || [];
    const byShape = shapeMatchedStopsByLine.get(line) || new Map();
    for (const [shapeId, stopSet] of byShape.entries()) {
      let bestPattern = null;
      let bestScore = 0;
      for (const p of patterns) {
        const score = jaccardOverlap(stopSet, p.stopIds);
        if (score > bestScore) {
          bestScore = score;
          bestPattern = p.patternName;
        }
      }
      if (bestPattern) {
        coveredPatterns.add(bestPattern);
        shapeExamples.push({
          shapeId,
          patternName: bestPattern,
          overlapScore: Number(bestScore.toFixed(3)),
        });
      }
    }

    s.mappedPatternCoverage = coveredPatterns.size;
    s.mappedPatternNames = Array.from(coveredPatterns).sort();
    s.shapePatternExamples = shapeExamples.sort((a, b) => b.overlapScore - a.overlapScore).slice(0, 8);

    let score = 0;
    if (s.tripCount > 0) score += 0.25;
    if (s.tripsWithShape > 0) score += 0.2;
    if (s.uniqueShapeIds.length > 0) score += 0.15;
    if (s.patternCount <= 1 && s.mappedPatternCoverage >= 1) score += 0.2;
    if (s.patternCount > 1 && s.mappedPatternCoverage >= s.patternCount) score += 0.25;
    if (s.geometryDistinctByEndpoints) score += 0.1;
    s.patternMatchConfidence = confidenceLabel(Math.min(score, 1));
  }

  const directionChecks = {
    line5DistinctDirectionGeometry:
      lineStats['5'].geometryDistinctByEndpoints && lineStats['5'].mappedPatternCoverage >= 2,
    line3CircularPatternsDistinguishable:
      lineStats['3'].mappedPatternCoverage >= 2,
  };

  const linesWithShapes = TARGET_LINES.filter((line) => lineStats[line].tripsWithShape > 0);
  let recommendation = 'no safe source found';
  let recommendationReason = 'Could not confidently map Rakvere patterns to GTFS shapes.';
  if (!hasFile['shapes.txt']) {
    recommendation = 'OSM road geometry needed';
    recommendationReason = 'shapes.txt is missing.';
  } else if (
    linesWithShapes.length === TARGET_LINES.length &&
    directionChecks.line5DistinctDirectionGeometry &&
    lineStats['3'].mappedPatternCoverage >= 1
  ) {
    recommendation = 'GTFS shapes usable';
    recommendationReason =
      'Rakvere-matched trips for lines 1/2/3/5 are shape-backed and line 5 direction geometry is distinguishable.';
  } else if (linesWithShapes.length > 0) {
    recommendation = 'GTFS shapes partial';
    recommendationReason = 'Some Rakvere shape coverage exists, but direction/pattern mapping is partial.';
  }

  const output = {
    generatedAt: new Date().toISOString(),
    gtfsSource: {
      recommendedSource: recommendedSource || null,
      cacheZipPath: path.relative(ROOT, CACHE_ZIP_PATH).replace(/\\/g, '/'),
      cacheUsed,
      downloadedNow,
      extractedDir: path.relative(ROOT, GTFS_DIR).replace(/\\/g, '/'),
      extractedFiles: Object.fromEntries(REQUIRED_GTFS_FILES.map((f) => [f, hasFile[f]])),
    },
    shapes: {
      shapesTxtExists: hasFile['shapes.txt'],
      totalShapePointCount,
      uniqueShapeIdCount: allShapeIds.size,
      relevantShapeIdCount: relevantShapeIds.size,
      relevantShapeWithGeometryCount: shapeStats.size,
    },
    routePatternComparison: {
      source: path.relative(ROOT, ROUTE_PATTERN_MAP_PATH).replace(/\\/g, '/'),
      linePatternCounts: Object.fromEntries(TARGET_LINES.map((line) => [line, (patternByLine.get(line) || []).length])),
      candidateTripsTouchingTargetStops: candidateTripIds.size,
      ambiguousTripAssignments: ambiguousTripCount.value,
      rakvereTripsAssigned: assignedTrips.length,
      unmappedPatternStopCodes,
    },
    lines: TARGET_LINES.map((line) => lineStats[line]),
    directionChecks,
    recommendation: {
      result: recommendation,
      reason: recommendationReason,
      nextPass: 'PASS 28J — MAP_ROUTE_HIGHLIGHT_BY_DIRECTION',
      note: 'No straight stop-to-stop polyline MVP; route highlight must use real geometry.',
    },
  };

  const tableRows = TARGET_LINES.map((line) => {
    const s = lineStats[line];
    return `| ${line} | ${s.routeIds.length} | ${s.tripCount} | ${s.tripsWithShape} | ${s.uniqueShapeIds.length} | ${s.mappedPatternCoverage}/${s.patternCount} | ${s.patternMatchConfidence} |`;
  }).join('\n');

  const report = `# ROUTE_GEOMETRY_SOURCE_DISCOVERY

Generated: ${output.generatedAt}

## Checked GTFS source/cache path

- Recommended source: ${output.gtfsSource.recommendedSource || 'N/A'}
- Cache ZIP used: \`${output.gtfsSource.cacheZipPath}\`
- Downloaded in this pass: ${output.gtfsSource.downloadedNow ? 'yes' : 'no'}
- Extract dir: \`${output.gtfsSource.extractedDir}\`

## GTFS file presence

- shapes.txt exists: ${hasFile['shapes.txt'] ? 'yes' : 'no'}
- trips.txt exists: ${hasFile['trips.txt'] ? 'yes' : 'no'}
- routes.txt exists: ${hasFile['routes.txt'] ? 'yes' : 'no'}
- stop_times.txt exists: ${hasFile['stop_times.txt'] ? 'yes' : 'no'}

## shapes.txt summary

- total shape points: ${output.shapes.totalShapePointCount}
- relevant shape IDs (Rakvere-assigned trips): ${output.shapes.relevantShapeIdCount}
- relevant shape IDs with geometry rows: ${output.shapes.relevantShapeWithGeometryCount}

## Line-by-line shape availability (Rakvere-assigned)

| Line | Route IDs | Assigned trips | Trips with shape_id | Unique shape_ids | Pattern coverage | Confidence |
|---|---:|---:|---:|---:|---:|---|
${tableRows}

## Direction/pattern matching confidence

- Line 5 distinguishable direction geometry: ${directionChecks.line5DistinctDirectionGeometry ? 'yes' : 'no'}
- Line 3 circular patterns distinguishable: ${directionChecks.line3CircularPatternsDistinguishable ? 'yes' : 'no'}

## Recommendation for PASS 28J

- Result: **${recommendation}**
- Reason: ${recommendationReason}
- Explicit note: **no straight stop-to-stop polyline MVP**; user chose real geometry.
- Next pass: \`PASS 28J — MAP_ROUTE_HIGHLIGHT_BY_DIRECTION\`
`;

  await fsp.writeFile(OUTPUT_JSON_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await fsp.writeFile(OUTPUT_REPORT_PATH, report, 'utf8');

  console.log(`Wrote ${path.relative(ROOT, OUTPUT_JSON_PATH)}`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_REPORT_PATH)}`);
  console.log(`Recommendation: ${recommendation}`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
