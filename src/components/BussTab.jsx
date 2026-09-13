import { useEffect, useState } from 'react';
import { AV, FONT, card, inp, labelStyle, shell } from '../design/tokens';
import { BUS_DATA } from '../data/busData';
import { POI_DATA } from '../data/poiData';
import { BusMapPicker, reachableMapCandidates } from './BusMapPicker';
import { depsWithMeta, nearest, wd } from '../utils/bus';
import { createOriginContext, reachableDestinations, findDirectRoutes } from '../utils/busReach';

const DESTINATION_UNRESOLVED_REASON = 'Sihtkohta ei leitud. Proovi teist nime või vali peatus nimekirjast.';
const DIRECT_CONNECTION_MISSING_REASON = 'Valitud suunal ei leitud praegu sobivat otseliini.';
const MAP_OUT_OF_AREA_REASON = 'Valitud punkt on teeninduspiirkonnast väljas. Vali lähem sihtkoht.';
const DESTINATION_CANDIDATE_LIMIT = 3;
const ROUTE_OPTION_LIMIT = 3;

function nearbyDepartureLabel(time, now) {
  const [hours, minutes] = time.split(':').map(Number);
  const minutesAway = Math.max(0, hours * 60 + minutes - (now.getHours() * 60 + now.getMinutes()));
  return minutesAway === 0 ? 'kohe' : `${minutesAway} min pärast`;
}

function DepRow({ d }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: `1px solid ${AV.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 62, color: AV.text }}>{d.departure}</span>
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
        </span>
        <span style={{ fontSize: 13, color: AV.textSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.destinationName}</span>
      </div>
      <div style={{ fontSize: 12, color: AV.muted, display: 'grid', gap: 2 }}>
        <div>
          Mine peatusesse: {BUS_DATA.by_code[d.boardStopId].name}
        </div>
        <div>
          Väljub: {d.departure}
        </div>
        <div>Välju peatuses: {d.destinationName}</div>
        <div>Kohal: {d.arrival}</div>
      </div>
    </div>
  );
}

export function BussTab({ savedPlaces = [] }) {
  const [currentOrigin, setCurrentOrigin] = useState(null);
  const [manualOriginOverride, setManualOriginOverride] = useState(null);
  const [originOverrideOpen, setOriginOverrideOpen] = useState(false);
  const [nearbyOriginCandidates, setNearbyOriginCandidates] = useState([]);
  const [destination, setDestination] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const [selectedPlaceLabel, setSelectedPlaceLabel] = useState('');
  const [gpsState, setGpsState] = useState('idle');
  const [currentPosition, setCurrentPosition] = useState(null);
  const [activePill, setActivePill] = useState(null);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [mapPickedPoint, setMapPickedPoint] = useState(null);
  const [mapDestinationCandidates, setMapDestinationCandidates] = useState([]);
  const [selectedMapCandidate, setSelectedMapCandidate] = useState('');
  const [activeMapDestinationCandidates, setActiveMapDestinationCandidates] = useState([]);
  const [selectedDestinationSource, setSelectedDestinationSource] = useState('none');
  const [selectedPoiId, setSelectedPoiId] = useState('');
  const [destinationResolutionError, setDestinationResolutionError] = useState('');
  const [mapPickError, setMapPickError] = useState('');
  const [nearbyClock, setNearbyClock] = useState(() => ({ now: new Date(), service: wd() }));

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

  function normalizeSearchText(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/õ/g, 'o')
      .replace(/[öó]/g, 'o')
      .replace(/[äá]/g, 'a')
      .replace(/[üú]/g, 'u');
  }

  function getMatchRank(candidateValues, queryNorm) {
    let rank = null;
    for (const raw of candidateValues) {
      const valueNorm = normalizeSearchText(raw);
      if (!valueNorm) continue;
      if (valueNorm === queryNorm) rank = rank == null ? 0 : Math.min(rank, 0);
      else if (valueNorm.startsWith(queryNorm)) rank = rank == null ? 1 : Math.min(rank, 1);
      else if (valueNorm.includes(queryNorm)) rank = rank == null ? 2 : Math.min(rank, 2);
    }
    return rank;
  }

  function dedupeGroupNames(values) {
    const out = [];
    const seen = new Set();
    for (const raw of values || []) {
      const name = String(raw || '').trim();
      if (!name) continue;
      const key = normalizeSearchText(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }

  function isFiniteCoord(value) {
    return Number.isFinite(Number(value));
  }

  function clearMapPickState() {
    setMapPickedPoint(null);
    setMapDestinationCandidates([]);
    setSelectedMapCandidate('');
    setMapPickError('');
  }

  function resolveDestinationGroupFromMapStop(rawStopName) {
    const stopName = String(rawStopName || '').trim();
    if (!stopName) return null;

    const codeGroup = BUS_DATA.groups.find(group => Array.isArray(group.codes) && group.codes.includes(stopName));
    if (codeGroup) return codeGroup.name;

    const stopNorm = normalizeSearchText(stopName);
    if (!stopNorm) return null;

    const exact = BUS_DATA.groups.find(group => normalizeSearchText(group.name) === stopNorm);
    if (exact) return exact.name;

    const fuzzy = BUS_DATA.groups.find(group => {
      const groupNorm = normalizeSearchText(group.name);
      return groupNorm.includes(stopNorm) || stopNorm.includes(groupNorm);
    });
    return fuzzy?.name || null;
  }

  function resolveMapDestinationCandidates(nearestStops, lat, lon) {
    const candidateNames = Array.isArray(nearestStops) ? nearestStops : [];
    const deduped = [];
    const seen = new Set();

    for (const rawName of candidateNames) {
      const groupName = resolveDestinationGroupFromMapStop(rawName);
      if (!groupName) continue;
      const key = normalizeSearchText(groupName);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({ id: `map-${groupName}`, groupName, sourceName: String(rawName || groupName) });
    }

    if (!deduped.length && Number.isFinite(lat) && Number.isFinite(lon)) {
      const nearestGroup = nearest(lat, lon);
      const groupName = resolveDestinationGroupFromMapStop(
        nearestGroup?.groupName || nearestGroup?.name || nearestGroup?.code || ''
      );
      if (groupName) {
        deduped.push({ id: `map-${groupName}`, groupName, sourceName: groupName });
      }
    }

    return deduped.slice(0, 3);
  }

  function handleMapPick(payload) {
    const lat = Number(payload?.lat);
    const lon = Number(payload?.lon);
    const nearestHit = !originContext && Number.isFinite(lat) && Number.isFinite(lon) ? nearest(lat, lon) : null;

    if (nearestHit?.dist != null && nearestHit.dist > 3000) {
      setMapPickedPoint(Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null);
      setMapDestinationCandidates([]);
      setSelectedMapCandidate('');
      setMapPickError(MAP_OUT_OF_AREA_REASON);
      setDestinationResolutionError(MAP_OUT_OF_AREA_REASON);
      return;
    }

    setDestinationResolutionError('');
    setMapPickError('');
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    if (originContext && !candidates.length) setMapPickError(DIRECT_CONNECTION_MISSING_REASON);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      setMapPickedPoint({ lat, lon });
    } else {
      setMapPickedPoint(null);
    }
    setMapDestinationCandidates(candidates);
    setSelectedMapCandidate(candidates[0]?.groupName || '');
  }

  function confirmMapDestinationCandidate() {
    const candidate = visibleMapCandidates.find(item => item.groupName === selectedMapCandidate);
    if (!candidate?.stopIds?.length) return;
    setActiveMapDestinationCandidates([candidate]);
    setSelectedDestinationSource('map');
    setSelectedPoiId('');
    setDestinationResolutionError('');
    setMapPickError('');
    setDestination(selectedMapCandidate);
    setSelectedPlaceLabel(selectedMapCandidate);
    setPlaceQuery(selectedMapCandidate);
    setMapPickerOpen(false);
    clearMapPickState();
  }

  function buildDestinationCandidates(selectedDestination, destinationSource, poiId, mapCandidates, fallbackError) {
    if (!selectedDestination) {
      return { candidates: [], unresolvedReason: fallbackError || '' };
    }

    if (destinationSource === 'map') {
      if (fallbackError === MAP_OUT_OF_AREA_REASON) {
        return { candidates: [], unresolvedReason: MAP_OUT_OF_AREA_REASON };
      }
      const mapNames = dedupeGroupNames(
        Array.isArray(mapCandidates) && mapCandidates.length > 0 ? mapCandidates : [selectedDestination]
      ).slice(0, DESTINATION_CANDIDATE_LIMIT);
      return {
        candidates: mapNames,
        unresolvedReason: mapNames.length > 0 ? '' : DESTINATION_UNRESOLVED_REASON,
      };
    }

    if (destinationSource === 'poi' && poiId) {
      const poi = POI_DATA.find(item => item.id === poiId && item.enabled);
      const names = [];

      if (poi) {
        names.push(...(Array.isArray(poi.preferredStopGroups) ? poi.preferredStopGroups.slice(0, 2) : []));
        if (poi.coordVerified && isFiniteCoord(poi.lat) && isFiniteCoord(poi.lon)) {
          const nearestPoi = nearest(Number(poi.lat), Number(poi.lon));
          const nearestNames = [
            ...(Array.isArray(nearestPoi?.candidates)
              ? nearestPoi.candidates.map(choice => choice?.groupName || choice?.name)
              : []),
            nearestPoi?.groupName || nearestPoi?.name || '',
          ];
          names.push(...nearestNames);
        }
      }

      if (!names.length) names.push(selectedDestination);
      const resolved = dedupeGroupNames(names).slice(0, DESTINATION_CANDIDATE_LIMIT);
      return {
        candidates: resolved,
        unresolvedReason: resolved.length > 0 ? '' : DESTINATION_UNRESOLVED_REASON,
      };
    }

    const dropdown = dedupeGroupNames([selectedDestination]).slice(0, DESTINATION_CANDIDATE_LIMIT);
    return {
      candidates: dropdown,
      unresolvedReason: dropdown.length > 0 ? '' : DESTINATION_UNRESOLVED_REASON,
    };
  }

  function gpsClick() {
    setGpsState('searching');
    if (!navigator.geolocation) {
      setGpsState('error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      p => {
        setNearbyClock({ now: new Date(), service: wd() });
        const nextLat = Number(p?.coords?.latitude);
        const nextLon = Number(p?.coords?.longitude);
        if (Number.isFinite(nextLat) && Number.isFinite(nextLon)) {
          setCurrentPosition({ lat: nextLat, lon: nextLon });
        }
        const g = nearest(p.coords.latitude, p.coords.longitude);
        if (g) setDetectedOrigin(g);
        setGpsState('ok');
      },
      () => setGpsState('error'),
      { timeout: 6000, enableHighAccuracy: true }
    );
  }

  const effectiveOrigin = manualOriginOverride ?? currentOrigin;
  const service = wd();
  const originStopId = effectiveOrigin?.stopId || effectiveOrigin?.code;
  const originContext = originStopId ? createOriginContext(originStopId) : null;
  const destinationGroups = originStopId
    ? reachableDestinations(originContext, { service })
    : BUS_DATA.groups;
  const destinationInDropdown = destinationGroups.some(group => group.name === destination);
  const reachableMapStopIds = originContext ? new Set(destinationGroups.flatMap(group => group.stopIds)) : null;
  const visibleMapCandidates = mapPickedPoint && reachableMapStopIds
    ? reachableMapCandidates(mapPickedPoint.lat, mapPickedPoint.lon, [...reachableMapStopIds])
    : mapDestinationCandidates;
  const visibleMapError = mapPickedPoint && reachableMapStopIds && !visibleMapCandidates.length
    ? DIRECT_CONNECTION_MISSING_REASON : mapPickError;
  const activeMapStopIds = activeMapDestinationCandidates.flatMap(candidate => candidate.stopIds)
    .filter(id => !reachableMapStopIds || reachableMapStopIds.has(id));

  // Reject stale draft/confirmed identities before a render can publish old routes.
  if (mapPickerOpen && mapPickedPoint && !visibleMapCandidates.some(candidate => candidate.groupName === selectedMapCandidate)
      && selectedMapCandidate !== (visibleMapCandidates[0]?.groupName || '')) {
    setSelectedMapCandidate(visibleMapCandidates[0]?.groupName || '');
  }
  if (selectedDestinationSource === 'map' && destination && originContext && !activeMapStopIds.length) {
    setDestination('');
    setSelectedPlaceLabel('');
    setPlaceQuery('');
    setSelectedDestinationSource('none');
    setActiveMapDestinationCandidates([]);
    setDestinationResolutionError('');
  }

  // Revalidate before committing a render.
  if (selectedDestinationSource === 'dropdown' && destination && originStopId && !destinationInDropdown) {
    setDestination('');
    setSelectedPlaceLabel('');
    setPlaceQuery('');
    setSelectedDestinationSource('none');
  }

  const enabledPoiTargets = POI_DATA.filter(poi => poi.enabled && poi.preferredStopGroups?.length > 0);
  const popularPlaceIds = ['poi_kesklinn', 'poi_bussijaam', 'poi_haigla', 'poi_pohjakeskus', 'poi_teater'];
  const popularPlaceTargets = popularPlaceIds
    .map(id => enabledPoiTargets.find(poi => poi.id === id))
    .filter(Boolean);

  const queryNorm = normalizeSearchText(placeQuery);
  const showSearchResults = queryNorm.length >= 2;
  const placeSearchResults = showSearchResults
    ? (() => {
        const poiResults = enabledPoiTargets
          .map(poi => {
            const rank = getMatchRank([poi.label, ...(poi.aliases || [])], queryNorm);
            if (rank == null) return null;
            return {
              type: 'poi',
              id: poi.id,
              label: poi.label,
              subtitle: `Koht · lähim peatus: ${poi.preferredStopGroups[0]}`,
              routeDestination: poi.preferredStopGroups[0],
              rank,
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'et'));

        const usedStopNames = new Set(poiResults.map(result => result.routeDestination));
        const stopResults = BUS_DATA.groups
          .map(group => {
            if (usedStopNames.has(group.name)) return null;
            const rank = getMatchRank([group.name], queryNorm);
            if (rank == null) return null;
            return {
              type: 'stop',
              id: `stop-${group.name}`,
              label: group.name,
              subtitle: 'Peatus',
              routeDestination: group.name,
              rank,
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'et'));

        return [...poiResults, ...stopResults].slice(0, 6);
      })()
    : [];

  function selectDestinationResult(result) {
    setDestination(result.routeDestination);
    setSelectedPlaceLabel(result.type === 'poi' ? result.label : '');
    setPlaceQuery(result.label);
    setSelectedDestinationSource(result.type === 'poi' ? 'poi' : 'dropdown');
    setSelectedPoiId(result.type === 'poi' ? result.id : '');
    setActiveMapDestinationCandidates([]);
    setDestinationResolutionError('');
    setMapPickerOpen(false);
    clearMapPickState();
  }

  const visibleDestinationLabel = selectedPlaceLabel || destination;

  let routeTarget = null;
  let emptyReason = destinationResolutionError;
  if (destination && originContext) {
    if (selectedDestinationSource === 'dropdown') {
      routeTarget = destinationGroups.find(group => group.name === destination) || null;
    } else if (selectedDestinationSource === 'map') {
      routeTarget = { stopIds: activeMapStopIds };
    } else {
      const { candidates, unresolvedReason } = buildDestinationCandidates(
        destination, selectedDestinationSource, selectedPoiId, activeMapDestinationCandidates, destinationResolutionError
      );
      // Legacy POI resolution remains group-based; map targets never take this path.
      routeTarget = { stopIds: [...new Set(candidates.flatMap(name =>
        BUS_DATA.groups.find(group => group.name === name)?.codes || []
      ))] };
      emptyReason = unresolvedReason;
    }
  }
  // Capture the current query time, as legacy routing did, without another stored clock or timer.
  const routeNow = new Date();
  const routeTime = `${String(routeNow.getHours()).padStart(2, '0')}:${String(routeNow.getMinutes()).padStart(2, '0')}`;
  const routeOptions = originContext && routeTarget
    ? findDirectRoutes(originContext, routeTarget, { service, now: routeTime }).slice(0, ROUTE_OPTION_LIMIT)
    : [];
  if (destination && originContext && !routeOptions.length && !emptyReason) {
    const targetIds = new Set(routeTarget?.stopIds || []);
    const structurallyReachable = destinationGroups.some(group => group.stopIds.some(id => targetIds.has(id)));
    emptyReason = structurallyReachable ? `Täna enam busse pole · ${service}` : DIRECT_CONNECTION_MISSING_REASON;
  }

  const gpsLabel = {
    idle: 'Näita busse minu lähedal',
    searching: 'Otsin sinu asukohta…',
    ok: currentOrigin ? `${currentOrigin.name}${currentOrigin.dist != null ? ` · ${currentOrigin.dist} m` : ''}` : 'Asukoht leitud',
    error: 'Asukohta ei saanud kasutada',
  }[gpsState];

  useEffect(() => {
    if (gpsState !== 'ok' || !currentOrigin) return;
    const refresh = () => setNearbyClock({ now: new Date(), service: wd() });
    refresh();
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, [gpsState, currentOrigin]);

  const showNearbyDepartures = gpsState === 'ok' && currentOrigin != null;
  // Filtering and relative labels share this snapshot, separate from route planning.
  const nearbyNow = nearbyClock.now;
  const nearbyTime = `${String(nearbyNow.getHours()).padStart(2, '0')}:${String(nearbyNow.getMinutes()).padStart(2, '0')}`;
  const nearbyDepartures = showNearbyDepartures
    ? depsWithMeta(originCodesFrom(currentOrigin), 3, { service: nearbyClock.service, now: nearbyTime }).departures
    : [];

  const validSaved = savedPlaces.filter(p => p?.lat != null && p?.lon != null);
  const mapInitialCenter =
    Number.isFinite(effectiveOrigin?.lat) && Number.isFinite(effectiveOrigin?.lon)
      ? [effectiveOrigin.lat, effectiveOrigin.lon]
      : undefined;
  const nearestOriginStopForMap = (() => {
    const name = effectiveOrigin?.groupName || effectiveOrigin?.name || '';
    const directLat = Number(effectiveOrigin?.lat);
    const directLon = Number(effectiveOrigin?.lon);
    if (Number.isFinite(directLat) && Number.isFinite(directLon)) {
      return { name, lat: directLat, lon: directLon };
    }
    const code = effectiveOrigin?.code || effectiveOrigin?.stopId;
    const fallback = code ? BUS_DATA.by_code?.[code] : null;
    const fallbackLat = Number(fallback?.lat);
    const fallbackLon = Number(fallback?.lon);
    if (Number.isFinite(fallbackLat) && Number.isFinite(fallbackLon)) {
      return { name: name || fallback?.name || '', lat: fallbackLat, lon: fallbackLon };
    }
    return null;
  })();
  const closeMapPicker = () => {
    setMapPickerOpen(false);
    clearMapPickState();
  };

  return (
    <div style={shell}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: AV.text, fontFamily: FONT.display, margin: '0 0 8px' }}>Bussid</h1>
        <div style={{ fontSize: 14, color: AV.textSoft, lineHeight: 1.5 }}>Vaata järgmisi busse või leia sõit sihtkohta.</div>
      </div>

      <section aria-labelledby="buss-next-heading" style={{ ...card, padding: '22px 18px', marginBottom: 20 }}>
        <h2 id="buss-next-heading" style={{ ...labelStyle, fontSize: 13, color: AV.textSoft, margin: '0 0 16px' }}>JÄRGMISED BUSSID</h2>
        <div aria-live="polite">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            {showNearbyDepartures && (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: AV.textSoft, marginBottom: 6 }}>Sinu lähim peatus</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: AV.text, lineHeight: 1.4 }}>
                  {currentOrigin.name}
                  {currentOrigin.dist != null && (
                    <>
                      {' '}
                      <span style={{ whiteSpace: 'nowrap' }}>· {currentOrigin.dist} m</span>
                    </>
                  )}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={gpsClick}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: showNearbyDepartures ? '10px 12px' : '14px 16px',
                width: showNearbyDepartures ? 'auto' : '100%',
                minHeight: showNearbyDepartures ? 44 : 56,
                flexShrink: 0,
                background: showNearbyDepartures ? AV.bg : AV.textSoft,
                border: `1px solid ${showNearbyDepartures ? AV.border : AV.purple}`,
                borderRadius: AV.rSm,
                cursor: 'pointer',
                fontSize: showNearbyDepartures ? 14 : 16,
                fontWeight: 600,
                lineHeight: 1.4,
                fontFamily: 'inherit',
                color: showNearbyDepartures ? AV.textSoft : AV.card,
                boxShadow: showNearbyDepartures ? 'none' : AV.shadowSm,
              }}
            >
              {!showNearbyDepartures && <span aria-hidden="true">📍</span>}
              <span>{showNearbyDepartures ? 'Muuda' : gpsLabel}</span>
            </button>
          </div>
          {showNearbyDepartures && (
            <>
              {nearbyDepartures.length > 0 ? (
                <ul aria-label="Järgmised väljumised" style={{ listStyle: 'none', padding: 0, margin: '18px 0 8px' }}>
                  {nearbyDepartures.map(d => (
                    <li
                      key={`${d.line}|${d.v}|${d.time}|${d.originStopId}`}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 76, padding: '14px 0' }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 22, fontWeight: 600, color: AV.text, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums' }}>
                          {nearbyDepartureLabel(d.time, nearbyNow)}
                        </div>
                        <div style={{ fontSize: 14, color: AV.textSoft, lineHeight: 1.5, marginTop: 5 }}>
                          <time dateTime={d.time}>{d.time}</time> · {d.dir}
                        </div>
                      </div>
                      <span
                        role="img"
                        aria-label={`Liin ${d.line}${d.v ? `, variant ${d.v}` : ''}`}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 42, height: 42, padding: '0 10px', flexShrink: 0, borderRadius: AV.rSm, background: AV.sageL, color: AV.text, fontSize: 20, fontWeight: 600 }}
                      >
                        {d.line}{d.v ? `·${d.v}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ fontSize: 14, color: AV.textSoft, lineHeight: 1.5, margin: '20px 0 12px' }}>
                  Täna sellest peatusest rohkem busse ei tule.
                </p>
              )}
              <div style={{ fontSize: 12, color: AV.textSoft, lineHeight: 1.5 }}>Ajad on sõiduplaani järgi</div>
            </>
          )}
          {gpsState === 'error' && (
            <p style={{ fontSize: 14, color: AV.textSoft, lineHeight: 1.5, margin: '12px 0 0' }}>
              Saad peatuse ise valida — kõik töötab edasi.
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="buss-destination-heading" style={{ ...card, padding: '22px 18px', marginBottom: 20 }}>
        <h2 id="buss-destination-heading" style={{ ...labelStyle, fontSize: 13, color: AV.textSoft, margin: '0 0 16px' }}>KUHU TAHAD MINNA?</h2>
        <button
          type="button"
          onClick={() => {
            if (mapPickerOpen) {
              closeMapPicker();
              return;
            }
            setMapPickerOpen(true);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            width: '100%',
            minHeight: 56,
            padding: '14px 16px',
            borderRadius: AV.rSm,
            fontSize: 16,
            fontWeight: 600,
            lineHeight: 1.4,
            fontFamily: 'inherit',
            border: `1px solid ${AV.sage}`,
            background: AV.sageL,
            color: AV.text,
            cursor: 'pointer',
          }}
        >
          <span aria-hidden="true">🗺️</span>
          <span>Vali sihtkoht kaardilt</span>
        </button>
        {mapPickerOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1200,
              background: 'rgba(12, 18, 29, 0.52)',
              display: 'flex',
              alignItems: 'stretch',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Vali sihtkoht kaardilt"
              style={{
                width: '100%',
                maxWidth: 560,
                background: AV.bg,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <div
                style={{
                  padding: '14px 14px 10px',
                  borderBottom: `1px solid ${AV.border}`,
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: AV.text, marginBottom: 4 }}>Vali sihtkoht kaardilt</div>
                  <div style={{ fontSize: 12, color: AV.muted }}>Puuduta kaardil kohta, kuhu soovid jõuda.</div>
                </div>
                <button
                  onClick={closeMapPicker}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: `1px solid ${AV.border}`,
                    background: AV.bg,
                    color: AV.textSoft,
                    cursor: 'pointer',
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  Sulge
                </button>
              </div>
              <div
                style={{
                  flex: 1,
                  minHeight: 280,
                  padding: 10,
                }}
              >
                <BusMapPicker
                  initialCenter={mapInitialCenter}
                  onPick={handleMapPick}
                  reachableStopIds={reachableMapStopIds ? [...reachableMapStopIds] : null}
                  highlightStopNames={visibleMapCandidates.map(candidate => candidate.groupName)}
                  selectedStopName={selectedMapCandidate}
                  currentPosition={currentPosition}
                  nearestOriginStop={nearestOriginStopForMap}
                />
              </div>
              <div
                style={{
                  borderTop: `1px solid ${AV.border}`,
                  padding: '12px 12px 14px',
                  background: '#fff',
                  borderTopLeftRadius: 16,
                  borderTopRightRadius: 16,
                  boxShadow: '0 -8px 24px rgba(15, 23, 42, 0.06)',
                }}
              >
                {!mapPickedPoint ? (
                  <div style={{ fontSize: 12, color: AV.muted }}>
                    Puuduta kaardil kohta, kuhu soovid jõuda.
                  </div>
                ) : visibleMapCandidates.length > 0 ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 600, color: AV.text, marginBottom: 8 }}>
                      {visibleMapCandidates[0].walkingFallback
                        ? 'Jalutuskäigu kaugusel'
                        : visibleMapCandidates.length === 1
                        ? 'Lähim peatus sihtkohale'
                        : 'Mitu peatust on lähedal'}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                      {visibleMapCandidates.map(candidate => {
                        const active = selectedMapCandidate === candidate.groupName;
                        return (
                          <button
                            key={candidate.id}
                            onClick={() => setSelectedMapCandidate(candidate.groupName)}
                            aria-pressed={active}
                            style={{
                              padding: '7px 11px',
                              borderRadius: 100,
                              fontSize: 12,
                              cursor: 'pointer',
                              border: `1.5px solid ${active ? AV.purple : AV.border}`,
                              background: active ? AV.purpleL : AV.bg,
                              color: active ? AV.purple : AV.muted,
                            }}
                          >
                            {candidate.groupName}
                            {candidate.distanceMeters != null ? ` · ~${Math.round(candidate.distanceMeters)} m linnulennult` : ''}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={confirmMapDestinationCandidate}
                      disabled={!selectedMapCandidate}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 12,
                        fontSize: 13,
                        cursor: selectedMapCandidate ? 'pointer' : 'not-allowed',
                        border: `1px solid ${AV.border}`,
                        background: selectedMapCandidate ? AV.sageL : '#f1f3f5',
                        color: selectedMapCandidate ? AV.sage : '#98a0aa',
                      }}
                    >
                      Kasuta seda sihtkohta
                    </button>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: AV.muted }}>
                    {visibleMapError || 'Valitud kohale ei leitud sobivat peatust. Proovi kaardil teist kohta.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <label htmlFor="buss-destination" style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: AV.textSoft, margin: '20px 0 12px' }}>
          <span aria-hidden="true" style={{ flex: 1, borderTop: `1px solid ${AV.border}` }} />
          või vali peatus
          <span aria-hidden="true" style={{ flex: 1, borderTop: `1px solid ${AV.border}` }} />
        </label>
        <select
          id="buss-destination"
          aria-label="Vali sihtkoht"
          onChange={e => {
            const nextDestination = e.target.value;
            setDestination(nextDestination);
            setSelectedPlaceLabel('');
            setPlaceQuery(nextDestination || '');
            setSelectedPoiId('');
            setSelectedDestinationSource(nextDestination ? 'dropdown' : 'none');
            setActiveMapDestinationCandidates([]);
            setDestinationResolutionError('');
            setMapPickerOpen(false);
            clearMapPickState();
          }}
          style={{ ...inp, minHeight: 52, fontSize: 16, marginTop: 0 }}
          value={destinationInDropdown ? destination : ''}
        >
          <option value="">— vali sihtkoht —</option>
          {destinationGroups.map(g => (
            <option key={`dest-${g.name}`} value={g.name}>
              {g.name}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 12, color: AV.muted, marginTop: 8 }}>
          {destination ? `Valitud sihtkoht: ${visibleDestinationLabel}` : 'Vali sihtkoht, et näha marsruute'}
          {selectedDestinationSource === 'map' && activeMapDestinationCandidates[0]?.walkingFallback && (
            <div>Jaluta peatusest valitud punkti · ~{Math.round(activeMapDestinationCandidates[0].distanceMeters)} m linnulennult</div>
          )}
        </div>

        <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${AV.border}`, marginBottom: 14 }}>
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
            <div style={{ fontSize: 13, color: AV.muted, textAlign: 'center', padding: '16px 0' }}>
              {destinationResolutionError || 'Vali sihtkoht, et näha marsruute'}
            </div>
          ) : !effectiveOrigin ? (
            <div style={{ fontSize: 13, color: AV.muted, textAlign: 'center', padding: '16px 0' }}>Vali lähtekoht, et näha marsruute</div>
          ) : routeOptions.length === 0 ? (
            <div style={{ fontSize: 13, color: AV.muted, textAlign: 'center', padding: '16px 0' }}>{emptyReason || `Täna enam busse pole · ${wd()}`}</div>
          ) : (
            <>
              {routeOptions.map(d => (
                <DepRow key={JSON.stringify([d.line, d.patternId, d.tripId])} d={d} />
              ))}
              <div style={{ fontSize: 11, color: AV.muted, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${AV.border}` }}>
                Ajad on sõiduplaani järgi
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
