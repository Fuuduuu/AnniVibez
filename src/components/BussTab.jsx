import { useState } from 'react';
import { AV, FONT, card, inp, labelStyle, shell } from '../design/tokens';
import { BUS_DATA } from '../data/busData';
import { depsWithMeta, nearest, wd } from '../utils/bus';

function DepRow({ d }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${AV.border}` }}>
      <span style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 62, color: AV.text }}>{d.time}</span>
      <span
        style={{
          background: AV.sageL,
          color: AV.sage,
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 4,
          padding: '2px 8px',
          marginRight: 10,
          flexShrink: 0,
        }}
      >
        Liin {d.line}
        {d.v ? `·${d.v}` : ''}
      </span>
      <span style={{ fontSize: 13, color: AV.textSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.dir}</span>
    </div>
  );
}

export function BussTab({ savedPlaces = [] }) {
  const [stop, setStop] = useState(null);
  const [stopDeps, setStopDeps] = useState([]);
  const [destination, setDestination] = useState('');
  const [emptyReason, setEmptyReason] = useState('');
  const [gpsState, setGpsState] = useState('idle');
  const [activePill, setActivePill] = useState(null);

  function refreshDeps(nextStop, nextDestination = destination) {
    const originCodes = nextStop?.code ? [nextStop.code] : nextStop?.codes || [];
    const { departures, reason } = depsWithMeta(originCodes, 3, {
      destination: nextDestination || null,
    });
    setStopDeps(departures);
    setEmptyReason(reason);
  }

  function setSt(g, pillIdx = null) {
    setStop(g);
    refreshDeps(g);
    setActivePill(pillIdx);
  }

  function gpsClick() {
    setGpsState('searching');
    if (!navigator.geolocation) {
      setGpsState('error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      p => {
        const g = nearest(p.coords.latitude, p.coords.longitude);
        if (g) setSt(g);
        setGpsState('ok');
      },
      () => setGpsState('error'),
      { timeout: 6000, enableHighAccuracy: true }
    );
  }

  const gpsLabel = {
    idle: 'Leia lähim peatus (GPS)',
    searching: 'Otsin sinu asukohta…',
    ok: stop ? `GPS: ${stop.name} (${stop.dist} m)` : 'GPS leitud',
    error: 'GPS-i luba puudub, vali peatus käsitsi',
  }[gpsState];
  const dotColor = { ok: AV.sage, searching: '#EF9F27', error: '#E24B4A', idle: AV.purple }[gpsState];

  const validSaved = savedPlaces.filter(p => p?.lat != null && p?.lon != null);

  return (
    <div style={shell}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 10, ...labelStyle }}>Buss</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: AV.text, fontFamily: FONT.display, marginBottom: 4 }}>Rakvere linnaliinid</div>
        <div style={{ fontSize: 13, color: AV.muted, lineHeight: 1.5 }}>Vaata kiiresti, millal järgmised bussid tulevad.</div>
      </div>

      <button
        onClick={gpsClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          width: '100%',
          background: AV.bg,
          border: `1px solid ${AV.border}`,
          borderRadius: 14,
          cursor: 'pointer',
          fontSize: 14,
          color: AV.textSoft,
          boxShadow: AV.shadowSm,
          marginBottom: 14,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, flexShrink: 0, animation: gpsState === 'searching' ? 'av-pulse 1s infinite' : 'none' }} />
        {gpsLabel}
      </button>

      <div style={{ fontSize: 10, ...labelStyle, marginBottom: 8 }}>Kiirvalik</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {validSaved.map((p, i) => (
          <button
            key={`${p.name}-${i}`}
            onClick={() => {
              const g = nearest(parseFloat(p.lat), parseFloat(p.lon));
              if (g) setSt(g, i);
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 100,
              fontSize: 13,
              cursor: 'pointer',
              border: `1.5px solid ${activePill === i ? AV.purple : AV.border}`,
              background: activePill === i ? AV.purpleL : 'none',
              color: activePill === i ? AV.purple : AV.muted,
              transition: 'all .15s',
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ fontSize: 10, ...labelStyle, marginBottom: 6 }}>Peatus</div>
        <div style={{ fontSize: 17, fontWeight: 600, color: AV.text, marginBottom: 3 }}>{stop?.name ?? 'Vali peatus'}</div>
        <div style={{ fontSize: 12, color: AV.muted, marginBottom: 10 }}>
          {stop ? (stop.dist != null ? `Lähim · ${stop.dist} m` : 'Valitud nimekirjast') : 'Kasuta GPS-i või vali nimekirjast'}
        </div>
        <select
          onChange={e => {
            const g = BUS_DATA.groups.find(x => x.name === e.target.value);
            if (!g?.codes?.length) return;
            const code = g.codes[0];
            const point = BUS_DATA.by_code?.[code];
            setSt({
              name: g.name,
              groupName: g.name,
              code,
              stopId: code,
              codes: [code],
              displayCodes: [...g.codes],
              lat: Number(point?.lat),
              lon: Number(point?.lon),
              dist: null,
            });
          }}
          style={{ ...inp, marginTop: 0 }}
          value={stop?.name || ''}
        >
          <option value="">— vali peatus —</option>
          {BUS_DATA.groups.map(g => (
            <option key={g.name} value={g.name}>
              {g.name}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 10, ...labelStyle, marginTop: 14, marginBottom: 6 }}>Sihtkoht (valikuline)</div>
        <select
          onChange={e => {
            const nextDestination = e.target.value;
            setDestination(nextDestination);
            if (stop) refreshDeps(stop, nextDestination);
          }}
          style={{ ...inp, marginTop: 0 }}
          value={destination}
        >
          <option value="">— vali sihtkoht —</option>
          {BUS_DATA.groups.map(g => (
            <option key={`dest-${g.name}`} value={g.name}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div style={card}>
        <div style={{ fontSize: 10, ...labelStyle, marginBottom: 2 }}>Järgmised väljumised</div>
        {!stop ? (
          <div style={{ fontSize: 13, color: AV.muted, textAlign: 'center', padding: '16px 0' }}>Vali peatus, et näha väljumisi</div>
        ) : stopDeps.length === 0 ? (
          <div style={{ fontSize: 13, color: AV.muted, textAlign: 'center', padding: '16px 0' }}>{emptyReason || `Täna enam busse pole · ${wd()}`}</div>
        ) : (
          <>
            {stopDeps.map((d, i) => (
              <DepRow key={`${d.time}-${d.line}-${i}`} d={d} />
            ))}
            <div style={{ fontSize: 11, color: AV.muted, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${AV.border}` }}>
              Ajad on sõiduplaani järgi
            </div>
          </>
        )}
      </div>
    </div>
  );
}
