import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const outputJsonPath = path.join(repoRoot, 'docs', 'audit', 'gtfs-source-discovery.json');
const outputReportPath = path.join(repoRoot, 'docs', 'audit', 'gtfs-source-discovery-report.md');

const baseCandidates = [
  'https://peatus.ee/gtfs/gtfs.zip',
  'https://eu-gtfs.remix.com/estonia_unified_gtfs.zip',
  'https://eu-gtfs.remix.com/laanevirumaa.zip',
  'https://eu-gtfs.remix.com/laane-virumaa.zip',
  'https://eu-gtfs.remix.com/läänevirumaa.zip',
  'https://eu-gtfs.remix.com/west-viru.zip',
  'https://eu-gtfs.remix.com/laane-viru.zip'
];

const docSources = [
  path.join(repoRoot, 'docs', 'audit', 'route-pattern-stopid-report.md'),
  path.join(repoRoot, 'docs', 'audit', 'route-pattern-busdata-compare-report.md')
];

const headBlockedStatuses = new Set([401, 403, 405, 429, 500, 501, 502, 503]);

function parseContentLength(value) {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isZipLike(contentType, url) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('application/zip')) return true;
  if (ct.includes('application/x-zip')) return true;
  if (ct.includes('application/octet-stream')) return true;
  return String(url).toLowerCase().endsWith('.zip');
}

function isStrongZipCandidate(item) {
  const ct = String(item?.contentType || '').toLowerCase();
  if (ct.includes('application/zip')) return true;
  if (ct.includes('application/x-zip')) return true;
  if (ct.includes('application/octet-stream')) return true;

  if (ct.includes('text/html') || ct.includes('application/xml') || ct.includes('text/xml')) {
    return false;
  }

  return false;
}

async function extractAdditionalUrls() {
  const found = new Set();
  const urlRe = /https?:\/\/[^\s)>'"`]+/gi;

  for (const doc of docSources) {
    try {
      const text = await fs.readFile(doc, 'utf8');
      const matches = text.match(urlRe) ?? [];
      for (const raw of matches) {
        const cleaned = raw.replace(/[.,;:!?]+$/, '');
        if (/gtfs/i.test(cleaned) || /remix\.com/i.test(cleaned) || /peatus\.ee/i.test(cleaned)) {
          found.add(cleaned);
        }
      }
    } catch {
      // ignore missing doc source
    }
  }

  return [...found];
}

async function doHead(url) {
  const response = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
    headers: {
      'User-Agent': 'AnniVibe GTFS discovery audit'
    }
  });

  return {
    methodUsed: 'HEAD',
    response
  };
}

async function doRangeGet(url) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      Range: 'bytes=0-0',
      'User-Agent': 'AnniVibe GTFS discovery audit'
    }
  });

  if (response.body) {
    try {
      await response.body.cancel();
    } catch {
      // ignore body cancel failures
    }
  }

  return {
    methodUsed: 'GET(range)',
    response
  };
}

function pickRecommendation(results) {
  const reachableZip = results.filter((item) => item.reachable && isZipLike(item.contentType, item.url));
  if (!reachableZip.length) return null;

  const strongZip = reachableZip.filter((item) => isStrongZipCandidate(item));
  if (strongZip.length) {
    for (const candidate of priorityOrder()) {
      const hit = strongZip.find((item) => item.url === candidate);
      if (hit) return hit;
    }
    return strongZip[0] ?? null;
  }

  for (const candidate of priorityOrder()) {
    const hit = reachableZip.find((item) => item.url === candidate);
    if (hit) return hit;
  }

  return reachableZip[0] ?? null;
}

function priorityOrder() {
  const priority = [
    'https://eu-gtfs.remix.com/laanevirumaa.zip',
    'https://eu-gtfs.remix.com/laane-virumaa.zip',
    'https://eu-gtfs.remix.com/west-viru.zip',
    'https://eu-gtfs.remix.com/laane-viru.zip',
    'https://peatus.ee/gtfs/gtfs.zip',
    'https://eu-gtfs.remix.com/estonia_unified_gtfs.zip',
    'https://eu-gtfs.remix.com/läänevirumaa.zip'
  ];
  return priority;
}

async function probeUrl(url) {
  let methodUsed = 'HEAD';
  let response = null;
  let notes = [];

  try {
    const head = await doHead(url);
    response = head.response;
    methodUsed = head.methodUsed;

    if (headBlockedStatuses.has(response.status)) {
      notes.push(`HEAD blocked/limited with status ${response.status}; tried safe range GET.`);
      const fallback = await doRangeGet(url);
      response = fallback.response;
      methodUsed = 'HEAD -> GET(range)';
    }
  } catch (error) {
    notes.push(`HEAD request error: ${error?.message ?? String(error)}`);
    try {
      const fallback = await doRangeGet(url);
      response = fallback.response;
      methodUsed = 'HEAD(error) -> GET(range)';
      notes.push('Fallback range GET executed.');
    } catch (fallbackError) {
      return {
        url,
        methodUsed: 'HEAD(error), GET(range error)',
        httpStatus: null,
        contentType: null,
        contentLength: null,
        reachable: false,
        notes: `${notes.join(' ')} GET(range) error: ${fallbackError?.message ?? String(fallbackError)}`.trim()
      };
    }
  }

  const contentType = response.headers.get('content-type');
  const contentLength = parseContentLength(response.headers.get('content-length'));
  const reachable = response.ok;

  if (response.url && response.url !== url) {
    notes.push(`Redirected to ${response.url}`);
  }

  if (methodUsed.includes('GET(range)') && response.status === 200) {
    notes.push('Range request returned 200; server likely ignored Range but response was not fully downloaded.');
  }

  if (!reachable && !notes.length) {
    notes.push('Non-success status.');
  }

  return {
    url,
    methodUsed,
    httpStatus: response.status,
    contentType,
    contentLength,
    reachable,
    notes: notes.join(' ').trim() || null
  };
}

function toMarkdownTableRows(results) {
  return results
    .map((item) => {
      const note = (item.notes || '').replace(/\|/g, '\\|');
      return `| ${item.url} | ${item.methodUsed} | ${item.httpStatus ?? 'n/a'} | ${item.contentType ?? 'n/a'} | ${item.contentLength ?? 'n/a'} | ${item.reachable ? 'true' : 'false'} | ${note || '-'} |`;
    })
    .join('\n');
}

async function main() {
  const extraUrls = await extractAdditionalUrls();
  const candidates = [...new Set([...baseCandidates, ...extraUrls])];

  const results = [];
  for (const url of candidates) {
    const result = await probeUrl(url);
    results.push(result);
  }

  const reachableCount = results.filter((item) => item.reachable).length;
  const recommended = pickRecommendation(results);

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceDocsScanned: docSources.map((doc) => path.relative(repoRoot, doc).replaceAll('\\', '/')),
    checkedUrls: candidates,
    results,
    summary: {
      checkedCount: results.length,
      reachableCount,
      recommendedSource: recommended
        ? {
            url: recommended.url,
            methodUsed: recommended.methodUsed,
            httpStatus: recommended.httpStatus,
            contentType: recommended.contentType,
            contentLength: recommended.contentLength
          }
        : null,
      recommendationNote: recommended
        ? 'Recommended based on reachable ZIP-like response and regional-first priority.'
        : 'No reliable reachable GTFS ZIP source found from candidate set.'
    }
  };

  await fs.writeFile(outputJsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const md = `# GTFS Source Discovery\n\nGenerated: ${payload.generatedAt}\n\n## Summary\n\n- Checked URLs: ${payload.summary.checkedCount}\n- Reachable feeds: ${payload.summary.reachableCount}\n- Recommendation: ${payload.summary.recommendedSource ? payload.summary.recommendedSource.url : 'No reliable source found'}\n- Note: ${payload.summary.recommendationNote}\n\n## Checked Sources\n\n| url | method used | httpStatus | contentType | contentLength | reachable | notes |\n|---|---|---:|---|---:|---|---|\n${toMarkdownTableRows(results)}\n\n## Recommendation for next GTFS coordinate extraction\n\n${payload.summary.recommendedSource ? `Use: \`${payload.summary.recommendedSource.url}\` (status ${payload.summary.recommendedSource.httpStatus}, type ${payload.summary.recommendedSource.contentType ?? 'n/a'}).` : 'No reliable GTFS source found from current candidates; add/verify a new official feed URL before extraction.'}\n\nDo not download the full GTFS ZIP repeatedly; cache it once for extraction passes.\n\nNext pass: GTFS coordinate extraction / Rakvere stop extract.\n`;

  await fs.writeFile(outputReportPath, md, 'utf8');

  process.stdout.write(`${JSON.stringify({
    outputJson: path.relative(repoRoot, outputJsonPath).replaceAll('\\', '/'),
    outputReport: path.relative(repoRoot, outputReportPath).replaceAll('\\', '/'),
    checked: results.length,
    reachable: reachableCount,
    recommended: payload.summary.recommendedSource?.url ?? null
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
