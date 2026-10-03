import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATEGORIES, createEvent, validateEvent } from '../../src/calendar/eventModel.js';
import { calendarEventColors } from '../../src/design/tokens.js';
import { createEventRepository } from '../../src/calendar/eventRepository.js';
import { expandOccurrences } from '../../src/calendar/recurrence.js';
import { planCalendarOutbox } from '../../src/sync/calendarOutbox.js';

const builtIns = [
  ['culture', 'Kultuur', '#6B4CD8', '#E7E0FF'],
  ['birthday', 'Sünnipäevad', '#CC3F74', '#FFDDE8'],
  ['training', 'Trenn', '#3A8F2B', '#DFF3D8'],
  ['waste', 'Prügivedu', '#2A76CF', '#DCEBFF'],
  ['maintenance', 'Majahaldus', '#C8680F', '#FFE6CF'],
  ['car', 'Auto', '#278B8B', '#DDF2F1'],
  ['general', 'Üldine', '#5E6573', '#E7E8EC'],
];
const draft = { title: 'Kodu sündmus', category: 'general', date: '2026-10-05' };

test('only the seven V2 built-ins are selectable, in the accepted order and palette', () => {
  assert.deepEqual(Object.entries(CATEGORIES).map(([id, value]) => [id, value.label, value.color, value.tint]), builtIns);
  for (const [category, , color, tint] of builtIns) {
    assert.deepEqual(calendarEventColors({ category }), { color, tint });
  }
});

const customA = 'custom:32d04c45-5f31-4d12-8337-2f829c473a01';
const customB = 'custom:91d2731e-c1c7-4a13-90ec-5f16cc916ba2';

test('custom event snapshots require a strict UUID, bounded trimmed label and canonical RGB color', () => {
  const event = createEvent({ ...draft, category: customA, categoryLabel: '  Koertekool  ', categoryColor: '#7a5cc8' }, 'custom-event');
  assert.equal(event.category, customA);
  assert.equal(event.categoryLabel, 'Koertekool');
  assert.equal(event.categoryColor, '#7A5CC8');
  assert.equal(event.subtype, null);
  assert.deepEqual(calendarEventColors(event), { color: '#7A5CC8', tint: '#ECE8F7' });
  for (const patch of [
    { category: 'custom:dog' }, { category: customA + 'x' },
    { category: 'custom:32d04c45-5f31-4d12-7337-2f829c473a01' },
    { categoryLabel: '' }, { categoryLabel: ' ' }, { categoryLabel: 'x'.repeat(61) },
    { categoryLabel: null }, { categoryColor: null }, { categoryColor: '#fff' },
    { categoryColor: 'red' }, { categoryColor: '#12345678' }, { categoryColor: ' #7A5CC8' },
  ]) assert.throws(() => validateEvent({ ...event, ...patch }));
  for (const field of ['categoryLabel', 'categoryColor']) {
    const missing = { ...event }; delete missing[field];
    assert.throws(() => validateEvent(missing));
  }
  assert.throws(() => createEvent({ ...draft, categoryColor: '#7A5CC8' }, 'bad-built-in'));
});

test('legacy payment, maintenance, waste and general reads retain optional metadata absence', () => {
  for (const category of ['payment', 'maintenance', 'waste', 'general']) {
    const old = createEvent({ ...draft, category, ...(category === 'waste' ? { subtype: 'bio' } : {}) }, 'old-' + category);
    const bytes = JSON.stringify(old);
    assert.equal(JSON.stringify(validateEvent(old)), bytes);
    assert.equal(Object.hasOwn(old, 'categoryLabel'), false);
    assert.equal(Object.hasOwn(old, 'categoryColor'), false);
    assert.equal(old.category, category);
  }
  assert.deepEqual(calendarEventColors({ category: 'payment' }), { color: '#5E6573', tint: '#E7E8EC' });
});

const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const customFields = { category: customA, categoryLabel: 'Koertekool', categoryColor: '#7A5CC8' };

test('category transitions clear old metadata and cannot reuse another custom ID snapshot', () => {
  const repository = createEventRepository(memory(), () => 'transition');
  repository.create(draft);
  let event = repository.update('transition', customFields).events[0];
  assert.equal(event.category, customA);
  assert.throws(() => repository.update('transition', { category: customB }));
  event = repository.update('transition', { category: customB, categoryLabel: 'Rattasõit', categoryColor: '#278B8B' }).events[0];
  assert.equal(event.categoryLabel, 'Rattasõit');
  event = repository.update('transition', { category: 'culture' }).events[0];
  assert.equal(event.categoryLabel, null); assert.equal(event.categoryColor, null);
  event = repository.update('transition', customFields).events[0];
  event = repository.update('transition', { category: 'waste', subtype: 'bio' }).events[0];
  assert.equal(event.subtype, 'bio'); assert.equal(event.categoryColor, null);
  event = repository.update('transition', customFields).events[0];
  assert.equal(event.subtype, null);
  const legacy = createEventRepository(memory(), () => 'payment-edit');
  legacy.create({ ...draft, category: 'payment' });
  assert.equal(legacy.load().events[0].category, 'payment');
  assert.equal(legacy.update('payment-edit', { title: 'Muudetud vana sündmus' }).events[0].category, 'general');
});

test('one custom-category occurrence keeps a whole identity through later series edits', () => {
  const repository = createEventRepository(memory(), () => 'series');
  const initial = repository.create({ ...draft, ...customFields, recurrence: { frequency: 'weekly', interval: 1 } }).events[0];
  assert.equal(expandOccurrences([initial], '2026-10-12', '2026-10-12')[0].categoryLabel, 'Koertekool');
  repository.update('series', { category: 'culture' }, { scope: 'occurrence', occurrenceDate: '2026-10-12' });
  let event = repository.load().events[0];
  assert.deepEqual(event.overrides['2026-10-12'], { category: 'culture', subtype: null, categoryLabel: null, categoryColor: null });
  event = repository.update('series', { category: customB, categoryLabel: 'Rattasõit', categoryColor: '#278B8B' }, { scope: 'series' }).events[0];
  let occurrence = expandOccurrences([event], '2026-10-12', '2026-10-12')[0];
  assert.equal(occurrence.category, 'culture'); assert.equal(occurrence.categoryLabel, null);
  repository.update('series', customFields, { scope: 'occurrence', occurrenceDate: '2026-10-19' });
  event = repository.update('series', { category: 'car' }, { scope: 'series' }).events[0];
  occurrence = expandOccurrences([event], '2026-10-19', '2026-10-19')[0];
  assert.equal(occurrence.category, customA); assert.equal(occurrence.categoryLabel, 'Koertekool');
  assert.equal(occurrence.categoryColor, '#7A5CC8');
});

test('outbox represents metadata removal and sends category identity as one complete patch', () => {
  const auth = { key: 'device', deviceToken: 'm1s_' + 'A'.repeat(43),
    householdId: 'hld_32d04c45-5f31-4d12-8337-2f829c473a01',
    userId: 'usr_32d04c45-5f31-4d12-8337-2f829c473a01', sessionId: 'ses_32d04c45-5f31-4d12-8337-2f829c473a01' };
  const existing = { id: 'outbox-event', payload: createEvent({ ...draft, ...customFields }, 'outbox-event'), revision: 1, syncStatus: 'synced', deletedAt: null };
  const payload = createEvent({ ...draft, category: 'culture' }, 'outbox-event');
  const result = planCalendarOutbox({ auth, calendarEvents: [existing], outbox: [], sequence: 0 },
    { puts: [{ store: 'calendarEvents', record: { ...existing, payload } }], deletes: [] },
    { newId: () => 'mutation-category', clock: () => '2026-10-01T08:00:00.000Z' });
  const patch = result.puts.find(put => put.store === 'outbox').record.patch;
  assert.deepEqual(patch, { category: 'culture', subtype: null, categoryLabel: null, categoryColor: null });
});

test('custom registry saves reusable categories, discovers event and occurrence snapshots, and hides deleted choices only locally', async () => {
  const { createCategoryRepository, CATEGORY_STORAGE_KEY } = await import('../../src/calendar/categoryRepository.js');
  const { mergeCalendarCategories } = await import('../../src/calendar/categoryModel.js');
  const storage = memory();
  const repository = createCategoryRepository(storage, () => customA.slice(7));
  assert.deepEqual(repository.load().categories, []);
  assert.equal(storage.getItem(CATEGORY_STORAGE_KEY), null);
  repository.create({ label: ' Koertekool ', color: '#7a5cc8' });
  assert.deepEqual(createCategoryRepository(storage).load().categories, [{ id: customA, label: 'Koertekool', color: '#7A5CC8' }]);
  const events = [createEvent({ ...draft, ...customFields, recurrence: { frequency: 'weekly', interval: 1 }, }, 'discovered')];
  events[0].overrides['2026-10-12'] = { category: customB, subtype: null, categoryLabel: 'Rattasõit', categoryColor: '#278B8B' };
  const bytes = JSON.stringify(events);
  let choices = mergeCalendarCategories(repository.load(), events);
  assert.equal(choices.filter(entry => entry.id === customA).length, 1);
  assert.equal(choices.find(entry => entry.id === customB).label, 'Rattasõit');
  assert.equal(mergeCalendarCategories({ categories: [], hiddenIds: [] }, events).length, 2);
  repository.remove(customA);
  choices = mergeCalendarCategories(createCategoryRepository(storage).load(), events);
  assert.deepEqual(choices.map(entry => entry.id), [customB]);
  assert.equal(JSON.stringify(events), bytes, 'deleting the reusable choice never modifies an event snapshot');
  repository.remove(customB);
  assert.deepEqual(mergeCalendarCategories(repository.load(), events), []);
  storage.setItem(CATEGORY_STORAGE_KEY, '{broken');
  const before = storage.getItem(CATEGORY_STORAGE_KEY);
  assert.equal(repository.load().writable, false);
  assert.throws(() => repository.create({ label: 'Teine', color: '#123456' }));
  assert.equal(storage.getItem(CATEGORY_STORAGE_KEY), before);
});

test('custom tint is deterministic and light category colors keep a readable foreground', async () => {
  const { categoryTint, categoryInk, categoryPresentation } = await import('../../src/calendar/categoryModel.js');
  assert.equal(categoryTint('#ffffff'), '#FFFFFF');
  assert.equal(categoryTint('#000000'), '#DBDBDB');
  assert.equal(categoryInk('#FFFFFF'), '#15202E');
  assert.equal(categoryInk('#000000'), '#000000');
  assert.equal(categoryPresentation({ category: 'payment' }).label, 'Üldine');
  assert.equal(categoryPresentation({ category: 'payment' }).icon, 'general');
});
