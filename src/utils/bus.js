import { BUS_DATA } from '../data/busData';

const STOP_POINTS = Object.entries(BUS_DATA.by_code || {})
  .map(([code, stop]) => ({
    code,
    name: stop?.name || '',
    lat: Number(stop?.lat),
    lon: Number(stop?.lon),
  }))
  .filter(p => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon));

const NAME_TO_CODES = STOP_POINTS.reduce((acc, p) => {
  if (!acc.has(p.name)) acc.set(p.name, []);
  acc.get(p.name).push(p.code);
  return acc;
}, new Map());

function hav(a, b, c, e) {
  const R = 6371000;
  const p = Math.PI / 180;
  const f =
    Math.sin(((c - a) * p) / 2) ** 2 +
    Math.cos(a * p) * Math.cos(c * p) * Math.sin(((e - b) * p) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(f));
}

export function wd() {
  const d = new Date().getDay();
  return d === 0 ? 'P' : d === 6 ? 'L' : 'E-R';
}

export function nearest(lat, lon) {
  let best = null;
  let bestDist = Infinity;
  for (const p of STOP_POINTS) {
    const dist = hav(lat, lon, p.lat, p.lon);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  if (!best) return null;

  return {
    code: best.code,
    stopId: best.code,
    name: best.name,
    groupName: best.name,
    lat: best.lat,
    lon: best.lon,
    dist: Math.round(bestDist),
    // Keep existing caller compatibility while preserving stopId routing.
    codes: [best.code],
    displayCodes: [...(NAME_TO_CODES.get(best.name) || [best.code])],
  };
}

export function deps(codes, lim = 3) {
  if (!codes?.length) return [];
  const svc = wd();
  const nowDate = new Date();
  const now =
    String(nowDate.getHours()).padStart(2, '0') +
    ':' +
    String(nowDate.getMinutes()).padStart(2, '0');

  const results = [];
  for (const line of BUS_DATA.lines) {
    if (line.service !== svc) continue;
    for (const stop of line.stops) {
      if (!codes.includes(stop.code)) continue;
      for (const trip of line.trips) {
        for (const st of trip.stop_times) {
          if (st.seq === stop.seq && st.time >= now) {
            results.push({
              line: line.line,
              v: line.variant || '',
              dir: line.direction,
              time: st.time,
            });
          }
        }
      }
      break;
    }
  }

  results.sort((a, b) => a.time.localeCompare(b.time));
  const seen = new Set();
  const out = [];
  for (const r of results) {
    const key = `${r.line}${r.v}${r.time}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
    if (out.length >= lim) break;
  }
  return out;
}
