import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { BUS_DATA } from '../src/data/busData.js';

const execFile = promisify(execFileCb);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const discoveryPath = path.join(repoRoot, 'docs', 'audit', 'gtfs-source-discovery.json');
const routeMapPath = path.join(repoRoot, 'docs', 'audit', 'route-pattern-stopid-map.json');
const comparePath = path.join(repoRoot, 'docs', 'audit', 'route-pattern-busdata-compare.json');

const artifactDir = path.join(repoRoot, '.artifacts', 'gtfs');
const zipCachePath = path.join(artifactDir, 'estonia_unified_gtfs.zip');
const stopsCachePath = path.join(artifactDir, 'stops.txt');

const outputJsonPath = path.join(repoRoot, 'docs', 'audit', 'gtfs-rakvere-stop-coords.json');
const outputReportPath = path.join(repoRoot, 'docs', 'audit', 'gtfs-rakvere-stop-coords-report.md');

const focusNames = [
  'Aiand',
  'Õie',
  'Tulika',
  'Kivi',
  'Piiri',
  'Kungla',
  'Polikliinik',
  'Kesk',
  'Keskväljak',
  'Näpi',
  'Narva',
  'Kauba',
  'Raudteejaam',
  'Haigla',
  'Teater'
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const norm = (v) => String(v ?? '').trim().toLocaleLowerCase('et-EE');

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
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c += 1) {
      row[headers[c]] = cols[c] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function decideStatus(gtfsFound, busCoordOk, distance) {
  if (!gtfsFound) return 'MISSING_GTFS';
  if (!busCoordOk) return 'MISSING_BUSDATA_COORD';
  if (!isNum(distance)) return 'REVIEW';
  if (distance <= 25) return 'OK';
  if (distance <= 75) return 'REVIEW';
  return 'BAD_REVIEW';
}

function escPs(value) {
  return String(value).replace(/'/g, "''");
}

async function ensureZipDownloaded(url) {
  await fs.mkdir(artifactDir, { recursive: true });

  let cacheExists = false;
  try {
    await fs.access(zipCachePath);
    cacheExists = true;
  } catch {
    cacheExists = false;
  }

  if (cacheExists) {
    return { downloadedNow: false };
  }

  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'AnniVibe GTFS extract audit'
    }
  });
  if (!response.ok) {
    throw new Error(`GTFS download failed (${response.status}) from ${url}`);
  }

  const ab = await response.arrayBuffer();
  await fs.writeFile(zipCachePath, Buffer.from(ab));
  return { downloadedNow: true };
}

async function ensureStopsExtracted() {
  let stopsExists = false;
  try {
    await fs.access(stopsCachePath);
    stopsExists = true;
  } catch {
    stopsExists = false;
  }

  if (stopsExists) return { extractedNow: false };

  const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = '${escPs(zipCachePath)}'
$outPath = '${escPs(stopsCachePath)}'
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entry = $zip.Entries | Where-Object { $_.FullName -ieq 'stops.txt' } | Select-Object -First 1
  if (-not $entry) { throw 'stops.txt not found in GTFS zip' }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  try {
    [System.IO.File]::WriteAllText($outPath, $reader.ReadToEnd(), [System.Text.Encoding]::UTF8)
  } finally {
    $reader.Dispose()
  }
} finally {
  $zip.Dispose()
}
`;

  await execFile('powershell', ['-NoProfile', '-Command', psScript], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 10
  });

  return { extractedNow: true };
}

function uniqSorted(arr) {
  return [...new Set(arr)].sort((a, b) => String(a).localeCompare(String(b), 'et'));
}

async function main() {
  const discovery = JSON.parse(await fs.readFile(discoveryPath, 'utf8'));
  const routeMap = JSON.parse(await fs.readFile(routeMapPath, 'utf8'));
  const compare = JSON.parse(await fs.readFile(comparePath, 'utf8'));

  const recommendedUrl = discovery?.summary?.recommendedSource?.url;
  if (!recommendedUrl) {
    throw new Error('No recommended GTFS source in docs/audit/gtfs-source-discovery.json');
  }

  const cacheResult = await ensureZipDownloaded(recommendedUrl);
  const extractResult = await ensureStopsExtracted();

  const stopsText = await fs.readFile(stopsCachePath, 'utf8');
  const stopsRows = parseCsv(stopsText);

  const gtfsByCodeOrId = new Map();
  for (const row of stopsRows) {
    if (row.stop_code) gtfsByCodeOrId.set(String(row.stop_code).trim(), row);
    if (row.stop_id) gtfsByCodeOrId.set(String(row.stop_id).trim(), row);
  }

  const targetStopIds = uniqSorted(
    (routeMap.patterns ?? []).flatMap((pattern) => (pattern.stops ?? []).map((s) => s.stopId))
  );

  const stopIdToRouteNames = new Map();
  for (const pattern of routeMap.patterns ?? []) {
    for (const stop of pattern.stops ?? []) {
      if (!stopIdToRouteNames.has(stop.stopId)) stopIdToRouteNames.set(stop.stopId, new Set());
      stopIdToRouteNames.get(stop.stopId).add(stop.stopName);
    }
  }

  const comparisons = [];
  for (const stopId of targetStopIds) {
    const routeNames = uniqSorted([...(stopIdToRouteNames.get(stopId) ?? [])]);
    const gtfs = gtfsByCodeOrId.get(stopId) ?? null;
    const bus = BUS_DATA?.by_code?.[stopId] ?? null;

    const gtfsLat = gtfs ? Number(gtfs.stop_lat) : null;
    const gtfsLon = gtfs ? Number(gtfs.stop_lon) : null;
    const gtfsCoordOk = gtfs && isNum(gtfsLat) && isNum(gtfsLon);

    const busLat = bus?.lat ?? null;
    const busLon = bus?.lon ?? null;
    const busCoordOk = isNum(busLat) && isNum(busLon);

    let distance = null;
    if (gtfsCoordOk && busCoordOk) {
      distance = distanceMeters(gtfsLat, gtfsLon, busLat, busLon);
    }

    const status = decideStatus(Boolean(gtfs), busCoordOk, distance);

    comparisons.push({
      stopId,
      routeNames,
      gtfs: gtfs
        ? {
            stop_id: gtfs.stop_id,
            stop_name: gtfs.stop_name,
            stop_lat: gtfsLat,
            stop_lon: gtfsLon
          }
        : null,
      busData: bus
        ? {
            name: bus.name,
            lat: busLat,
            lon: busLon
          }
        : null,
      distanceMeters: isNum(distance) ? Number(distance.toFixed(2)) : null,
      status
    });
  }

  const byStatus = {};
  for (const c of comparisons) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  }

  const missingGtfs = comparisons.filter((c) => c.status === 'MISSING_GTFS');
  const missingBusDataCoord = comparisons.filter((c) => c.status === 'MISSING_BUSDATA_COORD');
  const review = comparisons.filter((c) => c.status === 'REVIEW');
  const badReview = comparisons.filter((c) => c.status === 'BAD_REVIEW');

  const focusSet = new Set(focusNames.map((n) => norm(n)));
  const focusFindings = comparisons.filter((c) => {
    const names = [c.busData?.name, c.gtfs?.stop_name, ...c.routeNames].filter(Boolean).map(norm);
    return names.some((n) => focusSet.has(n));
  });

  const compareAiand = (compare.coordinateWarnings ?? []).find((w) => w.stopId === '5900013-1') ?? null;
  const aiandCurrent = comparisons.find((c) => c.stopId === '5900013-1') ?? null;

  const conclusionNeedsPatch = missingBusDataCoord.length > 0 || review.length > 0 || badReview.length > 0;

  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      recommendedGtfsUrl: recommendedUrl,
      discovery: 'docs/audit/gtfs-source-discovery.json',
      routePatternStopIdMap: 'docs/audit/route-pattern-stopid-map.json',
      routePatternBusDataCompare: 'docs/audit/route-pattern-busdata-compare.json',
      busData: 'src/data/busData.js'
    },
    cache: {
      zipPath: '.artifacts/gtfs/estonia_unified_gtfs.zip',
      stopsPath: '.artifacts/gtfs/stops.txt',
      downloadedNow: cacheResult.downloadedNow,
      extractedNow: extractResult.extractedNow
    },
    thresholdsMeters: {
      okMax: 25,
      reviewMax: 75
    },
    summary: {
      targetStopIdCount: targetStopIds.length,
      gtfsStopsRowCount: stopsRows.length,
      statusCounts: byStatus,
      missingGtfsStopIdCount: missingGtfs.length,
      missingBusDataCoordCount: missingBusDataCoord.length,
      reviewCount: review.length,
      badReviewCount: badReview.length
    },
    missingGtfsStopIds: missingGtfs.map((c) => c.stopId),
    aiand: {
      stopId: '5900013-1',
      previousCompareFinding: compareAiand,
      current: aiandCurrent
    },
    focusNames,
    focusFindings,
    comparisons,
    conclusion: {
      busDataCoordinatesNeedPatchLater: conclusionNeedsPatch,
      reason: conclusionNeedsPatch
        ? 'At least one stop has missing busData coordinates or distance review/bad_review flags.'
        : 'No missing busData coordinates and no distance warnings above OK threshold.'
    }
  };

  await fs.writeFile(outputJsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const mismatchRows = comparisons
    .filter((c) => c.status !== 'OK')
    .map((c) => {
      const gtfsName = c.gtfs?.stop_name ?? 'n/a';
      const busName = c.busData?.name ?? 'n/a';
      const dist = isNum(c.distanceMeters) ? c.distanceMeters : 'n/a';
      return `| ${c.stopId} | ${c.routeNames.join(', ')} | ${gtfsName} | ${busName} | ${dist} | ${c.status} |`;
    })
    .join('\n');

  const focusRows = focusFindings
    .map((c) => {
      const name = c.busData?.name ?? c.gtfs?.stop_name ?? c.routeNames[0] ?? 'n/a';
      const dist = isNum(c.distanceMeters) ? c.distanceMeters : 'n/a';
      return `| ${name} | ${c.stopId} | ${dist} | ${c.status} |`;
    })
    .join('\n');

  const report = `# GTFS Rakvere Stop Coordinate Extract Report

Generated: ${payload.generatedAt}

## Source and cache

- GTFS source used: ${recommendedUrl}
- ZIP cache path: .artifacts/gtfs/estonia_unified_gtfs.zip
- stops cache path: .artifacts/gtfs/stops.txt
- Downloaded now: ${cacheResult.downloadedNow}
- Extracted stops now: ${extractResult.extractedNow}

## Summary

- Target stopIds checked: ${payload.summary.targetStopIdCount}
- Missing GTFS stopIds: ${payload.summary.missingGtfsStopIdCount}
- Missing busData coord count: ${payload.summary.missingBusDataCoordCount}
- REVIEW count (>25m and <=75m): ${payload.summary.reviewCount}
- BAD_REVIEW count (>75m): ${payload.summary.badReviewCount}

## Status counts

${Object.entries(payload.summary.statusCounts)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

## Mismatches / non-OK

| stopId | route stop name(s) | gtfs stop_name | busData name | distance_m | status |
|---|---|---|---|---:|---|
${mismatchRows || '| - | - | - | - | - | - |'}

## Focus findings

| focus name | stopId | distance_m | status |
|---|---|---:|---|
${focusRows || '| - | - | - | - |'}

## Aiand finding

- stopId: 5900013-1
- previous compare warning existed: ${compareAiand ? 'yes' : 'no'}
- current status: ${aiandCurrent?.status ?? 'n/a'}
- busData coords: lat=${aiandCurrent?.busData?.lat ?? 'n/a'}, lon=${aiandCurrent?.busData?.lon ?? 'n/a'}
- gtfs coords: lat=${aiandCurrent?.gtfs?.stop_lat ?? 'n/a'}, lon=${aiandCurrent?.gtfs?.stop_lon ?? 'n/a'}

## Conclusion

busData coordinates need patch later: ${payload.conclusion.busDataCoordinatesNeedPatchLater ? 'YES' : 'NO'}

Reason: ${payload.conclusion.reason}
`;

  await fs.writeFile(outputReportPath, report, 'utf8');

  process.stdout.write(
    `${JSON.stringify(
      {
        outputJson: 'docs/audit/gtfs-rakvere-stop-coords.json',
        outputReport: 'docs/audit/gtfs-rakvere-stop-coords-report.md',
        sourceUsed: recommendedUrl,
        cacheZip: '.artifacts/gtfs/estonia_unified_gtfs.zip',
        targetStopIdsChecked: targetStopIds.length,
        missingGtfsStopIds: missingGtfs.length,
        missingBusDataCoordCount: missingBusDataCoord.length,
        reviewCount: review.length,
        badReviewCount: badReview.length
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
