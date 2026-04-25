import { useEffect, useState } from 'react';
import { AV, FONT, card, inp, labelStyle, shell } from '../design/tokens';
import { BUS_DATA } from '../data/busData';
import { depsWithMeta, nearest, wd } from '../utils/bus';

function DepRow({ d }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: `1px solid ${AV.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
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
      <div style={{ fontSize: 12, color: AV.muted }}>
        Mine peatusesse: {d.originName}
        {d.originDist != null ? ` · ${d.originDist} m` : ''}
      </div>
    </div>
  );
}

export function BussTab({ savedPlaces = [] }) {
  const [currentOrigin, setCurrentOrigin] = useState(null);
  const [manualOriginOverride, setManualOriginOverride] = useState(null);
  const [originOverrideOpen, setOriginOverrideOpen] = useState(false);
  const [nearbyOriginCandidates, setNearbyOriginCandidates] = useState([]);
  const [routeOptions, setRouteOptions] = useState([]);
  const [destination, setDestination] = useState('');
  const [emptyReason, setEmptyReason] = useState('');
  const [gpsState, setGpsState] = useState('idle');
  const [activePill, setActivePill] = useState(null);

  function originCodesFrom(stopLike) {
    const raw =
      stopLike?.displayCodes ||
      stopLike?.codes ||
      (stopLike?.code ? [stopLike.code] : []);
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  }

  function mapOriginGroupToChoice(groupName) {
    const group = BUS_DATA.groups.find(x => x.name === groupName);
    if (!group?.codes?.length) return null;
    const code = group.codes[0];
    const point = BUS_DATA.by_code?.[code];
    return {
      name: group.name,
      groupName: group.name,
      code,
      stopId: code,
      codes: [code],
      displayCodes: [...group.codes],
      lat: Number(point?.lat),
      lon: Number(point?.lon),
      dist: null,
    };
  }

  function setDetectedOrigin(nextOrigin, pillIdx = null, choices = null) {
    setCurrentOrigin(nextOrigin);
    setManualOriginOverride(null);
    setOriginOverrideOpen(false);
    setActivePill(pillIdx);
    if (Array.isArray(choices)) {
      setNearbyOriginCandidates(choices);
      return;
    }
    if (Array.isArray(nextOrigin?.candidates) && nextOrigin.candidates.length > 1) {
      setNearbyOriginCandidates(nextOrigin.candidates);
      return;
    }
    setNearbyOriginCandidates([]);
  }

  function findRouteOptions(origin, selectedDestination, service, nearbyCandidates) {
    if (!selectedDestination) {
      return { options: [], reason: '' };
    }
    if (!origin) {
      return { options: [], reason: 'Vali lähtekoht, et näha marsruute' };
    }

    const originName = origin?.groupName || origin?.name || '';
    if (originName && originName === selectedDestination) {
      return { options: [], reason: 'Vali erinev sihtkoht' };
    }

    const originCodes = originCodesFrom(origin);
    if (!originCodes.length) {
      return { options: [], reason: 'Vali lähtekoht, et näha marsruute' };
    }

    const primary = depsWithMeta(originCodes, 5, { destination: selectedDestination, service });
    const mappedPrimary = primary.departures.map(dep => ({
      ...dep,
      originName: origin?.groupName || origin?.name || 'Valitud peatus',
      originDist: origin?.dist ?? null,
      originStopId: dep.originStopId || origin?.stopId || origin?.code || null,
    }));
    if (mappedPrimary.length > 0) {
      return { options: mappedPrimary.slice(0, 5), reason: '' };
    }

    const fallbackPool = Array.isArray(nearbyCandidates)
      ? nearbyCandidates.filter(choice => choice?.code && choice.code !== origin?.code).slice(0, 2)
      : [];

    const merged = [];
    for (const alt of fallbackPool) {
      const altCodes = originCodesFrom(alt);
      if (!altCodes.length) continue;
      const altResult = depsWithMeta(altCodes, 5, { destination: selectedDestination, service });
      if (!altResult.departures.length) continue;
      for (const dep of altResult.departures) {
        merged.push({
          ...dep,
          originName: alt?.groupName || alt?.name || 'Valitud peatus',
          originDist: alt?.dist ?? null,
          originStopId: dep.originStopId || alt?.stopId || alt?.code || null,
        });
      }
    }

    merged.sort((a, b) => a.time.localeCompare(b.time));
    const deduped = [];
    const seen = new Set();
    for (const item of merged) {
      const key = `${item.line}|${item.v || ''}|${item.time}|${item.originStopId || item.originName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
      if (deduped.length >= 5) break;
    }

    return { options: deduped, reason: deduped.length > 0 ? '' : primary.reason };
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
        if (g) setDetectedOrigin(g);
        setGpsState('ok');
      },
      () => setGpsState('error'),
      { timeout: 6000, enableHighAccuracy: true }
    );
  }

  const effectiveOrigin = manualOriginOverride ?? currentOrigin;

  useEffect(() => {
    const { options, reason } = findRouteOptions(effectiveOrigin, destination, wd(), nearbyOriginCandidates);
    setRouteOptions(options);
    setEmptyReason(reason);
  }, [effectiveOrigin, destination, nearbyOriginCandidates]);

  const gpsLabel = {
    idle: 'Leia lähim peatus (GPS)',
    searching: 'Otsin sinu asukohta…',
    ok: currentOrigin ? `GPS: ${currentOrigin.name}${currentOrigin.dist != null ? ` (${currentOrigin.dist} m)` : ''}` : 'GPS leitud',
    error: 'GPS-i luba puudub, vali peatus käsitsi',
  }[gpsState];
  const dotColor = { ok: AV.sage, searching: '#EF9F27', error: '#E24B4A', idle: AV.purple }[gpsState];

  const validSaved = savedPlaces.filter(p => p?.lat != null && p?.lon != null);

  return (
    <div style={shell}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 10, ...labelStyle }}>Buss</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: AV.text, fontFamily: FONT.display, marginBottom: 4 }}>Rakvere linnaliinid</div>
        <div style={{ fontSize: 13, color: AV.muted, lineHeight: 1.5 }}>Vali sihtkoht ja vaata, kuidas sinna kõige paremini jõuda.</div>
      </div>

      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ fontSize: 10, ...labelStyle, marginBottom: 6 }}>Kuhu soovid minna?</div>
        <select
          onChange={e => setDestination(e.target.value)}
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
        <div style={{ fontSize: 12, color: AV.muted, marginTop: 8 }}>
          {destination ? `Valitud sihtkoht: ${destination}` : 'Vali sihtkoht, et näha marsruute'}
        </div>
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

      {validSaved.length > 0 && (
        <>
          <div style={{ fontSize: 10, ...labelStyle, marginBottom: 8 }}>Kiirvalik</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {validSaved.map((p, i) => (
              <button
                key={`${p.name}-${i}`}
                onClick={() => {
                  const g = nearest(parseFloat(p.lat), parseFloat(p.lon));
                  if (g) setDetectedOrigin(g, i);
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
        </>
      )}

      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ fontSize: 10, ...labelStyle, marginBottom: 6 }}>Lähtekoht</div>
        {effectiveOrigin ? (
          <>
            <div style={{ fontSize: 17, fontWeight: 600, color: AV.text, marginBottom: 3 }}>
              Lähtepeatus: {effectiveOrigin.name}
              {effectiveOrigin.dist != null ? ` · ${effectiveOrigin.dist} m` : ''}
            </div>
            <div style={{ fontSize: 12, color: AV.muted, marginBottom: 10 }}>
              {manualOriginOverride ? 'Kasutad käsitsi valitud lähtekohta' : 'Kasutan sinu lähimat peatust'}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: AV.muted, marginBottom: 10 }}>Vali lähtekoht, et näha marsruute</div>
        )}
        {nearbyOriginCandidates.length > 1 && (
          <>
            <div style={{ fontSize: 10, ...labelStyle, marginBottom: 6 }}>Lähedal ka</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {nearbyOriginCandidates
                .filter(choice => choice?.code !== effectiveOrigin?.code)
                .map(choice => {
                const active = effectiveOrigin?.code === choice.code;
                return (
                  <button
                    key={`near-${choice.code}`}
                    onClick={() => setManualOriginOverride(choice)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 100,
                      fontSize: 12,
                      cursor: 'pointer',
                      border: `1.5px solid ${active ? AV.purple : AV.border}`,
                      background: active ? AV.purpleL : 'none',
                      color: active ? AV.purple : AV.muted,
                    }}
                  >
                    {choice.name}
                    {choice.dist != null ? ` · ${choice.dist} m` : ''}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: AV.muted, marginBottom: 10 }}>Kui oled tee teisel pool, vali sobiv peatus.</div>
          </>
        )}
        <button
          onClick={() => setOriginOverrideOpen(open => !open)}
          style={{
            width: '100%',
            border: `1px solid ${AV.border}`,
            background: AV.bg,
            color: AV.textSoft,
            borderRadius: 12,
            cursor: 'pointer',
            padding: '10px 12px',
            fontSize: 13,
            marginBottom: originOverrideOpen ? 10 : 0,
          }}
        >
          {originOverrideOpen ? 'Sulge lähtekoha valik' : 'Muuda lähtekoht'}
        </button>

        {originOverrideOpen && (
          <>
            <select
              onChange={e => {
                const value = e.target.value;
                if (!value) {
                  setManualOriginOverride(null);
                  return;
                }
                const nextManualOrigin = mapOriginGroupToChoice(value);
                if (nextManualOrigin) setManualOriginOverride(nextManualOrigin);
              }}
              style={{ ...inp, marginTop: 0 }}
              value={manualOriginOverride?.name || ''}
            >
              <option value="">— vali lähtekoht —</option>
              {BUS_DATA.groups.map(g => (
                <option key={`origin-${g.name}`} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
            {manualOriginOverride && (
              <button
                onClick={() => setManualOriginOverride(null)}
                style={{
                  width: '100%',
                  border: `1px solid ${AV.border}`,
                  background: AV.bg,
                  color: AV.textSoft,
                  borderRadius: 10,
                  cursor: 'pointer',
                  padding: '8px 12px',
                  fontSize: 12,
                  marginTop: 8,
                }}
              >
                Kasutan sinu lähimat peatust
              </button>
            )}
          </>
        )}
      </div>

      <div style={card}>
        <div style={{ fontSize: 10, ...labelStyle, marginBottom: 2 }}>Marsruut</div>
        {!destination ? (
          <div style={{ fontSize: 13, color: AV.muted, textAlign: 'center', padding: '16px 0' }}>Vali sihtkoht, et näha marsruute</div>
        ) : !effectiveOrigin ? (
          <div style={{ fontSize: 13, color: AV.muted, textAlign: 'center', padding: '16px 0' }}>Vali lähtekoht, et näha marsruute</div>
        ) : routeOptions.length === 0 ? (
          <div style={{ fontSize: 13, color: AV.muted, textAlign: 'center', padding: '16px 0' }}>{emptyReason || `Täna enam busse pole · ${wd()}`}</div>
        ) : (
          <>
            {routeOptions.map((d, i) => (
              <DepRow key={`${d.time}-${d.line}-${d.originStopId || i}`} d={d} />
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
