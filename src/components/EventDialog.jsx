import { useEffect, useRef, useState } from 'react';
import { WASTE_SUBTYPES, FREQUENCIES } from '../calendar/eventModel';
import { CATEGORY_IDENTITY_FIELDS, categoryPresentation } from '../calendar/categoryModel.js';
import { CALENDAR_EDIT_CONFLICT, getEventEditTarget } from '../calendar/eventRepository.js';
import { formatDate } from '../calendar/dates';
import { useCalendarNow } from '../calendar/useCalendarNow';
import { ReminderStatus } from './ReminderStatus';
import { CalendarCategoryPicker } from './CalendarCategoryPicker.jsx';

const fields = event => ({title:event.title || '',category:event.category === 'payment' ? 'general' : event.category || 'general',subtype:event.subtype || 'mixed',
  ...(Object.hasOwn(event,'categoryLabel') ? {categoryLabel:event.categoryLabel} : {}),
  ...(Object.hasOwn(event,'categoryColor') ? {categoryColor:event.categoryColor} : {}),
  date:event.date,time:event.time || '',recurrence:{...(event.recurrence ?? {frequency:'none',interval:1})},
  reminder:{...(event.reminder ?? {daysBefore:0})},notes:event.notes || ''});
const hasAdvanced = event => event.recurrence?.frequency !== 'none' && !!event.recurrence
  || event.reminder?.daysBefore > 0 || !!event.notes?.trim();

function submitFields(form, imported) {
  if (imported) return { reminder: form.reminder, notes: form.notes };
  return { ...form, title: form.title.trim(), subtype: form.category === 'waste' ? form.subtype : null, time: form.time || null };
}

function changedFields(current, original) {
  const patch = Object.fromEntries(Object.entries(current).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(original[key])));
  if (CATEGORY_IDENTITY_FIELDS.some(key => Object.hasOwn(patch, key))) {
    for (const key of CATEGORY_IDENTITY_FIELDS) patch[key] = current[key] ?? null;
  }
  return patch;
}

function prepareEdit(record, scope, occurrenceDate) {
  const target = getEventEditTarget(record, { scope, occurrenceDate });
  if (!target) return null;
  const values = fields(target);
  const imported = record.source === 'imported';
  return {
    values,
    opening: { event:record, fields:submitFields(values, imported), legacyPayment:!imported && target.category === 'payment' },
    advancedOpen: imported || hasAdvanced(values),
  };
}

export function EventDialog({selection,calendar,onClose}) {
  const now=useCalendarNow();
  const source=selection.item ? calendar.events.find(e=>e.id === selection.item.eventId) : null;
  const directEdit = Object.hasOwn(selection, 'editScope');
  const [initialEdit] = useState(() => directEdit ? prepareEdit(source, selection.editScope, selection.item.occurrenceDate) : null);
  const [mode,setMode]=useState(() => {
    if (directEdit) return initialEdit ? 'edit' : 'unavailable';
    return selection.item ? 'view' : 'edit';
  });
  const [scope,setScope]=useState(selection.editScope ?? null);
  const [form,setForm]=useState(()=>initialEdit?.values ?? fields(selection.item || {date:selection.date,...selection.defaults}));
  const [opening,setOpening]=useState(initialEdit?.opening ?? null);
  const [conflict,setConflict]=useState(null);
  const [error,setError]=useState(directEdit && !initialEdit ? 'Sündmus muutus vahepeal. Ava see kalendrist uuesti.' : '');
  const [pending,setPending]=useState(false);
  const [advancedOpen,setAdvancedOpen]=useState(initialEdit?.advancedOpen ?? false);
  const dialog=useRef(null);
  const recurring=source?.recurrence.frequency !== 'none' && !!source;
  const imported=(opening?.event ?? source)?.source === 'imported';
  useEffect(()=>{
    const element=dialog.current;
    element.showModal();
    return ()=>element.close();
  },[]);
  useEffect(()=>{
    if(!pending) return;
    // Disabling the focused submit button can move focus to body. Catch Escape there too;
    // a repeated native cancel is not necessarily cancelable.
    const owner=dialog.current.ownerDocument;
    const blockEscape=event=>{if(event.key === 'Escape') event.preventDefault();};
    owner.addEventListener('keydown',blockEscape,true);
    return ()=>owner.removeEventListener('keydown',blockEscape,true);
  },[pending]);
  const set=(key,value)=>setForm(prev=>({...prev,[key]:value}));
  function edit(chosenScope, record = source) {
    const draft = prepareEdit(record, chosenScope, selection.item.occurrenceDate);
    if (!draft) {
      setError('Sündmus muutus vahepeal. Ava see kalendrist uuesti.');
      return;
    }
    setScope(chosenScope);
    setOpening(draft.opening);
    setForm(draft.values);
    setAdvancedOpen(draft.advancedOpen);
    setConflict(null);
    setError('');
    setMode('edit');
  }
  // The dialog closes and reports success only after the mutation has committed; a failure keeps the form.
  async function save(event) {
    event.preventDefault();
    if(pending || conflict) return;
    setError('');setPending(true);
    try {
      const current = submitFields(form, imported);
      let savedDate = current.date;
      if (opening) {
        const { eventId, occurrenceDate } = selection.item;
        const patch = changedFields(current, opening.fields);
        const options = { scope, occurrenceDate, baseline: opening.event };
        const saved = Object.keys(patch).length || opening.legacyPayment ? await calendar.update(eventId, patch, options) : calendar;
        const record = saved.events.find(event => event.id === eventId);
        savedDate = scope === 'occurrence' ? getEventEditTarget(record, options)?.date : record?.date;
      } else {
        await calendar.create(current);
      }
      if (savedDate) selection.onSaved?.(savedDate);
      onClose();
    } catch (failure) {
      if (failure.code === CALENDAR_EDIT_CONFLICT) setConflict(failure);
      setError(failure.message);
      setPending(false);
    }
  }
  async function remove() {
    if(pending) return;
    setError('');setPending(true);
    try { await calendar.remove(selection.item.eventId,{scope,occurrenceDate:selection.item.occurrenceDate});onClose(); }
    catch(failure) { setError(failure.message);setPending(false); }
  }
  const title=mode === 'view' ? 'Sündmus' : mode.startsWith('choose') ? 'Millist osa sarjast?' : mode === 'delete' ? 'Kustuta sündmus' : selection.item ? 'Muuda sündmust' : 'Lisa sündmus';
  const missing=selection.item && !source;
  const canReload = conflict && getEventEditTarget(conflict.current, { scope, occurrenceDate: selection.item.occurrenceDate });
  return <dialog ref={dialog} className="mm-event-dialog" aria-labelledby="event-dialog-title"
    onCancel={event=>{event.preventDefault();if(!pending) onClose();}}>
    <header className="mm-dialog-heading"><h2 id="event-dialog-title">{title}</h2><button type="button" className="mm-button mm-button-secondary" onClick={onClose} disabled={pending}>Tühista</button></header>
    <div className="mm-dialog-body">
      {(error || missing) && <p role="alert" className="mm-notice mm-calendar-error">{error || (opening
        ? 'Sündmus on vahepeal kustutatud. Vajadusel kopeeri mustandi tekst.'
        : 'Sündmus on vahepeal kustutatud. Sulge see vaade.')}</p>}
      {conflict && (canReload ? <div>
        <p>Uuesti laadimine asendab sinu mustandi praeguse sündmusega.</p>
        <button type="button" className="mm-button mm-button-secondary" onClick={() => edit(scope, conflict.current)}>Laadi praegune sündmus</button>
      </div> : <p>See sündmus või üksikkord pole enam samal kujul saadaval. Vajadusel kopeeri mustandi tekst.</p>)}
      {!missing && mode === 'view' && <>
        <h3>{selection.item.title}</h3>
        <p>{formatDate(selection.item.date,{day:'numeric',month:'long',year:'numeric'})} · {selection.item.time || 'Kogu päev'}</p>
        <p className="mm-category-detail" style={{'--category-color':categoryPresentation(selection.item).color,'--category-tint':categoryPresentation(selection.item).tint}}>
          <i aria-hidden="true" />{categoryPresentation(selection.item).label}{selection.item.category === 'waste' ? ` · ${WASTE_SUBTYPES[selection.item.subtype]}` : ''}</p>
        <p>{selection.item.source === 'manual' ? 'Käsitsi lisatud' : 'Imporditud'}{recurring ? ' · Korduv sündmus' : ''}</p>
        {selection.seriesOnly && recurring && <p className="mm-notice">Graafiku vaade: muudad või kustutad kogu sarja. Üksikkorra muutmiseks ava kuupäev kalendrist.</p>}
        {imported && <p className="mm-notice">{source.importMeta?.providerName || 'Allikas'}: kuupäev, liik ja pealkiri on allika hallata. Muuta saad märkmeid ja meeldetuletust.</p>}
        {selection.item.notes && <p className="mm-event-notes">{selection.item.notes}</p>}
        <ReminderStatus item={selection.item} now={now} detail />
        <p className="mm-footnote">Seadme teavitus sõltub sinu loast ja brauseri toest. Suletud äpis saatmist ei lubata.</p>
        <div className="mm-dialog-actions">
          <button className="mm-button mm-button-primary" onClick={()=>recurring ? selection.seriesOnly ? edit('series') : setMode('choose-edit') : edit(null)}>Muuda</button>
          <button className="mm-button mm-button-secondary mm-delete" onClick={()=>{
            if(recurring && selection.seriesOnly) {setScope('series');setMode('delete');}
            else setMode(recurring ? 'choose-delete' : 'delete');
          }}>Kustuta</button>
        </div>
      </>}
      {!missing && mode.startsWith('choose') && <>
        <p>Vali, kas muudad ainult valitud üksikkorda või kogu sarja.</p>
        <div className="mm-scope-options">{[['occurrence','Ainult see kord'],['series','Kogu sari']].map(([value,label])=><button key={value} className="mm-button mm-button-secondary"
          onClick={()=>{if(mode === 'choose-edit') edit(value);else {setScope(value);setMode('delete');}}}>{label}</button>)}</div>
      </>}
      {!missing && mode === 'delete' && <>
        <p>{scope === 'series' ? 'See kustutab kogu sarja koos kõigi üksikkordade ja eranditega.' : 'See kustutab ainult valitud sündmuse või üksikkorra.'}</p>
        <p><strong>{selection.item.title}</strong></p>
        {imported && <p>See eemaldab sündmuse ainult siit seadmest. Kui allikas tagastab kuupäeva uuesti, võib värskendamine selle tagasi lisada.</p>}
        <button className="mm-button mm-delete-confirm" onClick={remove} disabled={pending || !calendar.writable}>Kinnita kustutamine</button>
      </>}
      {mode === 'edit' && <form onSubmit={save}>
        {scope && <p className="mm-notice">{scope === 'series' ? 'Muudad kogu sarja. Alguskuupäeva või korduse muutmine eemaldab varasemad üksikkordade erandid ja kustutused.' : 'Muudad ainult seda üksikkorda. Ülejäänud sari jääb alles.'}</p>}
        {imported && <p className="mm-notice">Kuupäev, liik ja pealkiri on allika hallata. Märkmed ja meeldetuletus säilivad värskendamisel.</p>}
        <fieldset className="mm-source-fields" disabled={imported}>
        <label className="mm-field" htmlFor="event-title">Pealkiri<input id="event-title" value={form.title} onChange={e=>set('title',e.target.value)} maxLength={200} required autoFocus /></label>
        <CalendarCategoryPicker value={form} events={calendar.events} disabled={imported} onChange={identity=>setForm(previous=>({...previous,...identity}))} />
        {form.category === 'waste' && <label className="mm-field" htmlFor="event-subtype">Jäätme liik<select id="event-subtype" value={form.subtype} onChange={e=>set('subtype',e.target.value)}>{Object.entries(WASTE_SUBTYPES).map(([key,value])=><option value={key} key={key}>{value}</option>)}</select></label>}
        <div className="mm-form-pair">
          <label className="mm-field" htmlFor="event-date">Kuupäev<input id="event-date" type="date" value={form.date} onChange={e=>set('date',e.target.value)} required /></label>
          <label className="mm-field" htmlFor="event-time">Kellaaeg (valikuline)<input id="event-time" type="time" value={form.time} onChange={e=>set('time',e.target.value)} /></label>
        </div>
        </fieldset>
        <details className="mm-event-options" open={advancedOpen} onToggle={event=>setAdvancedOpen(event.currentTarget.open)}>
        <summary><span>Rohkem valikuid<small>Kordus, meeldetuletus ja märkmed</small></span></summary>
        <fieldset className="mm-source-fields" disabled={imported}>
        <label className="mm-field" htmlFor="event-repeat">Kordus<select id="event-repeat" value={form.recurrence.frequency} disabled={scope === 'occurrence'} onChange={e=>set('recurrence',{frequency:e.target.value,interval:1})}>{Object.entries(FREQUENCIES).map(([key,value])=><option value={key} key={key}>{value}</option>)}</select></label>
        {['weekly','monthly'].includes(form.recurrence.frequency) && <label className="mm-field" htmlFor="event-interval">Iga mitme {form.recurrence.frequency === 'weekly' ? 'nädala' : 'kuu'} järel?<input id="event-interval" type="number" min={1} max={form.recurrence.frequency === 'weekly' ? 52 : 12} value={form.recurrence.interval} disabled={scope === 'occurrence'} onChange={e=>set('recurrence',{...form.recurrence,interval:Number(e.target.value)})} required /></label>}
        {['monthly','yearly'].includes(form.recurrence.frequency) && <p className="mm-footnote">Kui kuupäev kuus puudub, kasutatakse selle kuu viimast päeva.</p>}
        </fieldset>
        <label className="mm-field" htmlFor="event-reminder">Meeldetuletuse eelistus<select id="event-reminder" value={form.reminder.daysBefore} onChange={e=>set('reminder',{daysBefore:Number(e.target.value)})}>{[[0,'Puudub'],[1,'1 päev enne'],[3,'3 päeva enne'],[7,'1 nädal enne']].map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label>
        <p className="mm-footnote">Meeldetuletus kuvatakse äpis. Ilma kellaajata algab see valitud päeval kell 09:00. Seadme teavitusi saad lubada seadetes; taustal saatmist ei lubata.</p>
        <label className="mm-field" htmlFor="event-notes">Märkmed (valikuline)<textarea id="event-notes" value={form.notes} onChange={e=>set('notes',e.target.value)} maxLength={5000} rows={3} /></label>
        </details>
        <footer className="mm-event-footer">
          <button className="mm-button mm-button-secondary" type="button" onClick={onClose} disabled={pending}>Tühista</button>
          <button className="mm-button mm-button-primary mm-save-event" type="submit" disabled={!calendar.writable || pending || !!conflict || !!missing}>Salvesta sündmus</button>
        </footer>
      </form>}
    </div>
  </dialog>;
}
