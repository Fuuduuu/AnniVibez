import { useEffect, useState } from 'react';
import { AV, card } from '../design/tokens';
import { deps, nearest } from '../utils/bus';

export function BussCard({ savedPlaces = [], onOpenBuss }) {
  const [stop, setStop] = useState(null);
  const [stopDeps, setStopDeps] = useState([]);
  const [gpsState, setGpsState] = useState('idle');

  useEffect(() => {
    setGpsState('searching');
    const fallback = setTimeout(() => {
      const first = savedPlaces.find(p => p?.lat != null && p?.lon != null);
      if (first) {
        const g = nearest(parseFloat(first.lat), parseFloat(first.lon));
        if (g) {
          setStop(g);
          setStopDeps(deps(g.codes, 2));
        }
      }
      setGpsState('fallback');
    }, 4000);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => {
          clearTimeout(fallback);
          const g = nearest(p.coords.latitude, p.coords.longitude);
          if (g) {
            setStop(g);
            setStopDeps(deps(g.codes, 2));
          }
          setGpsState('ok');
        },
        () => {
          setGpsState('error');
        },
        { timeout: 4000 }
      );
    }

    return () => clearTimeout(fallback);
  }, [savedPlaces]);

  const dotColor = {
    ok: AV.sage,
    searching: '#EF9F27',
    error: '#E24B4A',
    fallback: AV.sage,
    idle: '#EF9F27',
  }[gpsState];

  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: AV.text }}>
          {stop ? `${stop.name}${stop.dist != null ? ` · ${stop.dist} m` : ''}` : 'Otsin lähimat peatust…'}
        </span>
      </div>

      {stopDeps.length > 0 ? (
        stopDeps.map((d, i) => (
          <div
            key={`${d.time}-${d.line}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 0',
              borderBottom: i < stopDeps.length - 1 ? `1px solid ${AV.border}` : 'none',
            }}
          >
            <span style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 58, color: AV.text }}>
              {d.time}
            </span>
            <span
              style={{
                background: AV.sageL,
                color: AV.sage,
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 4,
                padding: '2px 7px',
                marginRight: 8,
                flexShrink: 0,
              }}
            >
              Liin {d.line}
              {d.v ? `·${d.v}` : ''}
            </span>
            <span style={{ fontSize: 13, color: AV.textSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.dir}</span>
          </div>
        ))
      ) : (
        <div style={{ fontSize: 13, color: AV.muted, textAlign: 'center', padding: '8px 0' }}>{stop ? 'Täna enam busse pole' : 'Laen väljumisi…'}</div>
      )}

      {stopDeps.length > 0 && (
        <div style={{ fontSize: 11, color: AV.muted, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${AV.border}` }}>
          Ajad on sõiduplaani järgi
        </div>
      )}

      <button
        onClick={onOpenBuss}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '9px 0',
          marginTop: 8,
          border: 'none',
          borderTop: `1px solid ${AV.border}`,
          background: 'none',
          cursor: 'pointer',
          fontSize: 13,
          color: AV.muted,
        }}
      >
        <span>Ava buss</span>
        <span>→</span>
      </button>
    </div>
  );
}
