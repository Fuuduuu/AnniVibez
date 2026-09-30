export const AV = {
  page:        '#EDF1F6',
  bg:          '#F5F7FA',
  bgWarm:      '#F3F6FA',
  bgSoft:      '#E3E9F0',
  card:        '#FFFFFF',
  primary:     '#FFD23F',
  primaryStrong: '#FFC300',
  primaryTint: '#FFF3C4',
  primaryOn:   '#2A2000',
  primaryInk:  '#7A5800',
  borderStrong: 'rgba(20,40,70,.24)',
  bus:         '#3B6FB0',
  warning:     '#C0600C',

  // Compatibility names let existing feature views adopt the palette without logic edits.
  purple:      '#7A5800',
  purpleL:     '#FFF3C4',
  purpleM:     '#FFD23F',
  rose:        '#394656',
  roseL:       '#F3F6FA',
  peach:       '#C0600C',
  peachL:      '#FFE6CF',
  sage:        '#3B6FB0',
  sageL:       '#DEE8F5',

  text:        '#15202E',
  textSoft:    '#394656',
  muted:       '#566273',
  border:      'rgba(20,40,70,.14)',
  danger:      '#CF3F35',
  dangerTint:  '#FFDCD8',
  warningTint: '#FFE6CF',

  shadow:      'inset 0 1px 0 #FFFFFF, inset 0 -2px 0 rgba(20,40,70,.05), 0 1px 0 rgba(20,40,70,.10), 0 3px 6px -2px rgba(20,40,70,.10), 0 14px 30px -16px rgba(20,40,70,.36)',
  shadowSm:    'inset 0 1px 0 #FFFFFF, inset 0 -1px 0 rgba(20,40,70,.04), 0 1px 2px rgba(20,40,70,.06), 0 6px 14px -10px rgba(20,40,70,.18)',
  shadowMd:    'inset 0 1px 0 #FFFFFF, inset 0 -2px 0 rgba(20,40,70,.05), 0 2px 0 rgba(20,40,70,.10), 0 8px 14px -6px rgba(20,40,70,.14), 0 24px 40px -18px rgba(20,40,70,.42)',
  shadowLg:    '0 12px 40px rgba(20,40,70,.18)',

  r:    12,
  rSm:  10,
  navH: 68,
};

// Presentation colors from the current reference; calendar classification stays in eventModel.
export const CALENDAR_COLORS = {
  waste:       { color: '#2A76CF', tint: '#DCEBFF' },
  maintenance: { color: '#C8680F', tint: '#FFE6CF' },
  payment:     { color: '#CC3F74', tint: '#FFDDE8' },
  general:     { color: '#6B4CD8', tint: '#E7E0FF' },
};

export const WASTE_SUBTYPE_COLORS = {
  mixed:     { color: '#5E6573', tint: '#E7E8EC' },
  bio:       { color: '#3A8F2B', tint: '#DFF3D8' },
  paper:     { color: '#2A76CF', tint: '#DCEBFF' },
  packaging: { color: '#9A7800', tint: '#FFF3C4' },
  other:     { color: '#C8680F', tint: '#FFE6CF' },
};

export function calendarEventColors({ category, subtype }) {
  return (category === 'waste' && WASTE_SUBTYPE_COLORS[subtype]) || CALENDAR_COLORS[category];
}

export const GRAD = {
  wordmark: `linear-gradient(130deg, ${AV.primary}, ${AV.primaryStrong})`,
  header:   `linear-gradient(135deg, ${AV.primaryTint}, ${AV.bgWarm})`,
  hero:     `linear-gradient(150deg, ${AV.primaryTint} 0%, ${AV.bgWarm} 100%)`,
};

export const FONT = {
  display: "'Avenir Next', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  body:    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

export const card = {
  background:   'linear-gradient(180deg, #FFFFFF 0%, #F6F8FB 100%)',
  borderRadius: AV.r,
  border:       `1px solid ${AV.border}`,
  boxShadow:    AV.shadowSm,
  padding:      '16px',
  marginBottom: 10,
};

export const labelStyle = {
  fontSize: '.71875rem', letterSpacing: '.09em', fontWeight: 600,
  textTransform: 'uppercase', color: AV.textSoft,
  marginBottom: 7, display: 'block',
};

export const inp = {
  width: '100%', padding: '10px 13px', borderRadius: AV.rSm,
  border: `1px solid ${AV.border}`, fontSize: '1rem',
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
