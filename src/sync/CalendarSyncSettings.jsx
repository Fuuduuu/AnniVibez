import { useState, useSyncExternalStore } from 'react';

const STATUS = {
  unset: 'Pole seadistatud', syncing: 'Sünkroonimine...', synced: 'Sünkroonitud',
  waiting: 'Võrguühendus puudub / sünkroonimine ootab', attention: 'Vajab tähelepanu',
};
const LOCAL = { status: 'unset', active: false, ready: false, loaded: true };
const getLocal = () => LOCAL;
const subscribeLocal = () => () => {};

export function CalendarSyncSettings({ sync, profile, household }) {
  const state = useSyncExternalStore(sync?.subscribe ?? subscribeLocal, sync?.getSnapshot ?? getLocal);
  const [input, setInput] = useState({ userName: profile?.name ?? '', householdName: household?.profile?.name ?? '',
    householdAddress: household?.profile?.address ?? '', deviceName: '' });
  const busy = state.status === 'syncing' || state.setupPending;
  const fields = [
    ['userName', 'calendar-sync-user', 'Sinu nimi', true, 80],
    ['householdName', 'calendar-sync-household', 'Majapidamise nimi', true, 120],
    ['householdAddress', 'calendar-sync-address', 'Aadress (valikuline)', false, 240],
    ['deviceName', 'calendar-sync-device', 'Seadme nimi', true, 120],
  ];
  return (
    <section className="mm-settings-group" aria-labelledby="calendar-sync-heading">
      <h2 className="mm-section-label" id="calendar-sync-heading">Pilvesünk</h2>
      <div className="mm-settings-panel">
        <p role="status">{STATUS[state.status]}</p>
        <p>Sünkroonitakse ainult kalendrit. Päevik ja Tegevus jäävad sellesse seadmesse.</p>
        {!state.ready && <p>Pilvesünk pole selles salvestusrežiimis saadaval. Kalender jääb kohalikuks.</p>}
        {state.error && <p className="mm-field-error" role="alert">{state.error}</p>}
        {!state.active && !state.setupBlocked && state.ready && state.loaded && (
          <form onSubmit={event => { event.preventDefault(); if (!busy) sync.enable(input); }}>
            {fields.map(([name, id, label, required, maxLength]) => <div key={name}>
              <label htmlFor={id} className="mm-settings-label">{label}</label>
              <input id={id} className="mm-input" value={input[name]} required={required} maxLength={maxLength}
                disabled={busy} onChange={event => setInput(current => ({ ...current, [name]: event.target.value }))} />
            </div>)}
            <button type="submit" className="mm-button mm-button-primary" disabled={busy}>Lülita sünk sisse</button>
          </form>
        )}
        {(state.active || state.setupBlocked) && <button className="mm-button mm-button-secondary"
          disabled={busy || !state.ready} onClick={() => sync.run()}>Proovi uuesti</button>}
        {state.recoveryCode && <div>
          <p>Salvesta taastamiskood turvaliselt. Seda näidatakse ainult praegu.</p>
          <p><code>{state.recoveryCode}</code></p>
          <button className="mm-button mm-button-secondary" onClick={() => sync.dismissRecovery()}>Olen koodi salvestanud</button>
        </div>}
      </div>
    </section>
  );
}
