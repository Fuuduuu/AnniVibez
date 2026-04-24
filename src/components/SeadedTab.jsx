import { useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { readPin } from '../hooks/useDiary';
import { AV, FONT, card, labelStyle, inp, shell } from '../design/tokens';

const PIN_KEY     = 'sade_diary_pin';
const ENTRIES_KEY = 'sade_diary_entries';

function wPin(p)  { try { localStorage.setItem(PIN_KEY, btoa(p)); } catch {} }
function clrAll() { try { localStorage.removeItem(PIN_KEY); localStorage.removeItem(ENTRIES_KEY); } catch {} }

function SaveBtn({ saved, onClick, label = 'Salvesta' }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', marginTop: 10, padding: '10px 0', borderRadius: 12, border: 'none',
      background: saved ? AV.sage : AV.purple,
      color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'background .2s',
    }}>
      {saved ? '✓ Salvestatud' : label}
    </button>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 10, ...labelStyle, marginTop: 24, marginBottom: 10 }}>
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
      <div style={{ ...card, background: AV.bgWarm }}>
        <label style={labelStyle}>Nimi</label>
        <input
          value={val}
          onChange={e => { setVal(e.target.value); setSaved(false); }}
          placeholder="Kuidas sind kutsuda?"
          style={inp}
        />
        <SaveBtn saved={saved} onClick={save} />
      </div>
    </>
  );
}

function PlaceRow({ place, idx, onUpdate, onResolve }) {
  const [name, setName] = useState(place.name);
  const [address, setAddress] = useState(place.address || '');
  const [saved, setSaved] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveState, setResolveState] = useState(place.lat != null && place.lon != null ? 'found' : 'idle');
  const [resolveMsg, setResolveMsg] = useState('');

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
        onUpdate(idx, {
          name: name.trim(),
          address: address.trim(),
          lat,
          lon,
        });
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

  function save() {
    const nextAddress = address.trim();
    const addressChanged = nextAddress !== (place.address || '');
    onUpdate(idx, {
      name: name.trim(),
      address: nextAddress,
      ...(addressChanged ? { lat: null, lon: null } : {}),
    });
    if (addressChanged) {
      setResolveState('idle');
      setResolveMsg('');
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ ...card, marginBottom: 8 }}>
      <input
        value={name}
        onChange={e => { setName(e.target.value); setSaved(false); }}
        placeholder="Koha nimi (nt Kodu)"
        style={{ ...inp, marginBottom: 8 }}
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
        style={inp}
      />
      <button
        onClick={resolveAddress}
        disabled={resolving}
        style={{
          width: '100%',
          marginTop: 8,
          padding: '10px 0',
          borderRadius: 12,
          border: `1px solid ${AV.border}`,
          background: AV.card,
          fontSize: 13,
          color: AV.textSoft,
          cursor: resolving ? 'default' : 'pointer',
        }}
      >
        {resolving ? 'Otsin aadressi…' : 'Leia asukoht'}
      </button>
      {resolveState === 'found' && (
        <div style={{ marginTop: 8, fontSize: 12, color: AV.sage, background: AV.sageL, borderRadius: 10, padding: '7px 10px' }}>
          Asukoht leitud ✓
        </div>
      )}
      {resolveState === 'error' && (
        <div style={{ marginTop: 8, fontSize: 12, color: AV.muted, background: AV.bgWarm, borderRadius: 10, padding: '7px 10px' }}>
          {resolveMsg}
        </div>
      )}
      <SaveBtn saved={saved} onClick={save} />
    </div>
  );
}

function PlacesSection({ places, updatePlace, resolvePlaceAddress }) {
  return (
    <>
      <SectionTitle>Salvestatud kohad</SectionTitle>
      <p style={{ fontSize: 13, color: AV.muted, marginBottom: 12, lineHeight: 1.5 }}>
        Kirjuta koha nimi ja aadress. Vajuta "Leia asukoht", et bussivaade saaks selle koha leida.
      </p>
      {places.map((p, i) => (
        <PlaceRow key={i} place={p} idx={i} onUpdate={updatePlace} onResolve={resolvePlaceAddress} />
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
      <div style={{ ...card, color: AV.muted, fontSize: 14 }}>
        PIN pole veel peal. Ava Päevik ja pane PIN seal.
      </div>
    </>
  );

  return (
    <>
      <SectionTitle>Päeviku lukk</SectionTitle>
      {ok && (
        <div style={{ ...card, background: AV.purpleL, color: AV.purple, fontSize: 14, fontWeight: 500, boxShadow: 'none', marginBottom: 10 }}>
          {ok}
        </div>
      )}

      {view === 'idle' && (
        <div style={{ ...card, background: AV.bgWarm }}>
          <p style={{ fontSize: 13, color: AV.muted, lineHeight: 1.5, marginBottom: 10 }}>Muuda PIN-i ainult siis, kui sul on seda päriselt vaja.</p>
          <button onClick={() => { setView('change'); reset(); }} style={{
            display: 'block', width: '100%', padding: '11px 0', borderRadius: 12,
            border: `1px solid ${AV.border}`, background: AV.card,
            fontSize: 14, color: AV.text, cursor: 'pointer', marginBottom: 10,
          }}>Muuda PIN-i</button>
          <button onClick={() => setView('reset-confirm')} style={{
            display: 'block', width: '100%', padding: '11px 0', borderRadius: 12,
            border: 'none', background: 'none', fontSize: 13, color: AV.danger, cursor: 'pointer',
          }}>Kustuta PIN ja päevik</button>
        </div>
      )}

      {view === 'change' && (
        <div style={card}>
          <label style={labelStyle}>
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
            style={{ ...inp, textAlign: 'center', letterSpacing: 8, fontSize: 20, marginBottom: 6 }}
          />
          {err && <div style={{ fontSize: 13, color: AV.danger, marginBottom: 6 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => { setView('idle'); reset(); }} style={{
              flex: 1, padding: '10px 0', borderRadius: 12,
              border: `1px solid ${AV.border}`, background: AV.card,
              fontSize: 13, color: AV.muted, cursor: 'pointer',
            }}>Tühista</button>
            <button onClick={doChange} style={{
              flex: 2, padding: '10px 0', borderRadius: 12, border: 'none',
              background: AV.purple, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>{step < 3 ? 'Edasi →' : 'Salvesta PIN-i'}</button>
          </div>
        </div>
      )}

      {view === 'reset-confirm' && (
        <div style={{ ...card, borderColor: '#fca5a5', background: '#fff5f5' }}>
          <p style={{ fontSize: 14, color: AV.danger, margin: '0 0 12px' }}>
            See kustutab PIN-i ja <strong>kõik päeviku kirjed</strong> jäädavalt.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setView('idle')} style={{
              flex: 1, padding: '10px 0', borderRadius: 12,
              border: `1px solid ${AV.border}`, background: AV.card,
              fontSize: 13, color: AV.muted, cursor: 'pointer',
            }}>Tühista</button>
            <button onClick={doReset} style={{
              flex: 1, padding: '10px 0', borderRadius: 12, border: 'none',
              background: AV.danger, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>Kustuta kõik</button>
          </div>
        </div>
      )}
    </>
  );
}

export function SeadedTab(props = {}) {
  const fallback = useSettings();
  const profile = props.profile ?? fallback.profile;
  const places = props.places ?? fallback.places;
  const saveName = props.saveName ?? fallback.saveName;
  const updatePlace = props.updatePlace ?? fallback.updatePlace;
  const resolvePlaceAddress = props.resolvePlaceAddress ?? fallback.resolvePlaceAddress;

  return (
    <div style={{ ...shell, fontFamily: FONT.body }}>
      <div style={{ fontSize: 10, ...labelStyle }}>Seaded</div>
      <div style={{ fontFamily: FONT.display, fontSize: 24, fontWeight: 600, color: AV.text, marginBottom: 6 }}>
        Sinu eelistused
      </div>
      <div style={{ fontSize: 13, color: AV.muted, lineHeight: 1.5, marginBottom: 22 }}>Lihtsad valikud, mida saad igal ajal muuta.</div>
      <ProfileSection profile={profile} saveName={saveName} />
      <PlacesSection places={places} updatePlace={updatePlace} resolvePlaceAddress={resolvePlaceAddress} />
      <PinSection />
      <div style={{ height: 20 }} />
    </div>
  );
}
