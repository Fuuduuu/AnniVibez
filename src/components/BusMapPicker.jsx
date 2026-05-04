import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BUS_DATA } from '../data/busData';
import { GTFS_STOP_COORDS_BY_ID } from '../data/gtfsStopCoords';
import { LINE_COLORS, STOP_TO_LINES } from '../data/stopLineMap';
import { nearest } from '../utils/bus';

const RAKVERE_CENTER = [59.3469, 26.3557];
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors';
const LINE_BADGE_MIN_ZOOM = 15;
const LINE_BADGE_PANE = 'lineBadgePane';

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

function colorHexForLine(lineNumber) {
  const token = LINE_COLORS?.[String(lineNumber)] || '';
  if (token === 'blue') return '#2d6cdf';
  if (token === 'green') return '#2f9e44';
  if (token === 'yellow') return '#c99700';
  if (token === 'orange') return '#e67700';
  return '#6f7787';
}

function badgeHtmlForLines(rawLines) {
  const lines = Array.isArray(rawLines) ? rawLines.slice() : [];
  if (!lines.length) return '';

  if (lines.length === 1) {
    const line = lines[0];
    const color = colorHexForLine(line);
    return `<div style="transform: translate(-50%, -145%); display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; border-radius: 999px; border: 1.6px solid ${color}; background: #ffffff; color: ${color}; font-size: 10px; line-height: 1; font-weight: 700; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18); padding: 0 4px;">${line}</div>`;
  }

  const chips = lines.slice(0, 3).map((line) => {
    const color = colorHexForLine(line);
    return `<span style="display: inline-flex; align-items: center; justify-content: center; min-width: 14px; height: 14px; border-radius: 999px; background: ${color}; color: #fff; font-size: 9px; line-height: 1; font-weight: 700; padding: 0 3px;">${line}</span>`;
  });
  if (lines.length > 3) {
    chips.push('<span style="display: inline-flex; align-items: center; justify-content: center; min-width: 14px; height: 14px; border-radius: 999px; background: #8f96a3; color: #fff; font-size: 9px; line-height: 1; font-weight: 700; padding: 0 3px;">+</span>');
  }

  return `<div style="transform: translate(-50%, -145%); display: inline-flex; align-items: center; gap: 2px; border: 1.2px solid #b8bfcc; border-radius: 999px; background: rgba(255, 255, 255, 0.96); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.16); padding: 2px 4px;">${chips.join('')}</div>`;
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
  const lineBadgeLayerRef = useRef(null);

  const stopPoints = useMemo(() => {
    const rows = Object.entries(BUS_DATA?.by_code || {});
    return rows
      .map(([code, stop]) => ({
        code,
        name: stop?.name || GTFS_STOP_COORDS_BY_ID?.[code]?.stopName || code,
        lat: GTFS_STOP_COORDS_BY_ID?.[code]?.lat ?? stop?.lat,
        lon: GTFS_STOP_COORDS_BY_ID?.[code]?.lon ?? stop?.lon,
        lines: Array.isArray(STOP_TO_LINES?.[code]) ? STOP_TO_LINES[code] : [],
      }))
      .filter(stop => isFiniteNumber(stop.lat) && isFiniteNumber(stop.lon));
  }, []);

  function syncLineBadgeVisibility(map) {
    const layer = lineBadgeLayerRef.current;
    if (!map || !layer) return;
    const showBadges = map.getZoom() >= LINE_BADGE_MIN_ZOOM;
    if (showBadges && !map.hasLayer(layer)) {
      layer.addTo(map);
      return;
    }
    if (!showBadges && map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  }

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

    if (!map.getPane(LINE_BADGE_PANE)) {
      const pane = map.createPane(LINE_BADGE_PANE);
      pane.style.zIndex = '350';
      pane.style.pointerEvents = 'none';
    }

    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: TILE_ATTRIBUTION,
    }).addTo(map);

    const stopsLayer = L.layerGroup().addTo(map);
    const lineBadgeLayer = L.layerGroup();
    lineBadgeLayerRef.current = lineBadgeLayer;
    const groupedMarkers = new Map();
    stopPoints.forEach(stop => {
      const marker = L.circleMarker([stop.lat, stop.lon], STOP_STYLE_IDLE).addTo(stopsLayer);
      if (!groupedMarkers.has(stop.name)) groupedMarkers.set(stop.name, []);
      groupedMarkers.get(stop.name).push(marker);

      if (stop.lines.length > 0) {
        L.marker([stop.lat, stop.lon], {
          interactive: false,
          keyboard: false,
          pane: LINE_BADGE_PANE,
          icon: L.divIcon({
            className: '',
            html: badgeHtmlForLines(stop.lines),
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
        }).addTo(lineBadgeLayer);
      }
    });
    markerGroupsByNameRef.current = groupedMarkers;
    applyMarkerVisuals(highlightStopNames, selectedStopName);
    applyContextMarkers(currentPosition, nearestOriginStop);
    syncLineBadgeVisibility(map);

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

    map.on('zoomend', () => {
      syncLineBadgeVisibility(map);
    });

    const resizeTimer = setTimeout(() => map.invalidateSize(), 0);

    return () => {
      clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      pickedPinLayerRef.current = null;
      currentPositionLayerRef.current = null;
      nearestOriginLayerRef.current = null;
      lineBadgeLayerRef.current = null;
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
