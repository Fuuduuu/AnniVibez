import { useState } from 'react';
import { useDiary, todayStr } from '../hooks/useDiary';
import { AV, FONT, card, labelStyle, inp, shell, shellNarrow } from '../design/tokens';

const MOODS = ['😄','😊','😐','😔','😢','😤','🥲','🤩','😴','🥰'];

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const today = todayStr();
  if (dateStr === today) return 'Täna';
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (dateStr === yest.toISOString().slice(0,10)) return 'Eile';
  return d.toLocaleDateString('et-EE', { day: 'numeric', month: 'long' });
}

function PinDots({ value, error }) {
  return (
    <div style={{ display:'flex', justifyContent:'center', gap:10, marginBottom:12 }}>
      {Array.from({ length: Math.max(4, value.length) }).map((_, i) => (
        <div key={i} style={{
          width:12, height:12, borderRadius:'50%',
          background: error ? AV.danger : i < value.length ? AV.purple : AV.border,
          transition: 'background .15s',
        }} />
      ))}
    </div>
  );
}

function PinSetup({ onDone }) {
  const [pin, setPin]     = useState('');
  const [conf, setConf]   = useState('');
  const [step, setStep]   = useState(1);
  const [err,  setErr]    = useState('');

  function next() {
    if (step === 1) {
      if (pin.length < 4) { setErr('PIN peab olema vähemalt 4 numbrit'); return; }
      if (!/^\d+$/.test(pin)) { setErr('PIN-is võivad olla ainult numbrid'); return; }
      setErr(''); setStep(2);
    } else {
      if (conf !== pin) { setErr('PIN-id ei lähe kokku'); setConf(''); return; }
      onDone(pin);
    }
  }

  return (
    <div style={{ ...shellNarrow }}>
      <div style={{ textAlign:'center', marginBottom:28 }}>
        <div style={{ fontSize:48, marginBottom:12 }}>🔒</div>
        <div style={{ fontFamily:FONT.display, fontSize:22, fontWeight:600, color:AV.text, marginBottom:6 }}>
          {step === 1 ? 'Pane päevikule PIN' : 'Korda PIN-i'}
        </div>
        <p style={{ fontSize:14, color:AV.muted }}>
          {step === 1 ? 'Vali vähemalt 4 numbrit, mida ainult sina tead.' : 'Kirjuta sama PIN uuesti.'}
        </p>
      </div>
      <div style={{ ...card, textAlign:'center', background: AV.bgWarm }}>
        <PinDots value={step === 1 ? pin : conf} error={!!err} />
        <input
          type="password" inputMode="numeric" maxLength={8} autoFocus
          value={step === 1 ? pin : conf}
          onChange={e => { step === 1 ? setPin(e.target.value.replace(/\D/g,'')) : setConf(e.target.value.replace(/\D/g,'')); setErr(''); }}
          onKeyDown={e => e.key === 'Enter' && next()}
          placeholder="• • • •"
          style={{ ...inp, textAlign:'center', letterSpacing:8, fontSize:22, marginBottom:8 }}
        />
        {err && <div style={{ fontSize:13, color:AV.danger, marginBottom:6 }}>{err}</div>}
        <button onClick={next} style={{
          width:'100%', padding:'13px 0', borderRadius:14, border:'none',
          background:AV.purple, color:'#fff', fontSize:15, fontWeight:600, cursor:'pointer',
        }}>
          {step === 1 ? 'Edasi →' : 'Valmis ✨'}
        </button>
      </div>
      {step === 2 && (
        <button onClick={() => { setStep(1); setConf(''); setErr(''); }} style={{
          width:'100%', marginTop:8, padding:'10px 0', borderRadius:12,
          border:'none', background:'none', fontSize:13, color:AV.muted, cursor:'pointer',
        }}>← Muuda PIN-i</button>
      )}
    </div>
  );
}

function PinUnlock({ onUnlock, error, onForgot }) {
  const [pin, setPin] = useState('');
  return (
    <div style={{ ...shellNarrow }}>
      <div style={{ textAlign:'center', marginBottom:28 }}>
        <div style={{ fontSize:48, marginBottom:12 }}>🔐</div>
        <div style={{ fontFamily:FONT.display, fontSize:22, fontWeight:600, color:AV.text, marginBottom:6 }}>Sinu salapäevik</div>
        <p style={{ fontSize:14, color:AV.muted }}>Sisesta PIN ja päevik avaneb.</p>
      </div>
      <div style={{ ...card, textAlign:'center', background: AV.bgWarm }}>
        <PinDots value={pin} error={error} />
        <input
          type="password" inputMode="numeric" maxLength={8} autoFocus
          value={pin}
          onChange={e => { setPin(e.target.value.replace(/\D/g,'')); }}
          onKeyDown={e => e.key === 'Enter' && onUnlock(pin)}
          placeholder="• • • •"
          style={{ ...inp, textAlign:'center', letterSpacing:8, fontSize:22, borderColor: error ? AV.danger : AV.border, marginBottom:8 }}
        />
        {error && <div style={{ fontSize:13, color:AV.danger, marginBottom:6 }}>See PIN ei klapi. Proovi uuesti.</div>}
        <button onClick={() => onUnlock(pin)} disabled={pin.length < 4} style={{
          width:'100%', padding:'13px 0', borderRadius:14, border:'none',
          background: pin.length >= 4 ? AV.purple : AV.border,
          color:'#fff', fontSize:15, fontWeight:600,
          cursor: pin.length >= 4 ? 'pointer' : 'default',
        }}>Ava →</button>
      </div>
      <button onClick={onForgot} style={{
        width:'100%', marginTop:8, padding:'10px 0',
        border:'none', background:'none', fontSize:13, color:AV.muted, cursor:'pointer',
      }}>Unustasin PIN-i</button>
    </div>
  );
}

function ForgotPin({ onReset, onCancel }) {
  return (
    <div style={{ ...shellNarrow, textAlign:'center' }}>
      <div style={{ fontSize:40, marginBottom:12 }}>⚠️</div>
      <div style={{ fontFamily:FONT.display, fontSize:18, fontWeight:600, color:AV.text, marginBottom:8 }}>Kas kustutame päeviku?</div>
      <p style={{ fontSize:14, color:AV.muted, lineHeight:1.6, marginBottom:20 }}>
        PIN-i lähtestamine kustutab kõik päeviku kirjed jäädavalt. Seda sammu ei saa tagasi võtta.
      </p>
      <button onClick={onReset} style={{
        width:'100%', padding:'13px 0', borderRadius:14, border:'none',
        background:AV.danger, color:'#fff', fontSize:15, fontWeight:600, cursor:'pointer', marginBottom:10,
      }}>Kustuta kõik ja alusta uuesti</button>
      <button onClick={onCancel} style={{
        width:'100%', padding:'11px 0', borderRadius:12,
        border:'none', background:'none', fontSize:14, color:AV.muted, cursor:'pointer',
      }}>← Tagasi</button>
    </div>
  );
}

function StreakBanner({ streak }) {
  if (!streak.warning) return null;
  return (
    <div style={{
      background:AV.peachL, border:`1px solid ${AV.peach}40`,
      borderRadius:14, padding:'12px 16px', marginBottom:14,
      display:'flex', alignItems:'center', gap:12,
    }}>
      <span style={{ fontSize:24 }}>🌿</span>
        <div>
          <div style={{ fontSize:14, fontWeight:600, color:AV.textSoft }}>Viimasest kirjest on {streak.days} päeva</div>
          <div style={{ fontSize:12, color:AV.muted, marginTop:2 }}>Üks väike rida on juba super.</div>
        </div>
      </div>
  );
}

function EntryForm({ onSave, onCancel }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ emoji:'😊', title:'', good:'', hard:'', free:'' });
  const up = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canSave = form.good || form.hard || form.free;

  return (
    <div style={{ animation:'av-in .2s' }}>
      <button onClick={onCancel} style={{ background:'none', border:'none', fontSize:14, color:AV.muted, cursor:'pointer', marginBottom:16 }}>← Päevik</button>
      <div style={{ fontSize:10, ...labelStyle }}>Uus sissekanne</div>
      <div style={{ fontFamily:FONT.display, fontSize:22, fontWeight:600, color:AV.text, marginBottom:20 }}>
        {step === 0 ? 'Kuidas sul täna läks?' : 'Kirjuta nii palju kui tahad'}
      </div>

      {step === 0 && (
        <>
          <div style={{ ...card }}>
            <div style={{ fontSize:13, color:AV.muted, marginBottom:12 }}>Vali tänane tunne</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {MOODS.map(e => (
                <button key={e} onClick={() => up('emoji', e)} style={{
                  fontSize:28, padding:'8px 10px', borderRadius:14, border:'none',
                  background: form.emoji === e ? AV.purpleL : 'transparent', cursor:'pointer',
                  outline: form.emoji === e ? `2px solid ${AV.purple}` : 'none',
                }}>{e}</button>
              ))}
            </div>
          </div>
          <div style={{ ...card }}>
            <input placeholder="Pealkiri (soovi korral)" value={form.title}
              onChange={e => up('title', e.target.value)} style={inp} />
          </div>
          <button onClick={() => setStep(1)} style={{
            width:'100%', padding:'14px 0', borderRadius:16, border:'none',
            background:AV.purple, color:'#fff', fontSize:15, fontWeight:600, cursor:'pointer',
          }}>Edasi →</button>
        </>
      )}

      {step === 1 && (
        <>
          {[
            ['good', 'Mis tegi tuju heaks? 🌟',   'Kas või üks väike asi…',          'hsl(55,80%,95%)'],
            ['hard', 'Mis oli täna keeruline? 🌧️', 'Võid ka tühjaks jätta…',         'hsl(220,60%,96%)'],
            ['free', 'Vaba mõte ✨',               'See on sinu privaatne koht.',      AV.purpleL],
          ].map(([k, lbl, ph, bg]) => (
            <div key={k} style={{ ...card, background:bg, boxShadow:'none' }}>
              <div style={{ fontSize:12, color:AV.muted, marginBottom:6 }}>{lbl}</div>
              <textarea value={form[k]} onChange={e => up(k, e.target.value)}
                placeholder={ph} rows={k === 'free' ? 4 : 2} style={inp} />
            </div>
          ))}
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => setStep(0)} style={{
              flex:1, padding:'13px 0', borderRadius:14,
              border:`1px solid ${AV.border}`, background:AV.card,
              fontSize:14, color:AV.muted, cursor:'pointer',
            }}>← Tagasi</button>
            <button onClick={() => canSave && onSave(form)} disabled={!canSave} style={{
              flex:2, padding:'13px 0', borderRadius:14, border:'none',
              background: canSave ? AV.sage : AV.border,
              color:'#fff', fontSize:14, fontWeight:600, cursor: canSave ? 'pointer' : 'default',
            }}>Salvesta ✓</button>
          </div>
        </>
      )}
    </div>
  );
}

function EntryList({ entries, streak, hasTodayEntry, onNew, onOpen, onLock }) {
  return (
    <>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <div style={{ fontSize:10, ...labelStyle }}>Salapäevik</div>
          <div style={{ fontFamily:FONT.display, fontSize:24, fontWeight:600, color:AV.text }}>Minu salapäevik</div>
          <div style={{ fontSize:13, color:AV.muted, lineHeight:1.45, marginTop:3 }}>Sinu vaikne koht mõtete jaoks.</div>
        </div>
        <button onClick={onLock} style={{
          background:'none', border:`1px solid ${AV.border}`, borderRadius:20,
          padding:'6px 14px', fontSize:12, color:AV.muted, cursor:'pointer',
        }}>Lukusta 🔒</button>
      </div>

      <StreakBanner streak={streak} />

      {!hasTodayEntry ? (
        <button onClick={onNew} style={{
          width:'100%', padding:'18px 0', borderRadius:16,
          background: `linear-gradient(145deg, ${AV.purpleL}, ${AV.roseL})`,
          border:`1.5px solid ${AV.purpleM}40`,
          fontSize:16, fontWeight:600, color:AV.purple, cursor:'pointer',
          marginBottom:16, boxShadow:AV.shadowSm,
        }}>✏️ Kirjuta tänane rida</button>
      ) : (
        <div style={{ ...card, background:AV.sageL, borderColor:`${AV.sage}40`, textAlign:'center', marginBottom:16, boxShadow:'none' }}>
          <div style={{ fontSize:14, color:AV.sage, fontWeight:500 }}>✓ Tänane kirje on tehtud</div>
          <button onClick={onNew} style={{
            marginTop:8, padding:'6px 14px', borderRadius:20,
            border:`1px solid ${AV.sage}40`, background:'none',
            fontSize:13, color:AV.sage, cursor:'pointer',
          }}>Lisa teine kirje</button>
        </div>
      )}

      {entries.length === 0 ? (
        <div style={{ textAlign:'center', padding:'48px 0', color:AV.muted }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📖</div>
          <div style={{ fontSize:15 }}>Esimene kirje ootab sind.</div>
        </div>
      ) : (
        entries.map(entry => (
          <button key={entry.id} onClick={() => onOpen(entry)} style={{
            ...card, cursor:'pointer', textAlign:'left', width:'100%',
            display:'flex', alignItems:'center', gap:14,
            transition:'box-shadow .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.boxShadow = AV.shadow}
          onMouseLeave={e => e.currentTarget.style.boxShadow = AV.shadowSm}>
            <span style={{ fontSize:28, flexShrink:0 }}>{entry.emoji}</span>
            <div style={{ flex:1, overflow:'hidden' }}>
              <div style={{ fontSize:15, fontWeight:600, color:AV.text, marginBottom:2 }}>
                {entry.title || fmtDate(entry.date)}
              </div>
              <div style={{ fontSize:12, color:AV.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {entry.title ? fmtDate(entry.date) + ' · ' : ''}{entry.good || entry.free || entry.hard || '…'}
              </div>
            </div>
            <span style={{ color:AV.muted, flexShrink:0 }}>→</span>
          </button>
        ))
      )}
    </>
  );
}

function EntryDetail({ entry, onBack, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fields = [
    { key:'good', label:'Mis tegi tuju heaks',  emoji:'🌟', bg:'hsl(55,80%,95%)' },
    { key:'hard', label:'Mis oli keeruline',    emoji:'🌧️', bg:'hsl(220,60%,96%)' },
    { key:'free', label:'Vaba mõte',            emoji:'✨', bg:AV.purpleL         },
  ].filter(f => entry[f.key]);

  return (
    <div style={{ animation:'av-in .2s' }}>
      <button onClick={onBack} style={{ background:'none', border:'none', fontSize:14, color:AV.muted, cursor:'pointer', marginBottom:16 }}>← Päevik</button>

      <div style={{ ...card, background:`linear-gradient(135deg, ${AV.purpleL}, ${AV.roseL})`, border:`1px solid ${AV.purpleM}`, textAlign:'center', marginBottom:12, boxShadow:'none' }}>
        <div style={{ fontSize:48, marginBottom:8 }}>{entry.emoji}</div>
        <div style={{ fontFamily:FONT.display, fontSize:20, fontWeight:600, color:AV.text }}>
          {entry.title || fmtDate(entry.date)}
        </div>
        {entry.title && <div style={{ fontSize:13, color:AV.muted, marginTop:4 }}>{fmtDate(entry.date)}</div>}
      </div>

      {fields.map(f => (
        <div key={f.key} style={{ ...card, background:f.bg, boxShadow:'none' }}>
          <div style={{ fontSize:10, ...labelStyle, display:'flex', alignItems:'center', gap:5, marginBottom:6 }}>
            <span style={{ fontSize:14 }}>{f.emoji}</span>{f.label}
          </div>
          <p style={{ fontSize:15, color:AV.text, margin:0, lineHeight:1.6, whiteSpace:'pre-wrap' }}>{entry[f.key]}</p>
        </div>
      ))}

      {!confirmDelete ? (
        <button onClick={() => setConfirmDelete(true)} style={{
          width:'100%', marginTop:8, padding:'11px 0', borderRadius:12,
          border:`1px solid ${AV.border}`, background:'none',
          fontSize:13, color:AV.muted, cursor:'pointer',
        }}>Kustuta see kirje</button>
      ) : (
        <div style={{ ...card, borderColor:'#fca5a5', background:'#fff5f5', marginTop:8 }}>
          <p style={{ fontSize:14, color:AV.danger, margin:'0 0 12px' }}>Kas kustutame selle kirje jäädavalt?</p>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => setConfirmDelete(false)} style={{ flex:1, padding:'10px 0', borderRadius:12, border:`1px solid ${AV.border}`, background:AV.card, fontSize:13, color:AV.muted, cursor:'pointer' }}>Ei veel</button>
            <button onClick={() => { onDelete(entry.id); onBack(); }} style={{ flex:1, padding:'10px 0', borderRadius:12, border:'none', background:AV.danger, color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer' }}>Jah, kustuta</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PaeviikTab() {
  const diary = useDiary();
  const [view, setView]       = useState('lock');
  const [openEntry, setOpenEntry] = useState(null);

  const screen = (() => {
    if (!diary.pinSet) return 'setup';
    if (!diary.unlocked) return view === 'forgot' ? 'forgot' : 'lock';
    return view;
  })();

  return (
    <div style={{ ...shell, fontFamily:FONT.body }}>
      {screen === 'setup'  && <PinSetup onDone={pin => { diary.setupPin(pin); setView('list'); }} />}
      {screen === 'lock'   && <PinUnlock onUnlock={pin => { if(diary.tryUnlock(pin)) setView('list'); }} error={diary.pinError} onForgot={() => setView('forgot')} />}
      {screen === 'forgot' && <ForgotPin onReset={() => { diary.resetPin(); setView('lock'); }} onCancel={() => setView('lock')} />}
      {screen === 'list'   && (
        <EntryList
          entries={diary.entries} streak={diary.streak} hasTodayEntry={diary.hasTodayEntry}
          onNew={() => setView('new')}
          onOpen={e => { setOpenEntry(e); setView('detail'); }}
          onLock={() => { diary.lock(); setView('lock'); }}
        />
      )}
      {screen === 'new' && (
        <EntryForm
          onSave={form => { diary.addEntry(form); setView('list'); }}
          onCancel={() => setView('list')}
        />
      )}
      {screen === 'detail' && openEntry && (
        <EntryDetail
          entry={openEntry}
          onBack={() => { setOpenEntry(null); setView('list'); }}
          onDelete={id => { diary.deleteEntry(id); setOpenEntry(null); setView('list'); }}
        />
      )}
    </div>
  );
}
