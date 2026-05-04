import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BUS_DATA } from '../data/busData';
import { GTFS_STOP_COORDS_BY_ID } from '../data/gtfsStopCoords';
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

function normalizeStopName(value) {
  return String(value || '').trim().toLowerCase();
}

const STOP_STYLE_IDLE = {
  radius: 3.1,
  weight: 1,
  color: '#9aa6bf',
  fillColor: '#ccd5e8',
  fillOpacity: 0.56,
};

const STOP_STYLE_NEAREST = {
  radius: 4.2,
  weight: 1.6,
  color: '#7c4dff',
  fillColor: '#c3adff',
  fillOpacity: 0.92,
};

const STOP_STYLE_SELECTED = {
  radius: 5.5,
  weight: 2.2,
  color: '#5f35bf',
  fillColor: '#8f6bff',
  fillOpacity: 1,
};

const ORIGIN_STOP_STYLE = {
  radius: 7.2,
  weight: 2,
  color: '#1a7e7e',
  fillColor: '#85d6d6',
  fillOpacity: 0.82,
};

const ORIGIN_STOP_INNER_STYLE = {
  radius: 3.4,
  weight: 1.4,
  color: '#0f5f5f',
  fillColor: '#0f5f5f',
  fillOpacity: 0.95,
};

const CURRENT_POSITION_STYLE = {
  radius: 7.8,
  weight: 2.1,
  color: '#d64848',
  fillColor: '#ff9a9a',
  fillOpacity: 0.9,
};

const CURRENT_POSITION_INNER_STYLE = {
  radius: 3.6,
  weight: 1.5,
  color: '#b32424',
  fillColor: '#b32424',
  fillOpacity: 0.96,
};

export function BusMapPicker({
  initialCenter = RAKVERE_CENTER,
  onPick,
  highlightStopNames = [],
  selectedStopName = '',
  currentPosition = null,
  nearestOriginStop = null,
}) {
  const mapHostRef = useRef(null);
  const mapRef = useRef(null);
  const pickedPinLayerRef = useRef(null);
  const markerGroupsByNameRef = useRef(new Map());
  const currentPositionLayerRef = useRef(null);
  const nearestOriginLayerRef = useRef(null);

  const stopPoints = useMemo(() => {
    const rows = Object.entries(BUS_DATA?.by_code || {});
    return rows
      .map(([code, stop]) => ({
        code,
        name: stop?.name || GTFS_STOP_COORDS_BY_ID?.[code]?.stopName || code,
        lat: GTFS_STOP_COORDS_BY_ID?.[code]?.lat ?? stop?.lat,
        lon: GTFS_STOP_COORDS_BY_ID?.[code]?.lon ?? stop?.lon,
      }))
      .filter(stop => isFiniteNumber(stop.lat) && isFiniteNumber(stop.lon));
  }, []);

  function applyMarkerVisuals(nearestNames, selectedName) {
    const nearestSet = new Set(
      (Array.isArray(nearestNames) ? nearestNames : [])
        .map(normalizeStopName)
        .filter(Boolean)
    );
    const selectedKey = normalizeStopName(selectedName);
    const grouped = markerGroupsByNameRef.current;

    grouped.forEach((markers, rawName) => {
      const key = normalizeStopName(rawName);
      const isSelected = !!selectedKey && key === selectedKey;
      const isNearest = nearestSet.has(key);
      const style = isSelected ? STOP_STYLE_SELECTED : isNearest ? STOP_STYLE_NEAREST : STOP_STYLE_IDLE;
      markers.forEach(marker => marker.setStyle(style));
    });

    grouped.forEach((markers, rawName) => {
      const key = normalizeStopName(rawName);
      if (nearestSet.has(key)) {
        markers.forEach(marker => marker.bringToFront());
      }
    });
    if (selectedKey) {
      grouped.forEach((markers, rawName) => {
        if (normalizeStopName(rawName) === selectedKey) {
          markers.forEach(marker => marker.bringToFront());
        }
      });
    }
  }

  function applyContextMarkers(position, originStop) {
    if (!mapRef.current) return;

    if (currentPositionLayerRef.current) {
      currentPositionLayerRef.current.remove();
      currentPositionLayerRef.current = null;
    }
    if (nearestOriginLayerRef.current) {
      nearestOriginLayerRef.current.remove();
      nearestOriginLayerRef.current = null;
    }

    const posLat = Number(position?.lat);
    const posLon = Number(position?.lon);
    if (isFiniteNumber(posLat) && isFiniteNumber(posLon)) {
      const layer = L.layerGroup().addTo(mapRef.current);
      L.circleMarker([posLat, posLon], CURRENT_POSITION_STYLE).addTo(layer);
      L.circleMarker([posLat, posLon], CURRENT_POSITION_INNER_STYLE).addTo(layer);
      currentPositionLayerRef.current = layer;
    }

    const originLat = Number(originStop?.lat);
    const originLon = Number(originStop?.lon);
    if (isFiniteNumber(originLat) && isFiniteNumber(originLon)) {
      const layer = L.layerGroup().addTo(mapRef.current);
      L.circleMarker([originLat, originLon], ORIGIN_STOP_STYLE).addTo(layer);
      L.circleMarker([originLat, originLon], ORIGIN_STOP_INNER_STYLE).addTo(layer);
      nearestOriginLayerRef.current = layer;
    }
  }

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
    const groupedMarkers = new Map();
    stopPoints.forEach(stop => {
      const marker = L.circleMarker([stop.lat, stop.lon], STOP_STYLE_IDLE).addTo(stopsLayer);
      if (!groupedMarkers.has(stop.name)) groupedMarkers.set(stop.name, []);
      groupedMarkers.get(stop.name).push(marker);
    });
    markerGroupsByNameRef.current = groupedMarkers;
    applyMarkerVisuals(highlightStopNames, selectedStopName);
    applyContextMarkers(currentPosition, nearestOriginStop);

    map.on('click', event => {
      const lat = roundCoord(event.latlng.lat);
      const lon = roundCoord(event.latlng.lng);

      if (pickedPinLayerRef.current) {
        pickedPinLayerRef.current.remove();
      }
      const pinLayer = L.layerGroup().addTo(map);
      L.circleMarker([lat, lon], {
        radius: 12,
        weight: 2,
        color: '#6f4acb',
        fillColor: '#d8c8ff',
        fillOpacity: 0.34,
      }).addTo(pinLayer);
      L.circleMarker([lat, lon], {
        radius: 6.8,
        weight: 2.2,
        color: '#5f35bf',
        fillColor: '#8f6bff',
        fillOpacity: 0.96,
      }).addTo(pinLayer);
      pickedPinLayerRef.current = pinLayer;

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
      onPick?.({ lat, lon, nearestStops: nearestStopNames });
    });

    const resizeTimer = setTimeout(() => map.invalidateSize(), 0);

    return () => {
      clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      pickedPinLayerRef.current = null;
      currentPositionLayerRef.current = null;
      nearestOriginLayerRef.current = null;
      markerGroupsByNameRef.current = new Map();
    };
  }, [initialCenter, stopPoints]);

  useEffect(() => {
    if (!mapRef.current) return;
    applyMarkerVisuals(highlightStopNames, selectedStopName);
  }, [highlightStopNames, selectedStopName]);

  useEffect(() => {
    if (!mapRef.current) return;
    applyContextMarkers(currentPosition, nearestOriginStop);
  }, [currentPosition, nearestOriginStop]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!Array.isArray(initialCenter) || initialCenter.length !== 2) return;
    if (!isFiniteNumber(initialCenter[0]) || !isFiniteNumber(initialCenter[1])) return;
    mapRef.current.setView(initialCenter);
  }, [initialCenter]);

  return (
    <div
      ref={mapHostRef}
      aria-label="Sihtkoha kaart"
      style={{
        height: '100%',
        width: '100%',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid #d6dde6',
      }}
    />
  );
}
