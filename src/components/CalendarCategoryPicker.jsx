import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CATEGORIES, categoryPresentation, categoryTint, isCustomCategory } from '../calendar/categoryModel.js';
import { useCalendarCategories } from '../calendar/useCalendarCategories.js';

function CategorySheet({ mode, categories, onCreate, onRemove, onClose }) {
  const dialog = useRef(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#7A5CC8');
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  const create = event => {
    event.preventDefault();
    event.stopPropagation();
    try { onCreate({ label: name, color }); } catch (failure) { setError(failure.message); }
  };
  const remove = id => {
    try { onRemove(id); setError(''); } catch (failure) { setError(failure.message); }
  };
  return createPortal(<dialog ref={dialog} className="mm-event-dialog mm-category-dialog" aria-labelledby="category-dialog-title"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <header className="mm-dialog-heading"><h2 id="category-dialog-title">{mode === 'create' ? 'Uus kategooria' : 'Minu kategooriad'}</h2>
      <button type="button" className="mm-button mm-button-secondary" onClick={onClose}>{mode === 'create' ? 'Tühista' : 'Valmis'}</button></header>
    <div className="mm-dialog-body">
      {error && <p className="mm-notice mm-calendar-error" role="alert">{error}</p>}
      {mode === 'create' ? <form onSubmit={create}>
        <label className="mm-field" htmlFor="category-name">Nimi<input id="category-name" value={name} maxLength={60} required autoFocus onChange={event => setName(event.target.value)} /></label>
        <label className="mm-field" htmlFor="category-color">Värv<input id="category-color" type="color" value={color} onChange={event => setColor(event.target.value.toUpperCase())} /></label>
        <span className="mm-category-preview" style={{ background: categoryTint(color) }}><i style={{ background: color }} aria-hidden="true" />{name.trim() || 'Kategooria eelvaade'}</span>
        <button className="mm-button mm-button-primary mm-category-save" type="submit">Salvesta kategooria</button>
      </form> : <>
        <p className="mm-footnote">Kustutamine peidab kategooria selle seadme valikust. Olemasolevad sündmused säilitavad oma nime ja värvi.</p>
        {categories.length ? <ul className="mm-category-manager">{categories.map(category => <li key={category.id}>
          <span><i style={{ background: category.color }} aria-hidden="true" />{category.label}</span>
          <button type="button" className="mm-button mm-button-secondary mm-delete" aria-label={`Kustuta kategooria ${category.label}`} onClick={() => remove(category.id)}>Kustuta</button>
        </li>)}</ul> : <p>Kohandatud kategooriaid pole.</p>}
      </>}
    </div>
  </dialog>, document.querySelector('[data-app-shell]') || document.body);
}

export function CalendarCategoryPicker({ value, events, onChange, disabled = false }) {
  const registry = useCalendarCategories(events);
  const [sheet, setSheet] = useState(null);
  const selected = categoryPresentation(value);
  const choices = [...registry.categories];
  // A hidden or event-only snapshot remains selectable while editing that particular event.
  if (isCustomCategory(value.category) && !choices.some(category => category.id === value.category)) {
    choices.push({ id: value.category, label: value.categoryLabel, color: value.categoryColor });
  }
  const choose = id => {
    const custom = choices.find(category => category.id === id);
    onChange({ category: id, subtype: id === 'waste' ? value.subtype || 'mixed' : null,
      categoryLabel: custom?.label ?? null, categoryColor: custom?.color ?? null });
  };
  const create = input => {
    const category = registry.create(input);
    onChange({ category: category.id, subtype: null, categoryLabel: category.label, categoryColor: category.color });
    setSheet(null);
  };
  return <div className="mm-category-picker">
    <label className="mm-field" htmlFor="event-category">Kategooria<select id="event-category" value={value.category} onChange={event => choose(event.target.value)} disabled={disabled}>
      {Object.entries(CATEGORIES).map(([id, category]) => <option key={id} value={id}>{category.label}</option>)}
      {choices.length > 0 && <optgroup label="Minu kategooriad">{choices.map(category => <option key={category.id} value={category.id}>● {category.label}</option>)}</optgroup>}
    </select></label>
    <span className="mm-category-preview" style={{ background: selected.tint }}><i style={{ background: selected.color }} aria-hidden="true" />{selected.label}</span>
    <div className="mm-category-tools">
      <button type="button" className="mm-text-button" aria-label="Lisa kategooria" disabled={disabled || !registry.writable} onClick={() => setSheet('create')}>+ Lisa kategooria</button>
      {registry.categories.length > 0 && <button type="button" className="mm-text-button" disabled={disabled || !registry.writable} onClick={() => setSheet('manage')}>Halda kategooriaid</button>}
    </div>
    {registry.error && <p className="mm-footnote" role="status">{registry.error}</p>}
    {sheet && <CategorySheet mode={sheet} categories={registry.categories} onCreate={create} onRemove={registry.remove} onClose={() => setSheet(null)} />}
  </div>;
}
