export const AV = {
  bg:          'hsl(32, 22%, 97%)',
  bgWarm:      'hsl(28, 28%, 96%)',
  bgSoft:      'hsl(290, 18%, 96%)',
  card:        '#ffffff',

  purple:      'hsl(267, 46%, 60%)',
  purpleL:     'hsl(267, 55%, 95%)',
  purpleM:     'hsl(267, 46%, 88%)',
  rose:        'hsl(338, 55%, 68%)',
  roseL:       'hsl(338, 60%, 95%)',
  peach:       'hsl(22, 70%, 72%)',
  peachL:      'hsl(22, 80%, 95%)',
  sage:        'hsl(147, 32%, 50%)',
  sageL:       'hsl(147, 40%, 93%)',

  text:        'hsl(260, 20%, 17%)',
  textSoft:    'hsl(260, 12%, 38%)',
  muted:       'hsl(260, 8%, 60%)',
  border:      'hsl(270, 16%, 90%)',
  danger:      'hsl(0, 70%, 55%)',

  shadow:      '0 4px 28px rgba(100,50,180,0.09)',
  shadowSm:    '0 2px 12px rgba(100,50,180,0.07)',
  shadowLg:    '0 12px 40px rgba(92,56,157,0.18)',

  r:    20,
  rSm:  12,
  navH: 68,
};

export const GRAD = {
  wordmark: `linear-gradient(130deg, ${AV.purple}, ${AV.rose})`,
  header:   `linear-gradient(135deg, ${AV.purpleL}, ${AV.roseL})`,
  hero:     `linear-gradient(150deg, ${AV.purpleL} 0%, ${AV.peachL} 100%)`,
};

export const FONT = {
  display: "'Fraunces', Georgia, serif",
  body:    "-apple-system, 'Segoe UI', sans-serif",
};

export const card = {
  background:   AV.card,
  borderRadius: AV.r,
  border:       `1px solid ${AV.border}`,
  boxShadow:    AV.shadowSm,
  padding:      '16px 18px',
  marginBottom: 10,
};

export const labelStyle = {
  fontSize: 11, letterSpacing: '.09em', fontWeight: 600,
  textTransform: 'uppercase', color: AV.muted,
  marginBottom: 7, display: 'block',
};

export const inp = {
  width: '100%', padding: '10px 13px', borderRadius: AV.rSm,
  border: `1px solid ${AV.border}`, fontSize: 14,
  background: AV.bg, color: AV.text, outline: 'none',
  fontFamily: 'inherit', resize: 'vertical',
};

export const shell = {
  maxWidth: 520,
  margin: '0 auto',
  padding: '24px 18px 0',
};

export const shellNarrow = {
  maxWidth: 360,
  margin: '0 auto',
  padding: '24px 18px 0',
};
