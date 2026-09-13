export const AV = {
  bg:          '#F4F2EE',
  bgWarm:      '#FAF8F4',
  bgSoft:      '#EDEAE4',
  card:        '#FFFFFF',
  primary:     '#1A5B69',
  primaryStrong: '#123F49',
  primaryTint: '#E4EEF0',
  borderStrong: '#CFCAC0',
  bus:         '#2F5D4B',
  warning:     '#A9701C',

  // Compatibility names let existing feature views adopt the palette without logic edits.
  purple:      '#1A5B69',
  purpleL:     '#E4EEF0',
  purpleM:     '#CFCAC0',
  rose:        '#4B5358',
  roseL:       '#FAF8F4',
  peach:       '#A9701C',
  peachL:      '#F8EEDD',
  sage:        '#2F5D4B',
  sageL:       '#E5EEE9',

  text:        '#1B1F21',
  textSoft:    '#4B5358',
  muted:       '#6D757A',
  border:      '#E2DFD8',
  danger:      '#9E3B2F',

  shadow:      '0 1px 2px rgba(27,31,33,.05), 0 8px 20px -12px rgba(27,31,33,.18)',
  shadowSm:    '0 1px 2px rgba(27,31,33,.05)',
  shadowLg:    '0 12px 40px rgba(27,31,33,.18)',

  r:    12,
  rSm:  10,
  navH: 68,
};

export const GRAD = {
  wordmark: `linear-gradient(130deg, ${AV.primary}, ${AV.primaryStrong})`,
  header:   `linear-gradient(135deg, ${AV.primaryTint}, ${AV.bgWarm})`,
  hero:     `linear-gradient(150deg, ${AV.primaryTint} 0%, ${AV.bgWarm} 100%)`,
};

export const FONT = {
  display: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  body:    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
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
  fontSize: 11.5, letterSpacing: '.09em', fontWeight: 600,
  textTransform: 'uppercase', color: AV.textSoft,
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
  padding: '24px 16px 0',
};

export const shellNarrow = {
  maxWidth: 360,
  margin: '0 auto',
  padding: '24px 18px 0',
};
