import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUS_DATA } from '../src/data/busData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const routeMapPath = path.join(repoRoot, 'docs', 'audit', 'route-pattern-stopid-map.json');
const outJsonPath = path.join(repoRoot, 'docs', 'audit', 'route-pattern-busdata-compare.json');
const outReportPath = path.join(repoRoot, 'docs', 'audit', 'route-pattern-busdata-compare-report.md');

const focusNames = [
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
  'Tõrma kalmistu'
];

const norm = (value) => String(value ?? '').trim().toLocaleLowerCase('et-EE');
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

function splitCodes(group) {
  return {
    codes: Array.isArray(group?.codes) ? group.codes : [],
    displayCodes: Array.isArray(group?.displayCodes) ? group.displayCodes : []
  };
}

function parseTime(value) {
  if (!value || typeof value !== 'string') return Number.MAX_SAFE_INTEGER;
  const [hh, mm] = value.split(':').map((part) => Number(part));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return Number.MAX_SAFE_INTEGER;
  return hh * 60 + mm;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b), 'et'));
}

async function main() {
  const routeMapRaw = await fs.readFile(routeMapPath, 'utf8');
  const routeMap = JSON.parse(routeMapRaw);

  const byCode = BUS_DATA?.by_code ?? {};
  const groups = Array.isArray(BUS_DATA?.groups) ? BUS_DATA.groups : [];

  const groupsByName = new Map();
  for (const group of groups) {
    groupsByName.set(norm(group?.name), group);
  }

  const groupsByStopId = new Map();
  for (const group of groups) {
    const { codes, displayCodes } = splitCodes(group);
    for (const code of [...codes, ...displayCodes]) {
      if (!groupsByStopId.has(code)) groupsByStopId.set(code, []);
      groupsByStopId.get(code).push(group);
    }
  }

  const stopComparisons = [];
  const duplicateNameMap = new Map();
  const routeStopNameToGroups = new Map();

  for (const pattern of routeMap.patterns ?? []) {
    for (const stop of pattern.stops ?? []) {
      const stopId = stop?.stopId;
      const routeStopName = stop?.stopName;
      const byCodeEntry = byCode?.[stopId] ?? null;

      const byCodeExists = Boolean(byCodeEntry);
      const byCodeName = byCodeEntry?.name ?? null;
      const byCodeLat = byCodeEntry?.lat ?? null;
      const byCodeLon = byCodeEntry?.lon ?? null;
      const byCodeCoordNumeric = isNum(byCodeLat) && isNum(byCodeLon);

      const routeNameGroup = groupsByName.get(norm(routeStopName)) ?? null;
      const routeGroupName = routeNameGroup?.name ?? null;
      const routeGroupLat = routeNameGroup?.lat ?? null;
      const routeGroupLon = routeNameGroup?.lon ?? null;
      const routeGroupCoordNumeric = isNum(routeGroupLat) && isNum(routeGroupLon);

      const { codes: routeGroupCodes, displayCodes: routeGroupDisplayCodes } = splitCodes(routeNameGroup);

      const inRouteGroupCodes = routeGroupCodes.includes(stopId);
      const inRouteGroupDisplayCodes = routeGroupDisplayCodes.includes(stopId);
      const inRouteGroupAny = inRouteGroupCodes || inRouteGroupDisplayCodes;

      const codeGroups = groupsByStopId.get(stopId) ?? [];
      const codeGroupNames = codeGroups.map((item) => item.name);
      const codeGroupUniqueNames = uniqueSorted(codeGroupNames);

      const byCodeNameMatchesRoute = byCodeExists ? norm(byCodeName) === norm(routeStopName) : false;
      const groupNameMismatch = byCodeExists ? !byCodeNameMatchesRoute : false;

      const coordWarning = !(byCodeCoordNumeric && routeGroupCoordNumeric);
      const codeDisplayWarning = !inRouteGroupAny;

      const comparison = {
        lineNumber: pattern.lineNumber,
        patternName: pattern.patternName,
        sourceFile: stop.sourceFile ?? pattern.sourceFile,
        seq: stop.seq,
        time: stop.time ?? null,
        routeStopName,
        stopId,
        byCode: {
          exists: byCodeExists,
          name: byCodeName,
          lat: byCodeLat,
          lon: byCodeLon,
          coordinateNumeric: byCodeCoordNumeric
        },
        routeGroup: {
          exists: Boolean(routeNameGroup),
          name: routeGroupName,
          lat: routeGroupLat,
          lon: routeGroupLon,
          coordinateNumeric: routeGroupCoordNumeric,
          codeInCodes: inRouteGroupCodes,
          codeInDisplayCodes: inRouteGroupDisplayCodes,
          codeInAny: inRouteGroupAny
        },
        codeMembership: {
          groupsContainingStopId: codeGroupUniqueNames,
          groupCount: codeGroupUniqueNames.length
        },
        checks: {
          byCodeExists,
          byCodeNameMatchesRoute,
          groupNameMismatch,
          codeDisplayMismatch: codeDisplayWarning,
          coordinateWarning: coordWarning
        }
      };

      stopComparisons.push(comparison);

      const duplicateKey = norm(routeStopName);
      if (!duplicateNameMap.has(duplicateKey)) {
        duplicateNameMap.set(duplicateKey, {
          stopName: routeStopName,
          stopIds: new Set(),
          lines: new Set(),
          patterns: new Set()
        });
      }
      const dupEntry = duplicateNameMap.get(duplicateKey);
      dupEntry.stopIds.add(stopId);
      dupEntry.lines.add(pattern.lineNumber);
      dupEntry.patterns.add(pattern.patternName);

      if (!routeStopNameToGroups.has(duplicateKey)) {
        routeStopNameToGroups.set(duplicateKey, new Set());
      }
      for (const groupName of codeGroupUniqueNames) {
        routeStopNameToGroups.get(duplicateKey).add(groupName);
      }
    }
  }

  const missingStopIds = uniqueSorted(
    stopComparisons.filter((item) => !item.checks.byCodeExists).map((item) => item.stopId)
  );

  const groupNameMismatches = stopComparisons.filter((item) => item.checks.groupNameMismatch);
  const coordinateWarnings = stopComparisons.filter((item) => item.checks.coordinateWarning);
  const codeDisplayWarnings = stopComparisons.filter((item) => item.checks.codeDisplayMismatch);

  const duplicateStopNameWithMultipleStopIds = [...duplicateNameMap.values()]
    .filter((entry) => entry.stopIds.size > 1)
    .map((entry) => ({
      stopName: entry.stopName,
      stopIds: uniqueSorted([...entry.stopIds]),
      lineNumbers: uniqueSorted([...entry.lines]),
      patterns: uniqueSorted([...entry.patterns])
    }))
    .sort((a, b) => a.stopName.localeCompare(b.stopName, 'et'));

  const focusSet = new Set(focusNames.map((name) => norm(name)));
  const focusEntries = stopComparisons.filter((item) => focusSet.has(norm(item.routeStopName)));

  const focusSummary = focusNames.map((name) => {
    const key = norm(name);
    const entries = focusEntries.filter((item) => norm(item.routeStopName) === key);
    const stopIds = uniqueSorted(entries.map((item) => item.stopId));
    const groupNames = uniqueSorted(
      entries.flatMap((item) => item.codeMembership.groupsContainingStopId ?? [])
    );
    const mismatchCount = entries.filter((item) => item.checks.groupNameMismatch).length;
    const coordWarnCount = entries.filter((item) => item.checks.coordinateWarning).length;
    const displayWarnCount = entries.filter((item) => item.checks.codeDisplayMismatch).length;

    return {
      stopName: name,
      occurrences: entries.length,
      stopIds,
      groupNames,
      mismatchCount,
      coordinateWarningCount: coordWarnCount,
      codeDisplayWarningCount: displayWarnCount
    };
  });

  const outJson = {
    generatedAt: new Date().toISOString(),
    source: {
      routePatternMap: path.relative(repoRoot, routeMapPath).replaceAll('\\', '/'),
      busData: 'src/data/busData.js'
    },
    summary: {
      patternCount: routeMap?.summary?.patternCount ?? (routeMap.patterns?.length ?? 0),
      lineNumbers: routeMap?.summary?.lineNumbers ?? [],
      stopRefCount: stopComparisons.length,
      uniqueStopIdCount: uniqueSorted(stopComparisons.map((item) => item.stopId)).length,
      missingStopIdCount: missingStopIds.length,
      groupNameMismatchCount: groupNameMismatches.length,
      coordinateWarningCount: coordinateWarnings.length,
      codeDisplayWarningCount: codeDisplayWarnings.length,
      duplicateStopNameMultiStopIdCount: duplicateStopNameWithMultipleStopIds.length
    },
    missingStopIds,
    groupNameMismatches: groupNameMismatches.map((item) => ({
      lineNumber: item.lineNumber,
      patternName: item.patternName,
      seq: item.seq,
      routeStopName: item.routeStopName,
      stopId: item.stopId,
      byCodeName: item.byCode.name
    })),
    coordinateWarnings: coordinateWarnings.map((item) => ({
      lineNumber: item.lineNumber,
      patternName: item.patternName,
      seq: item.seq,
      routeStopName: item.routeStopName,
      stopId: item.stopId,
      byCodeCoordinateNumeric: item.byCode.coordinateNumeric,
      routeGroupCoordinateNumeric: item.routeGroup.coordinateNumeric,
      byCodeLat: item.byCode.lat,
      byCodeLon: item.byCode.lon,
      routeGroupLat: item.routeGroup.lat,
      routeGroupLon: item.routeGroup.lon
    })),
    codeDisplayWarnings: codeDisplayWarnings.map((item) => ({
      lineNumber: item.lineNumber,
      patternName: item.patternName,
      seq: item.seq,
      routeStopName: item.routeStopName,
      stopId: item.stopId,
      routeGroupName: item.routeGroup.name,
      routeGroupExists: item.routeGroup.exists,
      groupsContainingStopId: item.codeMembership.groupsContainingStopId
    })),
    duplicateStopNameWithMultipleStopIds,
    focusSummary,
    stopComparisons
  };

  await fs.writeFile(outJsonPath, `${JSON.stringify(outJson, null, 2)}\n`, 'utf8');

  const patternRows = (routeMap.patterns ?? [])
    .map((pattern) => {
      const stopCount = Array.isArray(pattern.stops) ? pattern.stops.length : 0;
      return `| ${pattern.lineNumber} | ${pattern.patternName} | ${pattern.sourceFile} | ${stopCount} |`;
    })
    .join('\n');

  const importantDuplicates = ['Õie', 'Tulika', 'Kivi', 'Polikliinik', 'Kesk', 'Näpi'];
  const duplicateBullets = importantDuplicates
    .map((name) => {
      const found = duplicateStopNameWithMultipleStopIds.find((item) => norm(item.stopName) === norm(name));
      if (!found) return `- ${name}: not found in parsed patterns`;
      return `- ${name}: ${found.stopIds.join(', ')}`;
    })
    .join('\n');

  const focusSection = focusSummary
    .map((entry) => {
      return `- ${entry.stopName}: occurrences=${entry.occurrences}, stopIds=[${entry.stopIds.join(', ')}], groups=[${entry.groupNames.join(', ')}], mismatches=${entry.mismatchCount}, coordWarnings=${entry.coordinateWarningCount}, displayWarnings=${entry.codeDisplayWarningCount}`;
    })
    .join('\n');

  const mismatchExamples = groupNameMismatches.slice(0, 10)
    .map((item) => `- line ${item.lineNumber} / ${item.patternName} seq ${item.seq}: routeName="${item.routeStopName}" stopId=${item.stopId} by_code="${item.byCode.name}"`)
    .join('\n') || '- none';

  const coordExamples = coordinateWarnings.slice(0, 10)
    .map((item) => `- line ${item.lineNumber} / ${item.patternName} seq ${item.seq}: ${item.routeStopName} (${item.stopId}) by_code_coord=${item.byCode.coordinateNumeric} group_coord=${item.routeGroup.coordinateNumeric}`)
    .join('\n') || '- none';

  const displayExamples = codeDisplayWarnings.slice(0, 10)
    .map((item) => `- line ${item.lineNumber} / ${item.patternName} seq ${item.seq}: ${item.routeStopName} (${item.stopId}) routeGroup=${item.routeGroup.name ?? 'none'} groupsWithCode=[${item.codeMembership.groupsContainingStopId.join(', ')}]`)
    .join('\n') || '- none';

  const report = `# Route Pattern vs BUS_DATA Compare Report\n\nGenerated: ${outJson.generatedAt}\n\n## Coverage\n\n- Patterns parsed: ${outJson.summary.patternCount}\n- Line numbers: ${outJson.summary.lineNumbers.join(', ')}\n- Stop refs checked: ${outJson.summary.stopRefCount}\n- Unique stop IDs: ${outJson.summary.uniqueStopIdCount}\n\n## Pattern Table\n\n| lineNumber | patternName | sourceFile | stopCount |\n|---|---|---|---:|\n${patternRows}\n\n## Summary Warnings\n\n- Missing stop IDs from BUS_DATA.by_code: ${outJson.summary.missingStopIdCount}\n- Group/name mismatches: ${outJson.summary.groupNameMismatchCount}\n- Coordinate warnings: ${outJson.summary.coordinateWarningCount}\n- code/displayCodes membership warnings: ${outJson.summary.codeDisplayWarningCount}\n- Duplicate stop names with multiple stop IDs: ${outJson.summary.duplicateStopNameMultiStopIdCount}\n\n## Duplicate Stop-Name Examples\n\n${duplicateBullets}\n\n## Focus Risk Groups\n\n${focusSection}\n\n## Group/Name Mismatch Examples\n\n${mismatchExamples}\n\n## Coordinate Warning Examples\n\n${coordExamples}\n\n## code/displayCodes Warning Examples\n\n${displayExamples}\n\n## Direction Pair Audit Note\n\n- Liin 1: Näpi / Narva / Kauba / Raudteejaam / Polikliinik\n- Liin 3: Õie / Tulika / Haigla / Tõrma kalmistu\n- Liin 5: Kivi / Piiri / Kungla / Polikliinik / Kesk / Teater\n\nThis audit establishes route-pattern / direction truth from parsed stop sequences and BUS_DATA mapping checks. It does not validate physical coordinate correctness in real-world geography.\n`;

  await fs.writeFile(outReportPath, report, 'utf8');

  const output = {
    generatedJson: path.relative(repoRoot, outJsonPath).replaceAll('\\', '/'),
    generatedReport: path.relative(repoRoot, outReportPath).replaceAll('\\', '/'),
    summary: outJson.summary
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});