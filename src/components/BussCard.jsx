import { useEffect, useState } from 'react';
import { ShellIcon } from './ShellIcon';
import { deps, nearest } from '../utils/bus';

export function BussCard({ savedPlaces = [], onOpenBuss }) {
  const [stop, setStop] = useState(null);
  const [stopDeps, setStopDeps] = useState([]);
  const [gpsState, setGpsState] = useState('idle');

  function originCodesFrom(stopLike) {
    const raw =
      stopLike?.displayCodes ||
      stopLike?.codes ||
      (stopLike?.code ? [stopLike.code] : []);
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  }

  useEffect(() => {
    setGpsState('searching');
    const fallback = setTimeout(() => {
      const first = savedPlaces.find(p => p?.lat != null && p?.lon != null);
      if (first) {
        const g = nearest(parseFloat(first.lat), parseFloat(first.lon));
        if (g) {
          setStop(g);
          setStopDeps(deps(originCodesFrom(g), 2));
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
            setStopDeps(deps(originCodesFrom(g), 2));
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

  const alternateStops = Array.isArray(stop?.candidates)
    ? stop.candidates.filter(c => c.code !== stop.code).slice(0, 2)
    : [];

  return (
    <div className="mm-card mm-card-primary mm-bus-card">
      <div className="mm-bus-stop">
        <span className="mm-bus-dot" data-state={gpsState} aria-hidden="true" />
        <span className="mm-bus-stop-name">{stop ? stop.name : 'Otsin lähimat peatust…'}</span>
        {stop?.dist != null && <span className="mm-bus-distance">{stop.dist} m</span>}
      </div>
      {alternateStops.length > 0 && (
        <p className="mm-bus-alt">
          Lähedal ka: {alternateStops.map(c => `${c.name}${c.dist != null ? ` (${c.dist} m)` : ''}`).join(' · ')}
        </p>
      )}

      <div className="mm-bus-departures">
        {stopDeps.length > 0 ? (
          stopDeps.map((d, i) => (
            <div key={`${d.time}-${d.line}-${i}`} className="mm-bus-departure">
              <span className="mm-bus-time">{d.time}</span>
              <span className="mm-line-badge">
                Liin {d.line}
                {d.v ? `·${d.v}` : ''}
              </span>
              <span className="mm-bus-headsign" title={d.dir}>{d.dir}</span>
            </div>
          ))
        ) : (
          <p className="mm-bus-empty">{stop ? 'Täna enam busse pole' : 'Laen väljumisi…'}</p>
        )}
      </div>

      <div className="mm-bus-footer">
        {stopDeps.length > 0 && <span className="mm-bus-note">Ajad on sõiduplaani järgi</span>}
        <button className="mm-bus-open" onClick={onOpenBuss}>
          <span>Ava buss</span>
          <ShellIcon name="next" />
        </button>
      </div>
    </div>
  );
}
