import { useEffect, useRef, useState } from 'react';
import { findWasteSchedule, addressKey } from '../waste/providers';
import { localDate, formatDate } from '../calendar/dates';
import { upcomingOccurrences } from '../calendar/recurrence';
import { WASTE_SUBTYPES, FREQUENCIES } from '../calendar/eventModel';
import { useCalendarNow } from '../calendar/useCalendarNow';
import { EventRows, CalendarError } from './CalendarEvents';
import { focusHouseholdAddress } from './HouseholdSettings';

export function WasteSettings(props) {
  // A new address gets a new lookup lifecycle; an old response cannot import into the new address context.
  return <WastePanel key={addressKey(props.household.profile.address)} {...props} />;
}

function WastePanel({household,calendar,onAdd,onOpen,onSchedule,lookup=findWasteSchedule}) {
  const now=useCalendarNow(),today=localDate(now),address=household.profile.address;
  const [result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [saving,setSaving]=useState(false);
  const request=useRef(null);
  useEffect(()=>()=>{request.current?.abort();request.current=null;},[]);
  const key=addressKey(address);
  const batches=(calendar.wasteImports ?? []).filter(b=>b.addressKey === key);
  const imported=calendar.events.filter(e=>e.source === 'imported' && e.category === 'waste' && e.importMeta?.addressKey === key);
  const otherAddressCount=calendar.events.filter(e=>e.source === 'imported' && e.category === 'waste' && e.importMeta?.addressKey !== key).length;
  const manual=calendar.events.filter(e=>e.source === 'manual' && e.category === 'waste');
  const next=upcomingOccurrences(imported,now,5);
  // The notice appears only after the import has committed; a failure keeps the previous calendar snapshot.
  async function accept(batch) {
    setSaving(true);
    try {
      await calendar.importWaste(batch,new Date());
      setNotice('Kalender uuendatud. Puuduvaid varasemaid kuupäevi automaatselt ei kustutata.');
      setError('');setResult(null);
    } catch(failure) {setError(failure.message);}
    finally {setSaving(false);}
  }
  async function search(refresh=false) {
    if(request.current || !address) return;
    const controller=new AbortController();request.current=controller;
    setBusy(true);setError('');setNotice('');setResult(null);
    try {
      const found=await lookup({address,signal:controller.signal});
      if(controller.signal.aborted || request.current !== controller) return;
      setResult(found);
      if(found.status === 'ERROR') setError(found.message);
      else if(refresh && ['SUPPORTED_WITH_RESULTS','SUPPORTED_NO_RESULTS'].includes(found.status)) {
        await accept(found);
        if(found.status === 'SUPPORTED_NO_RESULTS') setResult(found);
      }
    } catch {
      if(!controller.signal.aborted) setError('Graafiku otsimine ebaõnnestus. Proovi uuesti.');
    } finally {
      if(request.current === controller) {request.current=null;setBusy(false);}
    }
  }
  return <section className="mm-settings-group mm-waste" id="prugivedu" tabIndex={-1} aria-labelledby="waste-heading">
    <h2 className="mm-section-label" id="waste-heading">Prügivedu</h2>
    <CalendarError error={calendar.error} />
    <div className="mm-card mm-waste-source">
      <h3>Prügipäevad sinu kalendris</h3>
      {!address ? <><p>Lisa aadress, et kontrollida automaatse graafiku võimalust. Käsitsi saad graafiku lisada kohe.</p>
        <button className="mm-button mm-button-secondary" onClick={focusHouseholdAddress}>Lisa aadress</button></> : <>
        <p>{address}</p>
        <p className="mm-footnote">Automaatne graafik on võimalik ainult ühendatud ja toetatud allikast.</p>
        <button className="mm-button mm-button-secondary" disabled={busy || !calendar.writable} onClick={()=>search(false)}>
          {busy ? 'Otsin prügipäevi…' : 'Leia prügipäevad'}
        </button>
      </>}
      <div role="status" aria-busy={busy || undefined}>
        {busy && <p>Otsin graafikut. Käsitsi lisamine jääb kättesaadavaks.</p>}
        {result?.status === 'UNSUPPORTED' && <p>Selle aadressi jaoks pole ühendatud automaatset allikat. Lisa graafik käsitsi.</p>}
        {result?.status === 'SUPPORTED_NO_RESULTS' && <p>Allikas ei tagastanud kogumispäevi. Varasemad sündmused jäävad alles.</p>}
        {notice && <p>{notice}</p>}
      </div>
      {result?.status === 'SUPPORTED_WITH_RESULTS' && <div className="mm-waste-preview">
        <p>Leitud {result.entries.length} kogumispäeva · {result.provider.name}</p>
        <p>{[...new Set(result.entries.map(e=>WASTE_SUBTYPES[e.subtype]))].join(', ')}</p>
        <button className="mm-button mm-button-primary" disabled={!calendar.writable || saving} onClick={()=>accept(result)}>Impordi kalendrisse</button>
      </div>}
      <CalendarError error={error} />
      {error && <button className="mm-button mm-button-secondary" disabled={busy} onClick={()=>search(batches.length > 0)}>Proovi uuesti</button>}
    </div>
    {batches.length > 0 && <div className="mm-card mm-waste-source">
      <h3>Imporditud graafik</h3>
      {batches.map(batch=><div key={batch.key}>
        <p>{batch.providerName}</p>
        <p className="mm-footnote">Viimane edukas värskendus: {new Date(batch.lastSuccess).toLocaleString('et-EE')}</p>
        {batch.range && <p className="mm-footnote">Allika vahemik: {formatDate(batch.range.from)} – {formatDate(batch.range.to)}</p>}
      </div>)}
      <p>{[...new Set(imported.map(e=>WASTE_SUBTYPES[e.subtype]))].join(', ') || 'Imporditud kuupäevi pole.'}</p>
      <button className="mm-button mm-button-secondary" disabled={busy || !calendar.writable} onClick={()=>search(true)}>Värskenda graafikut</button>
      <p className="mm-footnote">Allikas haldab pealkirja, liiki ja kuupäeva. Sinu märkmed ja meeldetuletus jäävad alles. Puuduvat kuupäeva ei tõlgendata tühistamisena.</p>
      <EventRows items={next} today={today} onOpen={onOpen} />
      {!next.length && <p>Järgmisi imporditud kogumispäevi pole.</p>}
    </div>}
    {otherAddressCount > 0 && <p className="mm-notice">Varasema aadressi {otherAddressCount} imporditud sündmust on kalendris alles. Kontrolli neid kalendrist; aadressi muutmine ei kustuta sündmusi.</p>}
    <div className="mm-card mm-waste-manual">
      <h3>Käsitsi lisatud graafikud</h3>
      <p>Vali jäätmeliik, esimene kuupäev ja kordus. Automaatset allikat pole vaja.</p>
      <button className="mm-button mm-button-primary" disabled={!calendar.writable} onClick={()=>onAdd(today)}>Lisa käsitsi graafik</button>
      {!manual.length && <p className="mm-footnote">Käsitsi lisatud graafikuid pole veel.</p>}
      {manual.map(event=><div key={event.id} className="mm-waste-schedule">
        <strong>{event.title}</strong><p>{WASTE_SUBTYPES[event.subtype]} · {FREQUENCIES[event.recurrence.frequency]}{event.recurrence.interval > 1 ? ` (intervall ${event.recurrence.interval})` : ''}</p>
        <p className="mm-footnote">Algus: {formatDate(event.date,{day:'numeric',month:'long',year:'numeric'})}</p>
        <button className="mm-button mm-button-secondary" onClick={()=>onSchedule(event)} aria-label={`Muuda graafikut: ${event.title}`}>Muuda graafikut</button>
      </div>)}
    </div>
  </section>;
}
