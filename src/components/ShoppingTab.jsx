import { useEffect, useRef, useState } from 'react';
import { groupShoppingItems, SHOPPING_CATEGORIES } from '../shopping/model.js';
import { ShellIcon } from './ShellIcon.jsx';
import { ShoppingClearDialog, ShoppingDialog } from './ShoppingDialog.jsx';
import '../design/shopping.css';

export function ShoppingTab({ shopping }) {
  const { groups, unfinished, checked } = groupShoppingItems(shopping.items);
  const sync = shopping.sync ?? { status: 'local', active: false, pendingCount: 0 };
  const hasAuth = shopping.hasAuth ?? sync.active;
  const pendingCount = sync.pendingCount ?? shopping.pendingCount ?? 0;
  const conflictCount = shopping.conflicts?.length || sync.conflictCount || 0;
  const status = conflictCount ? 'Vajab tähelepanu'
    : !hasAuth ? 'Ainult selles seadmes'
    : sync.status === 'syncing' ? 'Sünkroonin…'
      : sync.status === 'waiting' ? 'Ootab võrguühendust'
        : sync.status === 'attention' ? 'Vajab tähelepanu'
          : pendingCount ? 'Ootab sünkroonimist' : sync.status === 'synced' ? 'Sünkroonitud' : 'Sünkroonimise ootel';
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [editing, setEditing] = useState(null);
  const [pendingItems, setPendingItems] = useState(new Set());
  const [checkedOpen, setCheckedOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshBusy = useRef(false);
  const itemBusy = useRef(new Set());
  const input = useRef(null);
  const busy = useRef(false);
  useEffect(() => { if (focusRequest) input.current?.focus(); }, [focusRequest]);
  async function add(event) {
    event.preventDefault();
    if (busy.current || !shopping.writable || !draft.trim()) return;
    busy.current = true; setError(''); setPending(true);
    try {
      await shopping.add({ name: draft, category: 'food' });
      setDraft('');
    } catch { setError('Ostu lisamine ei õnnestunud. Sinu sisestus on alles. Proovi uuesti.'); }
    finally {
      busy.current = false; setPending(false);
      setFocusRequest(previous => previous + 1);
    }
  }
  async function check(item, value) {
    if (itemBusy.current.has(item.id) || !shopping.writable) return;
    itemBusy.current.add(item.id); setPendingItems(new Set(itemBusy.current)); setError('');
    try { await shopping.check(item.id, value); }
    catch { setError('Ostu märkimine ei õnnestunud. Varasem olek on alles. Proovi uuesti.'); }
    finally { itemBusy.current.delete(item.id); setPendingItems(new Set(itemBusy.current)); }
  }
  async function refresh() {
    if (refreshBusy.current) return;
    refreshBusy.current = true; setRefreshing(true); setError('');
    try { await shopping.refresh(); }
    catch { setError('Nimekirja värskendamine ei õnnestunud. Sinu ostud on alles. Proovi uuesti.'); }
    finally { refreshBusy.current = false; setRefreshing(false); }
  }
  const row = item => <ShoppingRow key={item.id} item={item} disabled={!shopping.writable || pendingItems.has(item.id)}
    attention={item.syncStatus === 'conflict' || shopping.conflicts?.some(conflict => conflict.entityId === item.id)}
    onCheck={value => check(item, value)} onEdit={() => setEditing(item)} />;
  return <div className="mm-page mm-shopping-page">
    <header className="mm-page-header"><h1>Ostunimekiri</h1>
      <p>{shopping.loading ? 'Laadin nimekirja…' : shopping.error ? 'Nimekiri pole praegu saadaval'
        : unfinished.length === 1 ? '1 asi ostmata' : `${unfinished.length} asja ostmata`}</p></header>
    <form className="mm-shopping-quick" onSubmit={add}>
      <input ref={input} id="shopping-quick-name" className="mm-input" aria-label="Lisa ost"
        placeholder="Lisa ost..." maxLength={160} value={draft} onChange={event => setDraft(event.target.value)}
        disabled={!shopping.writable || pending || shopping.loading} />
      <button className="mm-button mm-button-primary" type="submit" aria-label="Lisa ost"
        disabled={!shopping.writable || pending || shopping.loading || !draft.trim()}><ShellIcon name="add" /></button>
    </form>
    {(shopping.error || error) && <p className="mm-notice mm-shopping-error" role="alert">{shopping.error || error}</p>}
    {groups.map(group => <section className="mm-section mm-shopping-group" key={group.id} aria-labelledby={`shopping-${group.id}`}
      style={{ '--shopping-color': SHOPPING_CATEGORIES[group.id].color, '--shopping-tint': SHOPPING_CATEGORIES[group.id].tint }}>
      <h2 id={`shopping-${group.id}`} className="mm-section-label"><i aria-hidden="true" />{group.label.toLocaleUpperCase('et')}</h2>
      <ul className="mm-card mm-shopping-list">{group.items.map(row)}</ul>
    </section>)}
    {!!checked.length && <details className="mm-section mm-shopping-checked" open={checkedOpen} onToggle={event => setCheckedOpen(event.currentTarget.open)}>
      <summary>OSTETUD · {checked.length}</summary>
      <ul className="mm-card mm-shopping-list">{checked.map(row)}</ul>
      <button className="mm-button mm-button-danger-text mm-shopping-clear" type="button" disabled={!shopping.writable} onClick={() => setClearing(true)}>Kustuta ostetud</button>
    </details>}
    {!shopping.items.length && !shopping.loading && !shopping.error && <section className="mm-card mm-shopping-empty"><ShellIcon name="shopping" />
      <h2>Ostunimekiri on tühi</h2><p>Lisa esimene ost ülal.</p></section>}
    <div className="mm-shopping-status-row"><p className="mm-shopping-status" role="status" data-sync-state={sync.status}>{status}
      {conflictCount > 0 ? ` · ${conflictCount} ${conflictCount === 1 ? 'muudatus' : 'muudatust'}`
        : hasAuth && pendingCount > 0 && sync.status !== 'syncing' ? ` · ${pendingCount} ootel` : ''}</p>
      <button className="mm-text-button" type="button" disabled={refreshing || shopping.loading} onClick={refresh}>Värskenda</button></div>
    {conflictCount > 0 && <p className="mm-shopping-sync-note">Sinu kohalik muudatus on alles. Sünkroonimine vajab tähelepanu.</p>}
    {!conflictCount && sync.status === 'attention' && sync.error && <p className="mm-shopping-sync-note">{sync.error}</p>}
    {editing && <ShoppingDialog key={editing.id} item={editing} shopping={shopping} onClose={() => setEditing(null)} />}
    {clearing && <ShoppingClearDialog count={checked.length} shopping={shopping} onClose={() => setClearing(false)} />}
  </div>;
}

function ShoppingRow({ item, disabled, attention, onCheck, onEdit }) {
  return <li className={`mm-shopping-row${item.checkedAt ? ' mm-shopping-row-checked' : ''}`}>
    <label className="mm-shopping-check">
      <input type="checkbox" checked={!!item.checkedAt} disabled={disabled}
        aria-label={`${item.checkedAt ? 'Märgi ostmata' : 'Märgi ostetuks'}: ${item.name}`} onChange={event => onCheck(event.target.checked)} />
      <span aria-hidden="true">{item.checkedAt && '✓'}</span>
    </label>
    <button className="mm-shopping-item" type="button" aria-label={`Muuda: ${item.name}`} onClick={onEdit}>
      <span><strong>{item.name}</strong>{item.quantity && <small>{item.quantity}</small>}
        {attention && <small className="mm-shopping-attention">Vajab tähelepanu</small>}</span>
      <span className="mm-shopping-edit">Muuda<ShellIcon name="edit" /></span>
    </button>
  </li>;
}
