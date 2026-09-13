import { useEffect, useState } from 'react';
import { CalendarError } from './CalendarEvents';

export function focusHouseholdAddress() {
  const details=document.getElementById('household-profile');
  if(details) details.open=true;
  document.getElementById('household-address')?.focus();
}

export function HouseholdSettings({household}) {
  const [draft,setDraft]=useState(household.profile);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{setDraft(household.profile);},[household.profile]);
  function save(event) {
    event.preventDefault();setError('');setMessage('');
    try {household.save(draft);setMessage('Majapidamine salvestatud.');}
    catch(failure) {setError(failure.message);}
  }
  return <details className="mm-card" id="household-profile">
    <summary>Kodu nimi ja aadress</summary>
    <form onSubmit={save} className="mm-household-form">
      <CalendarError error={household.error || error} />
      <label className="mm-field" htmlFor="household-name">Kodu nimi<input id="household-name" value={draft.name} maxLength={100} onChange={e=>setDraft({...draft,name:e.target.value})} /></label>
      <label className="mm-field" htmlFor="household-address">Aadress<input id="household-address" autoComplete="street-address" value={draft.address} maxLength={500} onChange={e=>setDraft({...draft,address:e.target.value})} /></label>
      <p className="mm-footnote">Aadress salvestatakse ainult selles seadmes. Praegu pole automaatset prügiveo allikat ühendatud ja aadressi ei saadeta teenusepakkujale.</p>
      <button className="mm-button mm-button-primary" disabled={!household.writable}>Salvesta majapidamine</button>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
