import { dayNumber } from './dates.js';
import { CATEGORY_IDENTITY_FIELDS, isCustomCategory, mergeCategoryIdentity, validateCategorySnapshot } from './categoryModel.js';

export { CATEGORIES } from './categoryModel.js';
export const WASTE_SUBTYPES = {mixed:'Segaolmejäätmed',bio:'Biojäätmed',paper:'Paber ja papp',packaging:'Pakendid',other:'Muu'};
export const FREQUENCIES = {none:'Ei kordu',weekly:'Iga nädal',monthly:'Iga kuu',yearly:'Iga aasta'};
export const EDIT_FIELDS = ['title','category','subtype','categoryLabel','categoryColor','date','time','reminder','notes'];
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

function normalizeBase(value) {
  requireValue(plain(value),'Vigane sündmus.');
  requireValue(typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200,'Vigane sündmuse ID.');
  requireValue(typeof value.title === 'string' && value.title.trim().length > 0 && value.title.length <= 200,'Lisa pealkiri (kuni 200 märki).');
  const categorySnapshot = validateCategorySnapshot(value);
  requireValue(value.category !== 'waste' || Object.hasOwn(WASTE_SUBTYPES,value.subtype),'Vali jäätme liik.');
  dayNumber(value.date);
  const time = value.time || null;
  requireValue(time === null || (typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)),'Vigane kellaaeg.');
  const recurrence = value.recurrence ?? {frequency:'none',interval:1};
  const maximum = {none:1,weekly:52,monthly:12,yearly:1};
  requireValue(plain(recurrence) && Object.hasOwn(FREQUENCIES,recurrence.frequency),'Vigane kordus.');
  const interval = recurrence.interval ?? 1;
  requireValue(Number.isInteger(interval) && interval >= 1 && interval <= maximum[recurrence.frequency],'Vigane korduse intervall.');
  const reminder = value.reminder ?? {daysBefore:0};
  requireValue(plain(reminder) && [0,1,3,7].includes(reminder.daysBefore),'Vigane meeldetuletus.');
  requireValue(['manual','imported'].includes(value.source),'Vigane sündmuse allikas.');
  requireValue(value.householdId == null || typeof value.householdId === 'string','Vigane majapidamise ID.');
  requireValue(value.notes == null || (typeof value.notes === 'string' && value.notes.length <= 5000),'Märkmed võivad olla kuni 5000 märki.');
  requireValue(recurrence.frequency === 'none' ? value.seriesId == null : typeof value.seriesId === 'string' && !!value.seriesId,'Vigane sarja ID.');
  return {...value, ...categorySnapshot, title:value.title.trim(), householdId:value.householdId ?? null,
    subtype:value.category === 'waste' ? value.subtype : null, time,
    recurrence:{...recurrence,interval}, reminder:{...reminder}, notes:value.notes ?? '', seriesId:value.seriesId ?? null};
}

export function validateEvent(value) {
  const event = normalizeBase(value);
  const excluded = value.excludedDates ?? [];
  const overrides = value.overrides ?? {};
  requireValue(Array.isArray(excluded) && plain(overrides),'Vigased sarja erandid.');
  const excludedDates = [...new Set(excluded.map(date => {dayNumber(date);return date;}))].sort();
  const normalizedOverrides = Object.fromEntries(Object.entries(overrides).map(([date,patch]) => {
    dayNumber(date);requireValue(plain(patch),'Vigane üksikkorra muudatus.');
    requireValue(Object.keys(patch).every(key=>EDIT_FIELDS.includes(key)),'Üksikkord ei saa muuta sarja reeglit.');
    if(isCustomCategory(patch.category) || Object.hasOwn(patch,'categoryLabel') || Object.hasOwn(patch,'categoryColor')) {
      requireValue(CATEGORY_IDENTITY_FIELDS.every(key=>Object.hasOwn(patch,key)),'Üksikkorra kategooria peab sisaldama tervet nime ja värvi.');
    }
    const merged = normalizeBase(mergeCategoryIdentity(event,patch));
    const normalized = Object.fromEntries(Object.keys(patch).map(key=>[key,merged[key]]));
    if(CATEGORY_IDENTITY_FIELDS.some(key=>Object.hasOwn(patch,key)) &&
      (isCustomCategory(event.category) || isCustomCategory(merged.category) || Object.hasOwn(patch,'categoryLabel') || Object.hasOwn(patch,'categoryColor'))) {
      for(const key of CATEGORY_IDENTITY_FIELDS) normalized[key]=merged[key] ?? null;
    }
    return [date,normalized];
  }));
  requireValue(event.recurrence.frequency !== 'none' || (!excludedDates.length && !Object.keys(overrides).length),'Üksiksündmusel ei saa olla sarja erandeid.');
  return {...event,excludedDates,overrides:normalizedOverrides};
}

export function createEvent(input, id = crypto.randomUUID()) {
  const recurrence = input.recurrence ?? {frequency:'none',interval:1};
  return validateEvent({...input,id,householdId:null,source:'manual',recurrence,
    seriesId:recurrence.frequency === 'none' ? null : `series:${id}`,excludedDates:[],overrides:{}});
}
