import { useEffect, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { readPin } from '../hooks/useDiary';
import { PageHeader } from './ShellViews';
import { HouseholdSettings } from './HouseholdSettings';
import { WasteSettings } from './WasteSettings';
import { NotificationSettings } from './NotificationSettings';

const PIN_KEY     = 'sade_diary_pin';
const ENTRIES_KEY = 'sade_diary_entries';

function wPin(p)  { try { localStorage.setItem(PIN_KEY, btoa(p)); } catch {} }
function clrAll() { try { localStorage.removeItem(PIN_KEY); localStorage.removeItem(ENTRIES_KEY); } catch {} }

function SaveBtn({ saved, onClick, label = 'Salvesta', disabled = false }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`mm-button mm-button-primary mm-settings-save${saved ? ' mm-is-saved' : ''}`}>
      {saved ? '✓ Salvestatud' : label}
    </button>
  );
}

function SectionTitle({ children }) {
  return (
    <div className="mm-settings-subtitle">
      {children}
    </div>
  );
}

function ProfileSection({ profile, saveName }) {
  const [val, setVal]   = useState(profile.name);
  const [saved, setSaved] = useState(false);

  function save() { saveName(val); setSaved(true); setTimeout(() => setSaved(false), 2000); }

  return (
    <>
      <SectionTitle>Profiil</SectionTitle>
      <div className="mm-settings-panel">
        <label htmlFor="profile-name" className="mm-settings-label">Nimi</label>
        <input
          id="profile-name"
          value={val}
          onChange={e => { setVal(e.target.value); setSaved(false); }}
          placeholder="Kuidas sind kutsuda?"
          className="mm-input"
        />
        <SaveBtn saved={saved} onClick={save} />
      </div>
    </>
  );
}

function PlaceRow({ place, idx, onUpdate, onResolve, writable }) {
  const [name, setName] = useState(place.name);
  const [address, setAddress] = useState(place.address || '');
  const [saved, setSaved] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveState, setResolveState] = useState(place.lat != null && place.lon != null ? 'found' : 'idle');
  const [resolveMsg, setResolveMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Primitive dependencies preserve drafts on unrelated rerenders, but follow remote edits and row shifts.
  useEffect(() => {
    setName(place.name);
    setAddress(place.address || '');
    setResolveState(place.lat != null && place.lon != null ? 'found' : 'idle');
    setResolveMsg('');
  }, [place.name, place.address, place.lat, place.lon]);

  async function resolveAddress() {
    setResolving(true);
    setResolveMsg('');
    setResolveState('idle');
    try {
      const result = await onResolve({
        idx,
        name: name.trim(),
        address: address.trim(),
      });
      const lat = Number.parseFloat(result?.coords?.lat);
      const lon = Number.parseFloat(result?.coords?.lon);
      if (result?.ok && Number.isFinite(lat) && Number.isFinite(lon)) {
        try {
          await onUpdate(idx, {
            name: name.trim(),
            address: address.trim(),
            lat,
            lon,
          });
        } catch (failure) {
          setSaveError(failure.message);
          return;
        }
        setResolveState('found');
        return;
      }
      setResolveState('error');
      setResolveMsg(result?.message || 'Aadressi järgi ei leidnud asukohta.');
    } catch {
      setResolveState('error');
      setResolveMsg('Asukoha otsing ei õnnestunud. Proovi uuesti.');
    } finally {
      setResolving(false);
    }
  }

  // "Salvestatud" is shown only after the place update has committed; a failure keeps the edited values.
  async function save() {
    if (saving) return;
    const nextAddress = address.trim();
    const addressChanged = nextAddress !== (place.address || '');
    setSaveError('');
    setSaving(true);
    try {
      const persisted = await onUpdate(idx, {
        name: name.trim(),
        address: nextAddress,
        ...(addressChanged ? { lat: null, lon: null } : {}),
      });
      setName(persisted.places[idx].name);
      setAddress(persisted.places[idx].address || '');
    } catch (failure) {
      setSaveError(failure.message);
      return;
    } finally {
      setSaving(false);
    }
    if (addressChanged) {
      setResolveState('idle');
      setResolveMsg('');
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mm-settings-panel mm-place-card">
      <input
        value={name}
        onChange={e => { setName(e.target.value); setSaved(false); }}
        placeholder="Koha nimi (nt Kodu)"
        className="mm-input mm-place-name"
      />
      <input
        value={address}
        onChange={e => {
          setAddress(e.target.value);
          setSaved(false);
          setResolveState('idle');
          setResolveMsg('');
        }}
        placeholder="Aadress (nt Tallinna 12, Rakvere)"
        className="mm-input"
      />
      <button
        onClick={resolveAddress}
        disabled={resolving}
        className="mm-button mm-button-secondary mm-settings-wide"
      >
        {resolving ? 'Otsin aadressi…' : 'Leia asukoht'}
      </button>
      {resolveState === 'found' && (
        <div className="mm-status mm-status-success">
          Asukoht leitud ✓
        </div>
      )}
      {resolveState === 'error' && (
        <div className="mm-status mm-status-quiet">
          {resolveMsg}
        </div>
      )}
      {saveError && <div className="mm-field-error" role="alert">{saveError}</div>}
      <SaveBtn saved={saved} onClick={save} disabled={!writable || saving} />
    </div>
  );
}

function PlacesSection({ places, updatePlace, resolvePlaceAddress, writable, error }) {
  return (
    <>
      <SectionTitle>Salvestatud kohad</SectionTitle>
      <p className="mm-settings-intro">
        Salvestatud nimed ja aadressid jäävad alles. Aadressiotsing pole veel ühendatud.
      </p>
      {error && <div className="mm-field-error" role="alert">{error}</div>}
      {places.map((p, i) => (
        <PlaceRow key={i} place={p} idx={i} onUpdate={updatePlace} onResolve={resolvePlaceAddress} writable={writable} />
      ))}
    </>
  );
}

function PinSection() {
  const hasPinSet = !!readPin();
  const [view,  setView]   = useState('idle'); // idle | change | reset-confirm
  const [step,  setStep]   = useState(1);
  const [oldP,  setOldP]   = useState('');
  const [newP,  setNewP]   = useState('');
  const [confP, setConfP]  = useState('');
  const [err,   setErr]    = useState('');
  const [ok,    setOk]     = useState('');

  function reset() { setOldP(''); setNewP(''); setConfP(''); setErr(''); setStep(1); }

  function doChange() {
    if (step === 1) {
      if (oldP !== readPin()) { setErr('Praegune PIN ei klapi'); return; }
      setErr(''); setStep(2);
    } else if (step === 2) {
      if (newP.length < 4) { setErr('PIN peab olema vähemalt 4 numbrit'); return; }
      if (!/^\d+$/.test(newP)) { setErr('PIN-is võivad olla ainult numbrid'); return; }
      setErr(''); setStep(3);
    } else {
      if (confP !== newP) { setErr('PIN-id ei lähe kokku'); setConfP(''); return; }
      wPin(newP); reset(); setView('idle');
      setOk('PIN uuendatud ✓'); setTimeout(() => setOk(''), 3000);
    }
  }

  function doReset() {
    clrAll(); setView('idle');
    setOk('PIN ja päevik on kustutatud'); setTimeout(() => setOk(''), 4000);
  }

  if (!hasPinSet) return (
    <>
      <SectionTitle>Päeviku lukk</SectionTitle>
      <div className="mm-settings-panel mm-settings-empty">
        PIN pole veel peal. Ava Päevik ja pane PIN seal.
      </div>
    </>
  );

  return (
    <>
      <SectionTitle>Päeviku lukk</SectionTitle>
      {ok && (
        <div className="mm-status mm-status-info mm-pin-ok">
          {ok}
        </div>
      )}

      {view === 'idle' && (
        <div className="mm-settings-panel">
          <p className="mm-settings-intro">Muuda PIN-i ainult siis, kui sul on seda päriselt vaja.</p>
          <button onClick={() => { setView('change'); reset(); }} className="mm-button mm-button-secondary mm-settings-wide">Muuda PIN-i</button>
          <button onClick={() => setView('reset-confirm')} className="mm-button mm-button-danger-text mm-settings-wide">Kustuta PIN ja päevik</button>
        </div>
      )}

      {view === 'change' && (
        <div className="mm-settings-panel">
          <label className="mm-settings-label">
            {step === 1 ? 'Praegune PIN' : step === 2 ? 'Uus PIN' : 'Korda uut PIN-i'}
          </label>
          <input
            type="password" inputMode="numeric" maxLength={8} autoFocus
            value={step === 1 ? oldP : step === 2 ? newP : confP}
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '');
              if (step === 1) setOldP(v); else if (step === 2) setNewP(v); else setConfP(v);
              setErr('');
            }}
            onKeyDown={e => e.key === 'Enter' && doChange()}
            placeholder="• • • •"
            className="mm-input mm-pin-input"
          />
          {err && <div className="mm-field-error">{err}</div>}
          <div className="mm-settings-actions">
            <button onClick={() => { setView('idle'); reset(); }} className="mm-button mm-button-secondary">Tühista</button>
            <button onClick={doChange} className="mm-button mm-button-primary mm-settings-grow">{step < 3 ? 'Edasi →' : 'Salvesta PIN-i'}</button>
          </div>
        </div>
      )}

      {view === 'reset-confirm' && (
        <div className="mm-settings-panel mm-danger-panel">
          <p className="mm-danger-copy">
            See kustutab PIN-i ja <strong>kõik päeviku kirjed</strong> jäädavalt.
          </p>
          <div className="mm-settings-actions">
            <button onClick={() => setView('idle')} className="mm-button mm-button-secondary">Tühista</button>
            <button onClick={doReset} className="mm-button mm-button-danger">Kustuta kõik</button>
          </div>
        </div>
      )}
    </>
  );
}

export function SeadedTab(props = {}) {
  // The device-local profile may fall back to useSettings; shared saved places come from useSavedPlaces only.
  const fallback = useSettings();
  const profile = props.profile ?? fallback.profile;
  const saveName = props.saveName ?? fallback.saveName;
  const resolvePlaceAddress = props.resolvePlaceAddress ?? fallback.resolvePlaceAddress;
  const { places = [], updatePlace, placesWritable = true, placesError = null } = props;

  useEffect(() => {
    if (!props.initialSection) return;
    const section = document.getElementById(props.initialSection);
    section?.scrollIntoView({ block: 'start' });
    section?.focus({ preventScroll: true });
  }, [props.initialSection]);

  return (
    <div className="mm-page mm-settings-page">
      <PageHeader title="Seaded" subtitle="Lihtsad valikud, mida saad igal ajal muuta" />
      <section className="mm-settings-group" aria-labelledby="household-heading">
        <h2 className="mm-section-label" id="household-heading">Majapidamine</h2>
        <HouseholdSettings household={props.household} />
        <details className="mm-card">
          <summary>Sinu nimi</summary>
          <ProfileSection profile={profile} saveName={saveName} />
        </details>
      </section>
      <WasteSettings household={props.household} calendar={props.calendar} onAdd={props.onAddWaste}
        onOpen={props.onOpenEvent} onSchedule={props.onSchedule} lookup={props.wasteLookup} />
      <NotificationSettings reminders={props.reminders} />
      <section className="mm-settings-group" aria-labelledby="bus-settings-heading">
        <h2 className="mm-section-label" id="bus-settings-heading">Buss</h2>
        <details className="mm-card">
          <summary>Salvestatud kohad</summary>
          <PlacesSection places={places} updatePlace={updatePlace} resolvePlaceAddress={resolvePlaceAddress} writable={placesWritable} error={placesError} />
        </details>
      </section>
      <section className="mm-settings-group" aria-labelledby="application-heading">
        <h2 className="mm-section-label" id="application-heading">Rakendus</h2>
        <div className="mm-card">
          <p>Majandus</p>
          <details>
            <summary>Päeviku PIN ja andmed</summary>
            <PinSection />
          </details>
        </div>
      </section>
    </div>
  );
}
