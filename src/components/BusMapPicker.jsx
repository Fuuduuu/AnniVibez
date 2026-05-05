import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BUS_DATA } from '../data/busData';
import { GTFS_STOP_COORDS_BY_ID } from '../data/gtfsStopCoords';
import { LINE_COLORS, STOP_TO_LINES } from '../data/stopLineMap';
import { ROUTE_SHAPES_BY_LINE } from '../data/routeShapes';
import { nearest } from '../utils/bus';

const RAKVERE_CENTER = [59.3469, 26.3557];
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors';
const LINE_BADGE_MIN_ZOOM = 17;
const LINE_BADGE_PANE = 'lineBadgePane';
const ROUTE_SHAPE_PANE = 'routeShapePane';
const LINE_FILTER_OPTIONS = ['all', '1', '2', '3', '5'];

function scheduleFrame(callback) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return setTimeout(callback, 0);
}

function cancelFrame(frameId) {
  if (!frameId) return;
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frameId);
    return;
  }
  clearTimeout(frameId);
}

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

function formatPatternLabel(patternName) {
  return String(patternName || '')
    .split(/\s*-\s*/g)
    .join(' → ');
}

const STOP_STYLE_IDLE = {
  radius: 3.1,
  weight: 1,
  color: '#9aa6bf',
  fillColor: '#ccd5e8',
  fillOpacity: 0.56,
};

const STOP_STYLE_FADED = {
  radius: 2.7,
  weight: 0.9,
  color: '#c7cedb',
  fillColor: '#e8ecf4',
  fillOpacity: 0.34,
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
  const routeShapeLayerRef = useRef(null);
  const markerEntriesRef = useRef([]);
  const lineBadgeEntriesRef = useRef([]);
  const circleRendererRef = useRef(null);
  const markerVisualFrameRef = useRef(null);
  const [activeLineFilter, setActiveLineFilter] = useState('all');
  const [selectedRouteShapeId, setSelectedRouteShapeId] = useState('');

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

  const routeShapesForActiveLine = useMemo(() => {
    if (activeLineFilter === 'all') return [];
    const shapes = ROUTE_SHAPES_BY_LINE?.[activeLineFilter];
    return Array.isArray(shapes) ? shapes : [];
  }, [activeLineFilter]);

  function servesActiveLine(lines, activeLine) {
    if (!activeLine || activeLine === 'all') return true;
    return Array.isArray(lines) && lines.includes(activeLine);
  }

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

  function applyLineBadgeVisuals(activeLine) {
    const entries = lineBadgeEntriesRef.current;
    entries.forEach(({ marker, lines }) => {
      const isMatch = servesActiveLine(lines, activeLine);
      if (activeLine === 'all') {
        marker.setOpacity(0.9);
        marker.setZIndexOffset(80);
        return;
      }
      marker.setOpacity(isMatch ? 1 : 0);
      marker.setZIndexOffset(isMatch ? 120 : 0);
    });
  }

  function applyMarkerVisuals(nearestNames, selectedName, activeLine) {
    const nearestSet = new Set(
      (Array.isArray(nearestNames) ? nearestNames : [])
        .map(normalizeStopName)
        .filter(Boolean)
    );
    const selectedKey = normalizeStopName(selectedName);
    const entries = markerEntriesRef.current;
    const grouped = markerGroupsByNameRef.current;

    entries.forEach(({ marker, name, lines }) => {
      const key = normalizeStopName(name);
      const isSelected = !!selectedKey && key === selectedKey;
      const isNearest = nearestSet.has(key);
      const isLineMatch = servesActiveLine(lines, activeLine);
      const style = isSelected
        ? STOP_STYLE_SELECTED
        : isNearest
          ? STOP_STYLE_NEAREST
          : (activeLine !== 'all' && !isLineMatch)
            ? STOP_STYLE_FADED
            : STOP_STYLE_IDLE;
      marker.setStyle(style);
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
    const renderer = circleRendererRef.current;

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
      L.circleMarker([posLat, posLon], { ...CURRENT_POSITION_STYLE, renderer }).addTo(layer);
      L.circleMarker([posLat, posLon], { ...CURRENT_POSITION_INNER_STYLE, renderer }).addTo(layer);
      currentPositionLayerRef.current = layer;
    }

    const originLat = Number(originStop?.lat);
    const originLon = Number(originStop?.lon);
    if (isFiniteNumber(originLat) && isFiniteNumber(originLon)) {
      const layer = L.layerGroup().addTo(mapRef.current);
      L.circleMarker([originLat, originLon], { ...ORIGIN_STOP_STYLE, renderer }).addTo(layer);
      L.circleMarker([originLat, originLon], { ...ORIGIN_STOP_INNER_STYLE, renderer }).addTo(layer);
      nearestOriginLayerRef.current = layer;
    }
  }

  function queueMarkerVisualUpdate(nearestNames, selectedName, activeLine) {
    if (!mapRef.current) return;
    cancelFrame(markerVisualFrameRef.current);
    markerVisualFrameRef.current = scheduleFrame(() => {
      markerVisualFrameRef.current = null;
      applyMarkerVisuals(nearestNames, selectedName, activeLine);
      applyLineBadgeVisuals(activeLine);
    });
  }

  function applyRouteShape(activeLine, shapeId) {
    if (!mapRef.current) return;

    if (routeShapeLayerRef.current) {
      routeShapeLayerRef.current.remove();
      routeShapeLayerRef.current = null;
    }

    if (!activeLine || activeLine === 'all') return;

    const shapes = Array.isArray(ROUTE_SHAPES_BY_LINE?.[activeLine])
      ? ROUTE_SHAPES_BY_LINE[activeLine]
      : [];
    if (!shapes.length) return;

    const selectedShape = shapes.find(shape => shape.shapeId === shapeId) || shapes[0];
    if (!selectedShape || !Array.isArray(selectedShape.points) || !selectedShape.points.length) return;

    const latLngs = selectedShape.points
      .map(point => [Number(point.lat), Number(point.lon)])
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
    if (!latLngs.length) return;

    routeShapeLayerRef.current = L.polyline(latLngs, {
      pane: ROUTE_SHAPE_PANE,
      color: colorHexForLine(activeLine),
      weight: 3.2,
      opacity: 0.54,
      smoothFactor: 1.3,
      interactive: false,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(mapRef.current);
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

    const map = L.map(mapHostRef.current, { zoomControl: true, preferCanvas: true }).setView(center, 13);
    mapRef.current = map;
    circleRendererRef.current = L.canvas({ padding: 0.45 });

    if (!map.getPane(ROUTE_SHAPE_PANE)) {
      const pane = map.createPane(ROUTE_SHAPE_PANE);
      pane.style.zIndex = '330';
      pane.style.pointerEvents = 'none';
    }

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
    const markerEntries = [];
    const lineBadgeEntries = [];
    const renderer = circleRendererRef.current;
    stopPoints.forEach(stop => {
      const marker = L.circleMarker([stop.lat, stop.lon], { ...STOP_STYLE_IDLE, renderer }).addTo(stopsLayer);
      if (!groupedMarkers.has(stop.name)) groupedMarkers.set(stop.name, []);
      groupedMarkers.get(stop.name).push(marker);
      markerEntries.push({
        marker,
        name: stop.name,
        lines: stop.lines,
      });

      if (stop.lines.length > 0) {
        const lineBadgeMarker = L.marker([stop.lat, stop.lon], {
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
        lineBadgeEntries.push({
          marker: lineBadgeMarker,
          lines: stop.lines,
        });
      }
    });
    markerGroupsByNameRef.current = groupedMarkers;
    markerEntriesRef.current = markerEntries;
    lineBadgeEntriesRef.current = lineBadgeEntries;
    queueMarkerVisualUpdate(highlightStopNames, selectedStopName, 'all');
    applyContextMarkers(currentPosition, nearestOriginStop);
    syncLineBadgeVisibility(map);

    map.on('click', event => {
      const lat = roundCoord(event.latlng.lat);
      const lon = roundCoord(event.latlng.lng);

      if (pickedPinLayerRef.current) {
        pickedPinLayerRef.current.remove();
      }
      const pinLayer = L.layerGroup().addTo(map);
      const renderer = circleRendererRef.current;
      L.circleMarker([lat, lon], {
        radius: 12,
        weight: 2,
        color: '#6f4acb',
        fillColor: '#d8c8ff',
        fillOpacity: 0.34,
        renderer,
      }).addTo(pinLayer);
      L.circleMarker([lat, lon], {
        radius: 6.8,
        weight: 2.2,
        color: '#5f35bf',
        fillColor: '#8f6bff',
        fillOpacity: 0.96,
        renderer,
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
      cancelFrame(markerVisualFrameRef.current);
      markerVisualFrameRef.current = null;
      pickedPinLayerRef.current = null;
      currentPositionLayerRef.current = null;
      nearestOriginLayerRef.current = null;
      lineBadgeLayerRef.current = null;
      routeShapeLayerRef.current = null;
      circleRendererRef.current = null;
      markerGroupsByNameRef.current = new Map();
      markerEntriesRef.current = [];
      lineBadgeEntriesRef.current = [];
    };
  }, [stopPoints]);

  useEffect(() => {
    if (activeLineFilter === 'all') {
      setSelectedRouteShapeId('');
      return;
    }

    if (!routeShapesForActiveLine.length) {
      setSelectedRouteShapeId('');
      return;
    }

    if (routeShapesForActiveLine.some(shape => shape.shapeId === selectedRouteShapeId)) return;
    setSelectedRouteShapeId(routeShapesForActiveLine[0].shapeId);
  }, [activeLineFilter, routeShapesForActiveLine, selectedRouteShapeId]);

  useEffect(() => {
    applyRouteShape(activeLineFilter, selectedRouteShapeId);
  }, [activeLineFilter, selectedRouteShapeId]);

  useEffect(() => {
    if (!mapRef.current) return;
    queueMarkerVisualUpdate(highlightStopNames, selectedStopName, activeLineFilter);
  }, [highlightStopNames, selectedStopName, activeLineFilter]);

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
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
      }}
    >
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

      <div
        aria-label="Liinifilter"
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 720,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 6px',
          borderRadius: 999,
          background: 'rgba(255, 255, 255, 0.92)',
          border: '1px solid #d7dde8',
          boxShadow: '0 2px 7px rgba(15, 23, 42, 0.12)',
          backdropFilter: 'blur(1px)',
        }}
      >
        {LINE_FILTER_OPTIONS.map((option) => {
          const active = activeLineFilter === option;
          const isAll = option === 'all';
          const lineColor = isAll ? '#6f7787' : colorHexForLine(option);
          const label = isAll ? 'Kõik' : option;
          const bg = active ? lineColor : '#ffffff';
          const fg = active ? (option === '3' ? '#1f2937' : '#ffffff') : '#495463';
          return (
            <button
              key={option}
              type="button"
              onClick={() => setActiveLineFilter(option)}
              aria-pressed={active}
              style={{
                border: `1px solid ${active ? lineColor : '#c8d0dd'}`,
                background: bg,
                color: fg,
                borderRadius: 999,
                minWidth: isAll ? 36 : 24,
                height: 24,
                padding: isAll ? '0 8px' : '0 6px',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {activeLineFilter !== 'all' && routeShapesForActiveLine.length > 1 ? (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 720,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 7px',
            borderRadius: 10,
            background: 'rgba(255, 255, 255, 0.92)',
            border: '1px solid #d7dde8',
            boxShadow: '0 2px 7px rgba(15, 23, 42, 0.12)',
            backdropFilter: 'blur(1px)',
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#334155',
              lineHeight: 1.2,
            }}
          >
            Suund
          </span>
          <select
            value={selectedRouteShapeId}
            onChange={(event) => setSelectedRouteShapeId(event.target.value)}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#334155',
              borderRadius: 8,
              border: '1px solid #cdd6e4',
              background: '#ffffff',
              padding: '3px 6px',
              maxWidth: 220,
            }}
          >
            {routeShapesForActiveLine.map((shape) => (
              <option key={shape.shapeId} value={shape.shapeId}>
                {formatPatternLabel(shape.patternName)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
