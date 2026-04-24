import { BUS_DATA } from '../data/busData';

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
  for (const g of BUS_DATA.groups) {
    const dist = hav(lat, lon, g.lat, g.lon);
    if (dist < bestDist) {
      bestDist = dist;
      best = g;
    }
  }
  return best ? { ...best, dist: Math.round(bestDist) } : null;
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
