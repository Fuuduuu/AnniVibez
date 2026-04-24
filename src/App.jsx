import { useEffect, useState } from 'react';
import { AV, FONT, GRAD, card, labelStyle, shell } from './design/tokens';
import { BussCard } from './components/BussCard';
import { BussTab } from './components/BussTab';
import LooTab from './components/LooTab';
import { PaeviikTab } from './components/PaeviikTab';
import { TugiTab } from './components/TugiTab';
import { SeadedTab } from './components/SeadedTab';
import { useSettings } from './hooks/useSettings';
import { useSavedPlaces } from './hooks/useSavedPlaces';

const TABS = [
  { id: 'kodu', icon: '🏡', label: 'Kodu' },
  { id: 'buss', icon: '🚌', label: 'Buss' },
  { id: 'loo', icon: '✨', label: 'Loo' },
  { id: 'paevik', icon: '📖', label: 'Päevik' },
  { id: 'tugi', icon: '🌿', label: 'Tugi' },
  { id: 'seaded', icon: '⚙️', label: 'Seaded' },
];

const QUOTES = [
  'Üks väike algus loeb alati. ✨',
  'Kui miski ei õnnestu, proovi oma moodi. 🌸',
  'Sa ei pea olema täiuslik, et luua midagi ilusat. 🌿',
  'Iga pilt räägib sinu lugu. ☀️',
  'Rahulikult tehes tuleb tihti kõige ägedam tulemus. 💜',
];

function BottomNav({ active, setActive }) {
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 'calc(68px + env(safe-area-inset-bottom, 0px))',
        background: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: `1px solid ${AV.border}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px env(safe-area-inset-bottom, 0px)',
        boxShadow: '0 -4px 24px rgba(100,50,180,0.07)',
        zIndex: 100,
      }}
    >
      {TABS.map(t => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              padding: '8px 4px',
              borderRadius: 16,
              border: 'none',
              cursor: 'pointer',
              background: on ? AV.purpleL : 'none',
              transition: 'all .18s',
            }}
          >
            <span style={{ fontSize: on ? 22 : 19, transition: 'font-size .15s' }}>{t.icon}</span>
            <span style={{ fontSize: 10, fontWeight: on ? 600 : 400, color: on ? AV.purple : AV.muted, transition: 'color .15s' }}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function KoduTab({ name, savedPlaces, onNavTo }) {
  const [quoteIdx, setQuoteIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setQuoteIdx(i => (i + 1) % QUOTES.length), 9000);
    return () => clearInterval(t);
  }, []);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Tere hommikust' : hour < 17 ? 'Tere päevast' : 'Tere õhtust';
  const displayName = name?.trim() || 'Anni';

  return (
    <div style={{ ...shell, animation: 'av-in .35s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 26 }}>
        <div>
          <div
            style={{
              fontFamily: FONT.display,
              fontSize: 31,
              fontWeight: 600,
              letterSpacing: '-.01em',
              background: GRAD.wordmark,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              lineHeight: 1,
              marginBottom: 4,
            }}
          >
            AnniVibe
          </div>
          <div style={{ fontSize: 14, color: AV.muted, lineHeight: 1.5 }}>
            {greet}, {displayName} 🌸
          </div>
        </div>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            background: GRAD.hero,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            boxShadow: AV.shadowSm,
          }}
        >
          ✨
        </div>
      </div>

      <div style={{ ...card, background: GRAD.header, border: `1px solid ${AV.purpleM}`, boxShadow: 'none', marginBottom: 20 }}>
        <div style={{ fontSize: 10, ...labelStyle, color: AV.purple, marginBottom: 5 }}>Täna sulle</div>
        <div style={{ fontSize: 16, fontFamily: FONT.display, fontStyle: 'italic', color: AV.textSoft, lineHeight: 1.55 }}>{QUOTES[quoteIdx]}</div>
      </div>

      <div style={{ fontSize: 10, ...labelStyle, marginBottom: 8 }}>Buss praegu</div>
      <BussCard savedPlaces={savedPlaces} onOpenBuss={() => onNavTo('buss')} />

      <div style={{ fontSize: 10, ...labelStyle, marginBottom: 8 }}>Loo täna</div>
      <button
        onClick={() => onNavTo('loo')}
        style={{
          width: '100%',
          padding: '22px 20px',
          marginBottom: 16,
          background: GRAD.hero,
          border: `1px solid ${AV.purpleM}40`,
          borderRadius: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          cursor: 'pointer',
          textAlign: 'left',
          boxShadow: AV.shadowSm,
          transition: 'transform .15s,box-shadow .15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'scale(1.015)';
          e.currentTarget.style.boxShadow = AV.shadow;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = '';
          e.currentTarget.style.boxShadow = AV.shadowSm;
        }}
      >
        <span style={{ fontSize: 36, flexShrink: 0 }}>🎁</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: AV.text, marginBottom: 3 }}>Mis loome täna?</div>
          <div style={{ fontSize: 13, color: AV.textSoft, lineHeight: 1.5 }}>Üllata, joonista või meisterda</div>
        </div>
        <span style={{ fontSize: 18, color: AV.muted }}>→</span>
      </button>
    </div>
  );
}

export default function AnniVibeApp() {
  const [tab, setTab] = useState('kodu');
  const { profile, saveName } = useSettings();
  const { places, update: updatePlace } = useSavedPlaces();

  return (
    <div
      style={{
        fontFamily: FONT.body,
        background: `linear-gradient(180deg, ${AV.bg} 0%, ${AV.bgWarm} 100%)`,
        minHeight: '100vh',
        paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div key={tab} style={{ animation: 'av-in .25s ease-out', paddingBottom: tab === 'tugi' ? 0 : 20 }}>
        {tab === 'kodu' && <KoduTab name={profile.name} savedPlaces={places} onNavTo={setTab} />}
        {tab === 'buss' && <BussTab savedPlaces={places} />}
        {tab === 'loo' && <LooTab />}
        {tab === 'paevik' && <PaeviikTab />}
        {tab === 'tugi' && <TugiTab />}
        {tab === 'seaded' && <SeadedTab profile={profile} saveName={saveName} places={places} updatePlace={updatePlace} />}
      </div>

      <BottomNav active={tab} setActive={setTab} />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,600;0,700;1,400&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes av-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes av-pulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
        @keyframes av-bounce { 0%,100% { transform: scale(1) } 50% { transform: scale(1.15) } }
        button:focus-visible { outline: 2px solid ${AV.purple}; outline-offset: 2px; }
        textarea,input,select { transition: border-color .15s; }
        textarea:focus,input:focus,select:focus { border-color: ${AV.purple} !important; outline: none; }
      `}</style>
    </div>
  );
}
