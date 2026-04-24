import { useState, useEffect } from 'react';
import { AV, FONT, labelStyle } from '../design/tokens';

const TEXTS = [
  'Sa oled praegu turvalises kohas.',
  'Hinga aeglaselt. Kõik ei pea kohe valmis saama.',
  'Üks sisse-välja hingamine korraga.',
  'Sa võid teha pausi ja alustada uuesti.',
  'Sa ei ole oma mõtetega üksi.',
];

const PHASES = [
  { label: 'Sisse',        duration: 4000, scale: 1.28 },
  { label: 'Hoia',         duration: 2000, scale: 1.28 },
  { label: 'Välja',        duration: 6000, scale: 1.0  },
  { label: 'Paus',         duration: 2000, scale: 1.0  },
];

export function TugiTab() {
  const [phase,   setPhase]   = useState(0);
  const [running, setRunning] = useState(false);
  const [textIdx, setTextIdx] = useState(0);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setPhase(p => (p + 1) % PHASES.length), PHASES[phase].duration);
    return () => clearTimeout(t);
  }, [phase, running]);

  useEffect(() => {
    const t = setInterval(() => setTextIdx(i => (i + 1) % TEXTS.length), 8000);
    return () => clearInterval(t);
  }, []);

  const cur = PHASES[phase];

  return (
    <div style={{
      minHeight: 'calc(100vh - 130px)',
      background: `radial-gradient(circle at 50% 8%, ${AV.purpleL} 0%, ${AV.bg} 55%)`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 18px 0',
      fontFamily: FONT.body,
      gap: 22,
    }}>
      <div style={{ fontSize: 10, ...labelStyle, marginBottom: 0 }}>Tugi</div>
      <div
        onClick={() => setRunning(r => !r)}
        style={{
          width: 184, height: 184, borderRadius: '50%',
          background: AV.purpleL,
          border: `2px solid ${AV.purpleM}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', cursor: 'pointer',
          transform: `scale(${running ? cur.scale : 1})`,
          transition: `transform ${running ? cur.duration : 300}ms ease-in-out`,
          userSelect: 'none', gap: 6,
          boxShadow: running ? AV.shadowLg : AV.shadowSm,
        }}
      >
        <span style={{ fontSize: 38 }}>🌿</span>
        <span style={{
          fontSize: 14, fontWeight: 500, color: AV.purple,
          opacity: running ? 1 : 0.7, transition: 'opacity .3s',
        }}>
          {running ? cur.label : 'Alusta'}
        </span>
      </div>

      <p style={{
        fontSize: 16, color: AV.textSoft, textAlign: 'center',
        lineHeight: 1.7, maxWidth: 300, margin: 0,
        fontFamily: FONT.display, fontStyle: 'italic',
      }}>
        {TEXTS[textIdx]}
      </p>

      {running && (
        <button
          onClick={() => { setRunning(false); setPhase(0); }}
          style={{
            padding: '10px 28px', borderRadius: 24,
            border: `1px solid ${AV.border}`, background: 'transparent',
            fontSize: 14, color: AV.muted, cursor: 'pointer',
          }}
        >
          Lõpeta
        </button>
      )}
    </div>
  );
}
