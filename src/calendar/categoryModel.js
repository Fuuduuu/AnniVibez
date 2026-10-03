// Selectable categories. The legacy payment ID remains readable in eventModel.
export const CATEGORIES = {
  culture: { label: 'Kultuur', color: '#6B4CD8', tint: '#E7E0FF' },
  birthday: { label: 'Sünnipäevad', color: '#CC3F74', tint: '#FFDDE8' },
  training: { label: 'Trenn', color: '#3A8F2B', tint: '#DFF3D8' },
  waste: { label: 'Prügivedu', color: '#2A76CF', tint: '#DCEBFF' },
  maintenance: { label: 'Majahaldus', color: '#C8680F', tint: '#FFE6CF' },
  car: { label: 'Auto', color: '#278B8B', tint: '#DDF2F1' },
  general: { label: 'Üldine', color: '#5E6573', tint: '#E7E8EC' },
};

const CUSTOM_ID = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isCustomCategory = id => typeof id === 'string' && CUSTOM_ID.test(id);
export const CATEGORY_IDENTITY_FIELDS = ['category', 'subtype', 'categoryLabel', 'categoryColor'];

export function mergeCategoryIdentity(previous, patch) {
  const next = { ...previous, ...patch };
  if (Object.hasOwn(patch, 'category') && patch.category !== previous.category) {
    for (const field of ['categoryLabel', 'categoryColor']) {
      if (!Object.hasOwn(patch, field) && (Object.hasOwn(previous, field) || isCustomCategory(patch.category))) next[field] = null;
    }
  }
  return next;
}

export function validateCategorySnapshot(value) {
  const category = value.category;
  if (!Object.hasOwn(CATEGORIES, category) && category !== 'payment' && !isCustomCategory(category)) {
    throw new Error('Vali sündmuse kategooria.');
  }
  if (isCustomCategory(category)) {
    const label = value.categoryLabel;
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 60) {
      throw new Error('Kategooria nimi peab olema 1–60 märki.');
    }
    if (typeof value.categoryColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.categoryColor)) {
      throw new Error('Vali kategooria värv kujul #RRGGBB.');
    }
    return { category: category.toLowerCase(), categoryLabel: label.trim(), categoryColor: value.categoryColor.toUpperCase() };
  }
  const result = { category };
  // Absence stays absence on old payloads; null explicitly clears a previous snapshot.
  for (const field of ['categoryLabel', 'categoryColor']) {
    if (!Object.hasOwn(value, field)) continue;
    if (value[field] !== null) throw new Error('Valmiskategoorial ei saa olla kohandatud nime ega värvi.');
    result[field] = null;
  }
  return result;
}

export function categoryTint(color) {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Vigane kategooria värv.');
  return '#' + [1, 3, 5].map(offset => Math.round(255 * .86 + parseInt(color.slice(offset, offset + 2), 16) * .14)
    .toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function categoryInk(color) {
  const luminance = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const tint = categoryTint(color);
  return (luminance(tint) + .05) / (luminance(color) + .05) >= 4.5 ? color.toUpperCase() : '#15202E';
}

export function categoryPresentation(event) {
  if (isCustomCategory(event.category)) {
    const snapshot = validateCategorySnapshot(event);
    return { label: snapshot.categoryLabel, color: snapshot.categoryColor, tint: categoryTint(snapshot.categoryColor), icon: 'general' };
  }
  const id = Object.hasOwn(CATEGORIES, event.category) ? event.category : 'general';
  return { ...CATEGORIES[id], icon: id };
}

export function validateCustomCategory(value) {
  if (!value || !isCustomCategory(value.id)) throw new Error('Vigane kohandatud kategooria.');
  const snapshot = validateCategorySnapshot({ category: value.id, categoryLabel: value.label, categoryColor: value.color });
  return { id: snapshot.category, label: snapshot.categoryLabel, color: snapshot.categoryColor };
}

export function mergeCalendarCategories(registry, events) {
  const hidden = new Set(registry.hiddenIds ?? []);
  const categories = new Map();
  const add = value => {
    const category = validateCustomCategory(value);
    if (!hidden.has(category.id) && !categories.has(category.id)) categories.set(category.id, category);
  };
  for (const value of registry.categories ?? []) add(value);
  for (const event of events) {
    for (const snapshot of [event, ...Object.values(event.overrides ?? {}).map(patch => ({ ...event, ...patch }))]) {
      if (isCustomCategory(snapshot.category)) add({ id: snapshot.category, label: snapshot.categoryLabel, color: snapshot.categoryColor });
    }
  }
  return [...categories.values()];
}
