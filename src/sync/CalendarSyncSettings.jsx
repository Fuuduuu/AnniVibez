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
  const [link, setLink] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const busy = state.status === 'syncing' || state.setupPending || state.linkPending;
  const claimForm = <form onSubmit={event => {
    event.preventDefault();
    if (!busy) sync.claimDevice({ ...(state.hasIncomingLink ? {} : { link }), deviceName });
  }}>
    <p>Ühenda see seade olemasoleva majapidamisega. Selle seadme varasemat kalendrit sinna ei saadeta;
      see säilitatakse kohalikus arhiivis ja kuvatakse majapidamise kalender.</p>
    {!state.hasIncomingLink && <div>
      <label htmlFor="device-link-input" className="mm-settings-label">Seadme link või kood</label>
      <input id="device-link-input" className="mm-input" value={link} required autoComplete="off"
        disabled={busy} onChange={event => setLink(event.target.value)} />
    </div>}
    <label htmlFor="device-link-name" className="mm-settings-label">Selle seadme nimi</label>
    <input id="device-link-name" className="mm-input" value={deviceName} required maxLength={120}
      disabled={busy} onChange={event => setDeviceName(event.target.value)} />
    <button type="submit" className="mm-button mm-button-primary" disabled={busy}>Ühenda seade</button>
  </form>;
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
        {!state.active && !state.setupBlocked && !state.hasIncomingLink && state.ready && state.loaded && (
          <form onSubmit={event => { event.preventDefault(); if (!busy) sync.enable(input); }}>
            {fields.map(([name, id, label, required, maxLength]) => <div key={name}>
              <label htmlFor={id} className="mm-settings-label">{label}</label>
              <input id={id} className="mm-input" value={input[name]} required={required} maxLength={maxLength}
                disabled={busy} onChange={event => setInput(current => ({ ...current, [name]: event.target.value }))} />
            </div>)}
            <button type="submit" className="mm-button mm-button-primary" disabled={busy}>Lülita sünk sisse</button>
          </form>
        )}
        {!state.active && state.ready && state.loaded && (state.hasIncomingLink ? <div>
          {claimForm}
          <button className="mm-button mm-button-secondary" disabled={busy}
            onClick={() => sync.dismissIncomingLink()}>Kleebi uus link</button>
        </div> : <details>
          <summary>Ühenda olemasoleva majapidamisega</summary>
          {claimForm}
        </details>)}
        {state.active && <div>
          <button className="mm-button mm-button-secondary" disabled={busy || !state.ready}
            onClick={() => sync.createDeviceLink()}>Lisa teine seade</button>
          {state.deviceLinkUrl && <div>
            <p>Saada see link ainult oma teisele seadmele. Link kehtib 10 minutit ja seda saab kasutada ühe korra.</p>
            <label htmlFor="device-link-created" className="mm-settings-label">Teise seadme link</label>
            <input id="device-link-created" className="mm-input" readOnly value={state.deviceLinkUrl}
              onFocus={event => event.target.select()} />
          </div>}
        </div>}
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
