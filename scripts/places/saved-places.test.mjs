import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SAVED_PLACE_DEFAULTS, normalizePlace, normalizePlaces } from '../../src/places/savedPlaces.js';

// Golden behavior captured from both pre-extraction hook implementations (useSavedPlaces.js and useSettings.js),
// which agreed on every case before the C2 extraction.
const place = (name, address = '', lat = null, lon = null) => ({ name, address, lat, lon });
const DEFAULT_TRIPLE = () => [place('Kodu'), place('Kool'), place('Trenn')];

const PLACE_GOLDEN = [
  ['valid place', [{ name: 'Kodu', address: 'Tamme 1, Rakvere', lat: 59.34, lon: 26.35 }, 0], place('Kodu', 'Tamme 1, Rakvere', 59.34, 26.35)],
  ['null place', [null, 0], place('Kodu')],
  ['missing place', [undefined, 1], place('Kool')],
  ['blank name', [{ name: '   ', address: 'A' }, 2], place('Trenn', 'A')],
  ['trimmed name', [{ name: '  Pood  ', address: '  Keskväljak 1 ' }, 0], place('Pood', '  Keskväljak 1 ')],
  ['non-string name', [{ name: 42 }, 1], place('Kool')],
  ['missing address', [{ name: 'Park' }, 0], place('Park')],
  ['non-string address', [{ name: 'Park', address: 12 }, 0], place('Park')],
  ['finite numeric lat/lon', [{ name: 'A', lat: 0, lon: -12.25 }, 0], place('A', '', 0, -12.25)],
  ['numeric-string lat/lon', [{ name: 'A', lat: '59.5', lon: ' 26.4abc' }, 0], place('A', '', 59.5, 26.4)],
  ['exponent string lat', [{ name: 'A', lat: '1e3', lon: '-0.5' }, 0], place('A', '', 1000, -0.5)],
  ['invalid lat', [{ name: 'A', lat: 'abc', lon: 26 }, 0], place('A', '', null, 26)],
  ['invalid lon', [{ name: 'A', lat: 59, lon: {} }, 0], place('A', '', 59, null)],
  ['boolean and null coordinates', [{ name: 'A', lat: true, lon: null }, 0], place('A')],
  ['Infinity values', [{ name: 'A', lat: Infinity, lon: '-Infinity' }, 0], place('A')],
  ['NaN values', [{ name: 'A', lat: NaN, lon: 'NaN' }, 0], place('A')],
  ['default index 0', [{}, 0], place('Kodu')],
  ['default index 1', [{}, 1], place('Kool')],
  ['default index 2', [{}, 2], place('Trenn')],
  ['index beyond defaults 3', [{}, 3], place('Koht')],
  ['index beyond defaults 10', [{ name: '' }, 10], place('Koht')],
  ['omitted index', [{}], place('Kodu')],
  ['non-object place', ['Tamme 5', 2], place('Trenn')],
  ['array place', [[], 5], place('Koht')],
  ['extra properties ignored', [{ id: 'legacy-id', name: 'Park', address: 'Park 1', lat: 59.3, lon: 26.3, extra: true, order: 4 }, 0], place('Park', 'Park 1', 59.3, 26.3)],
];

const PLACES_GOLDEN = [
  ['non-array null', [null], DEFAULT_TRIPLE()],
  ['non-array undefined', [undefined], DEFAULT_TRIPLE()],
  ['non-array string', ['[{"name":"A"}]'], DEFAULT_TRIPLE()],
  ['non-array object', [{ 0: { name: 'A' }, length: 1 }], DEFAULT_TRIPLE()],
  ['empty array', [[]], DEFAULT_TRIPLE()],
  ['1 item pads to three defaults', [[{ name: 'Ainult', lat: '1' }]], [place('Ainult', '', 1), place('Kool'), place('Trenn')]],
  ['3 items', [[{ name: 'A' }, { name: ' ' }, { address: 'C' }]], [place('A'), place('Kool'), place('Trenn', 'C')]],
  ['5 items are not truncated', [[{ name: 'A' }, null, { name: 'C' }, { name: '' }, { name: 'E', lat: '2', lon: 3 }]], [place('A'), place('Kool'), place('C'), place('Koht'), place('E', '', 2, 3)]],
];

const clone = value => structuredClone(value);

function assertGolden(label, implementation) {
  for (const [name, args, expected] of PLACE_GOLDEN) {
    const result = implementation.normalizePlace(...clone(args));
    assert.deepEqual(result, expected, `${label} normalizePlace: ${name}`);
    assert.deepEqual(Object.keys(result), ['name', 'address', 'lat', 'lon'], `${label} normalizePlace key order: ${name}`);
  }
  for (const [name, args, expected] of PLACES_GOLDEN) {
    assert.deepEqual(implementation.normalizePlaces(...clone(args)), expected, `${label} normalizePlaces: ${name}`);
  }
  assert.deepEqual(implementation.defaults, DEFAULT_TRIPLE(), `${label} defaults`);
  const before = clone(implementation.defaults);
  const padded = implementation.normalizePlaces([]);
  assert.ok(padded.every(item => !implementation.defaults.includes(item)), `${label} padding creates fresh objects`);
  padded[0].name = 'MUTATED';
  padded[1].lat = 1;
  implementation.normalizePlaces([{ name: 'X' }])[2].name = 'MUTATED';
  assert.deepEqual(implementation.defaults, before, `${label} defaults are not mutated`);
  assert.deepEqual(implementation.normalizePlaces(undefined), DEFAULT_TRIPLE(), `${label} later calls stay fresh`);
}

const MODULE = { defaults: SAVED_PLACE_DEFAULTS, normalizePlace, normalizePlaces };

test('neutral module exports exactly the saved-place defaults and normalizers', async () => {
  const exported = await import('../../src/places/savedPlaces.js');
  assert.deepEqual(Object.keys(exported).sort(), ['SAVED_PLACE_DEFAULTS', 'normalizePlace', 'normalizePlaces']);
});

test('neutral module reproduces the golden tables captured from both pre-extraction hooks', () => {
  assertGolden('savedPlaces.js', MODULE);
});

test('numeric parsing and fallback names stay exact', () => {
  assert.equal(normalizePlace({ lat: '12.5km' }).lat, 12.5);
  assert.equal(normalizePlace({ lat: '' }).lat, null);
  assert.equal(normalizePlace({ lon: [] }).lon, null);
  assert.equal(normalizePlace({ lon: ['7'] }).lon, 7);
  assert.ok(Object.is(normalizePlace({ lat: -0 }).lat, 0), 'parseFloat(String(-0)) yields +0, as in both pre-extraction hooks');
  assert.deepEqual([0, 1, 2, 3, 99].map(index => normalizePlace(null, index).name), ['Kodu', 'Kool', 'Trenn', 'Koht', 'Koht']);
  const beyond = normalizePlaces([{}, {}, {}, {}, {}, {}]);
  assert.equal(beyond.length, 6);
  assert.deepEqual(beyond.map(item => item.name), ['Kodu', 'Kool', 'Trenn', 'Koht', 'Koht', 'Koht']);
});

// ---- C2 source guards --------------------------------------------------------------------

const readSource = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const MODULE_IMPORT = /import\s*\{[^}]*\}\s*from\s*'\.\.\/places\/savedPlaces\.js';/;
const LOCAL_IMPLEMENTATION = [/function\s+normalizePlace\b/, /function\s+normalizePlaces\b/, /const\s+normalizePlaces?\s*=/, /const\s+DEFAULTS\b/, /name:\s*'Kodu'/, /'Koht'/];

test('useSavedPlaces imports the neutral module and keeps no local defaults or normalizers', () => {
  const source = readSource('src/hooks/useSavedPlaces.js');
  assert.match(source, MODULE_IMPORT);
  for (const pattern of LOCAL_IMPLEMENTATION) assert.doesNotMatch(source, pattern, `useSavedPlaces.js must not define ${pattern}`);
});

test('useSettings imports the neutral module, keeps no local implementation and preserves DEFAULT_PLACES', async () => {
  const source = readSource('src/hooks/useSettings.js');
  assert.match(source, MODULE_IMPORT);
  for (const pattern of LOCAL_IMPLEMENTATION) assert.doesNotMatch(source, pattern, `useSettings.js must not define ${pattern}`);
  const settings = await import('../../src/hooks/useSettings.js');
  assert.equal(settings.DEFAULT_PLACES, SAVED_PLACE_DEFAULTS, 'DEFAULT_PLACES stays exported as the shared defaults');
  assert.deepEqual(Object.keys(settings).sort(), ['DEFAULT_PLACES', 'useSettings']);
});

test('savedPlaces.js is pure: no imports, React, storage foundation or browser, storage and network globals', () => {
  const source = readSource('src/places/savedPlaces.js');
  assert.doesNotMatch(source, /\bimport\b|\brequire\s*\(/, 'the neutral module imports nothing');
  for (const token of ['react', 'storage/', 'localStorage', 'sessionStorage', 'indexedDB', 'window', 'document', 'navigator', 'globalThis', 'fetch', 'XMLHttpRequest', 'WebSocket']) {
    assert.ok(!source.includes(token), `savedPlaces.js must not use ${token}`);
  }
});
