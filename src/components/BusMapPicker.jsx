import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BUS_DATA } from '../data/busData';
import { nearest } from '../utils/bus';

const RAKVERE_CENTER = [59.3469, 26.3557];
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors';

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function roundCoord(value) {
  return Math.round(value * 100000) / 100000;
}

function nearestNameFromHelper(hit) {
  if (!hit || typeof hit !== 'object') return null;
  const raw =
    hit.groupName ||
    hit.displayName ||
    hit.name ||
    hit.stopName ||
    hit.code ||
    null;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function distanceScore(latA, lonA, latB, lonB) {
  const dLat = latA - latB;
  const dLon = lonA - lonB;
  return dLat * dLat + dLon * dLon;
}

function dedupeNames(names) {
  const out = [];
  const seen = new Set();
  for (const name of names) {
    const key = (name || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function BusMapPicker({ initialCenter = RAKVERE_CENTER, onPick, onClose }) {
  const mapHostRef = useRef(null);
  const mapRef = useRef(null);
  const pickedPinLayerRef = useRef(null);
  const [pickedPoint, setPickedPoint] = useState(null);

  const stopPoints = useMemo(() => {
    const rows = Object.entries(BUS_DATA?.by_code || {});
    return rows
      .map(([code, stop]) => ({
        code,
        name: stop?.name || code,
        lat: stop?.lat,
        lon: stop?.lon,
      }))
      .filter(stop => isFiniteNumber(stop.lat) && isFiniteNumber(stop.lon));
  }, []);

  useEffect(() => {
    if (!mapHostRef.current || mapRef.current) return;

    const center =
      Array.isArray(initialCenter) &&
      initialCenter.length === 2 &&
      isFiniteNumber(initialCenter[0]) &&
      isFiniteNumber(initialCenter[1])
        ? initialCenter
        : RAKVERE_CENTER;

    const map = L.map(mapHostRef.current, { zoomControl: true }).setView(center, 13);
    mapRef.current = map;

    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: TILE_ATTRIBUTION,
    }).addTo(map);

    const stopsLayer = L.layerGroup().addTo(map);
    stopPoints.forEach(stop => {
      L.circleMarker([stop.lat, stop.lon], {
        radius: 3,
        weight: 1,
        color: '#2563eb',
        fillColor: '#60a5fa',
        fillOpacity: 0.7,
      })
        .bindTooltip(stop.name)
        .addTo(stopsLayer);
    });

    map.on('click', event => {
      const lat = roundCoord(event.latlng.lat);
      const lon = roundCoord(event.latlng.lng);

      if (pickedPinLayerRef.current) {
        pickedPinLayerRef.current.remove();
      }
      pickedPinLayerRef.current = L.circleMarker([lat, lon], {
        radius: 7,
        weight: 2,
        color: '#b91c1c',
        fillColor: '#ef4444',
        fillOpacity: 0.9,
      }).addTo(map);

      let helperName = null;
      try {
        helperName = nearestNameFromHelper(nearest(lat, lon));
      } catch {
        helperName = null;
      }

      const rawNearest = stopPoints
        .map(stop => ({
          name: stop.name,
          score: distanceScore(lat, lon, stop.lat, stop.lon),
        }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 3)
        .map(hit => hit.name);

      const nearestStopNames = dedupeNames([helperName, ...rawNearest]).slice(0, 3);
      setPickedPoint({ lat, lon, nearestStopNames });
    });

    const resizeTimer = setTimeout(() => map.invalidateSize(), 0);

    return () => {
      clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      pickedPinLayerRef.current = null;
    };
  }, [initialCenter, stopPoints]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!Array.isArray(initialCenter) || initialCenter.length !== 2) return;
    if (!isFiniteNumber(initialCenter[0]) || !isFiniteNumber(initialCenter[1])) return;
    mapRef.current.setView(initialCenter);
  }, [initialCenter]);

  return (
    <section
      style={{
        border: '1px solid #d6dde6',
        borderRadius: 14,
        padding: 14,
        background: '#f9fbff',
      }}
    >
      <h3 style={{ margin: '0 0 6px', fontSize: 17 }}>Vali sihtkoht kaardilt</h3>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: '#465569' }}>
        Puuduta kaardil kohta, kuhu soovid minna.
      </p>

      <div
        ref={mapHostRef}
        style={{
          height: 340,
          width: '100%',
          borderRadius: 10,
          overflow: 'hidden',
          border: '1px solid #d6dde6',
        }}
      />

      <div style={{ marginTop: 10, fontSize: 13, color: '#1f2937' }}>
        {pickedPoint ? (
          <>
            <div>
              Valitud punkt: {pickedPoint.lat.toFixed(5)}, {pickedPoint.lon.toFixed(5)}
            </div>
            {pickedPoint.nearestStopNames.length > 0 && (
              <div style={{ marginTop: 4, color: '#4b5563' }}>
                Lähimad peatused: {pickedPoint.nearestStopNames.join(', ')}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: '#4b5563' }}>Vali punkt kaardilt, et näha lähimaid peatusi.</div>
        )}
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => {
            if (!pickedPoint) return;
            onPick?.({
              lat: pickedPoint.lat,
              lon: pickedPoint.lon,
              nearestStops: pickedPoint.nearestStopNames,
            });
          }}
          disabled={!pickedPoint}
          style={{
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid #9bb0c9',
            background: pickedPoint ? '#f0f7ff' : '#f4f4f5',
            color: pickedPoint ? '#0f172a' : '#9ca3af',
            cursor: pickedPoint ? 'pointer' : 'not-allowed',
          }}
        >
          Kasuta seda sihtkohta
        </button>
        <button
          onClick={() => onClose?.()}
          style={{
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid #d6dde6',
            background: '#ffffff',
            color: '#0f172a',
            cursor: 'pointer',
          }}
        >
          Sulge
        </button>
      </div>
    </section>
  );
}
