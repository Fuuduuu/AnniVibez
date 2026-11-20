import { useEffect, useRef, useState } from 'react';
import { SHOPPING_CATEGORIES } from '../shopping/model.js';
import { ShoppingSelectionChangedError } from '../shopping/shoppingStore.js';

const fields = item => ({ name: item.name, quantity: item.quantity, category: item.category, note: item.note });

export function ShoppingDialog({ item, shopping, onClose }) {
  const [form, setForm] = useState(() => fields(item));
  const original = useRef(fields(item));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = useRef(false);
  const dialog = useRef(null);
  const existing = shopping.items.find(entry => entry.id === item.id);
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close(); }, []);
  useEffect(() => {
    if (!pending) return;
    const owner = dialog.current.ownerDocument;
    const preventEscape = event => { if (event.key === 'Escape') event.preventDefault(); };
    owner.addEventListener('keydown', preventEscape, true);
    return () => owner.removeEventListener('keydown', preventEscape, true);
  }, [pending]);
  const set = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  async function save(event) {
    event.preventDefault();
    if (busy.current || !existing || !shopping.writable) return;
    busy.current = true; setError(''); setPending(true);
    try {
      const patch = Object.fromEntries(Object.entries(form).filter(([key, value]) => value !== original.current[key]));
      if (Object.keys(patch).length) await shopping.update(item.id, patch);
      onClose();
    } catch { setError('Ostu salvestamine ei õnnestunud. Sinu mustand on alles. Proovi uuesti.'); }
    finally { busy.current = false; setPending(false); }
  }
  async function remove() {
    if (busy.current || !existing || !shopping.writable) return;
    busy.current = true; setError(''); setPending(true);
    try { await shopping.remove(item.id); onClose(); }
    catch { setError('Ostu kustutamine ei õnnestunud. Ost on alles. Proovi uuesti.'); }
    finally { busy.current = false; setPending(false); }
  }
  return <dialog ref={dialog} role="dialog" className="mm-event-dialog mm-shopping-dialog" aria-labelledby="shopping-dialog-title"
    onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }}>
    <header className="mm-dialog-heading"><h2 id="shopping-dialog-title">{deleting ? 'Kustuta ost' : 'Muuda ostu'}</h2>
      <button className="mm-button mm-button-secondary" type="button" onClick={onClose} disabled={pending}>Tühista</button></header>
    <div className="mm-dialog-body">
      {(error || !existing) && <p role="alert" className="mm-notice mm-shopping-error">{error || 'See ost on vahepeal eemaldatud. Sinu mustand on siin alles.'}</p>}
      {existing?.syncStatus === 'conflict' && <p className="mm-notice">Vajab tähelepanu. Sinu kohalik muudatus on alles.</p>}
      {deleting ? <><h3>{item.name}</h3><p>See eemaldab valitud ostu nimekirjast.</p>
        <div className="mm-shopping-dialog-actions">
          <button className="mm-button mm-button-secondary" type="button" disabled={pending} onClick={() => setDeleting(false)}>Tagasi</button>
          <button className="mm-button mm-button-danger" type="button" disabled={pending || !existing || !shopping.writable} onClick={remove}>Kinnita kustutamine</button>
        </div></> : <form onSubmit={save}>
        <label className="mm-field" htmlFor="shopping-name">Nimetus<input id="shopping-name" required autoFocus maxLength={160}
          value={form.name} onChange={event => set('name', event.target.value)} disabled={pending} /></label>
        <label className="mm-field" htmlFor="shopping-quantity">Kogus<input id="shopping-quantity" maxLength={40}
          placeholder="Näiteks 2 pakki" value={form.quantity} onChange={event => set('quantity', event.target.value)} disabled={pending} /></label>
        <label className="mm-field" htmlFor="shopping-category">Kategooria<select id="shopping-category" value={form.category}
          onChange={event => set('category', event.target.value)} disabled={pending}>
          {Object.entries(SHOPPING_CATEGORIES).map(([id, category]) => <option key={id} value={id}>{category.label}</option>)}
        </select></label>
        <label className="mm-field" htmlFor="shopping-note">Märkus<textarea id="shopping-note" maxLength={500} rows={3}
          value={form.note} onChange={event => set('note', event.target.value)} disabled={pending} /></label>
        <footer className="mm-shopping-dialog-actions">
          <button className="mm-button mm-button-danger-text" type="button" disabled={pending || !existing || !shopping.writable}
            onClick={() => { setError(''); setDeleting(true); }}>Kustuta</button>
          <button className="mm-button mm-button-primary" type="submit" disabled={pending || !existing || !shopping.writable || !form.name.trim()}>Salvesta</button>
        </footer>
      </form>}
    </div>
  </dialog>;
}

export function ShoppingClearDialog({ items, shopping, onClose }) {
  const dialog = useRef(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const selectionChanged = error instanceof ShoppingSelectionChangedError;
  const count = items.length;
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close(); }, []);
  useEffect(() => {
    if (!pending) return;
    const owner = dialog.current.ownerDocument;
    const preventEscape = event => { if (event.key === 'Escape') event.preventDefault(); };
    owner.addEventListener('keydown', preventEscape, true);
    return () => owner.removeEventListener('keydown', preventEscape, true);
  }, [pending]);
  async function clear() {
    if (busy.current || selectionChanged || !count || !shopping.writable) return;
    busy.current = true; setPending(true); setError(null);
    try { await shopping.clearChecked(items); onClose(); }
    catch (failure) { setError(failure); }
    finally { busy.current = false; setPending(false); }
  }
  return <dialog ref={dialog} role="dialog" className="mm-event-dialog mm-shopping-dialog" aria-labelledby="shopping-clear-title"
    onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }}>
    <header className="mm-dialog-heading"><h2 id="shopping-clear-title">Kustuta ostetud asjad</h2>
      <button className="mm-button mm-button-secondary" type="button" disabled={pending} onClick={onClose}>Tühista</button></header>
    <div className="mm-dialog-body">
      {error && <p role="alert" className="mm-notice mm-shopping-error">
        {selectionChanged ? error.message : 'Ostetud asjade kustutamine ei õnnestunud. Nimekiri on alles. Proovi uuesti.'}
      </p>}
      <p>{count === 1 ? 'Nimekirjast eemaldatakse 1 ostetud asi.' : `Nimekirjast eemaldatakse ${count} ostetud asja.`} Ostmata asjad jäävad alles.</p>
      <div className="mm-shopping-dialog-actions"><button className="mm-button mm-button-danger" type="button"
        disabled={pending || selectionChanged || !count || !shopping.writable} onClick={clear}>Kustuta ostetud</button></div>
    </div>
  </dialog>;
}
