import { CATEGORIES, categoryInk, categoryPresentation, isCustomCategory } from '../calendar/categoryModel.js';

export const AV = {
  page:        '#F4F5F2',
  bg:          '#F4F5F2',
  bgWarm:      '#EFF1ED',
  bgSoft:      '#E3E9F0',
  card:        '#F4F5F2',
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
  roseL:       '#EFF1ED',
  peach:       '#C0600C',
  peachL:      '#FFE6CF',
  sage:        '#3B6FB0',
  sageL:       '#DEE8F5',

  text:        '#15202E',
  textSoft:    '#394656',
  muted:       '#566273',
  border:      'rgba(32,48,58,.08)',
  danger:      '#CF3F35',
  dangerTint:  '#FFDCD8',
  warningTint: '#FFE6CF',

  shadow:      'inset 0 1px 0 rgba(255,255,255,.65), 6px 6px 18px rgba(32,48,58,.065), -6px -6px 18px rgba(255,255,255,.8)',
  shadowSm:    'inset 0 1px 0 rgba(255,255,255,.6), 3px 3px 10px rgba(32,48,58,.055), -3px -3px 10px rgba(255,255,255,.75)',
  shadowMd:    'inset 0 1px 0 rgba(255,255,255,.7), 8px 8px 24px rgba(32,48,58,.075), -8px -8px 24px rgba(255,255,255,.85)',
  shadowLg:    '0 12px 36px rgba(32,48,58,.14)',

  r:    22,
  rSm:  14,
  navH: 68,
};

// Presentation colors from the current reference; calendar classification stays in eventModel.
export const CALENDAR_COLORS = Object.fromEntries(Object.entries(CATEGORIES)
  .map(([id, { color, tint }]) => [id, { color, tint }]));

export const WASTE_SUBTYPE_COLORS = {
  mixed:     { color: '#5E6573', tint: '#E7E8EC' },
  bio:       { color: '#3A8F2B', tint: '#DFF3D8' },
  paper:     { color: '#2A76CF', tint: '#DCEBFF' },
  packaging: { color: '#9A7800', tint: '#FFF3C4' },
  other:     { color: '#C8680F', tint: '#FFE6CF' },
};

export function calendarEventColors(event) {
  if (event.category === 'waste' && WASTE_SUBTYPE_COLORS[event.subtype]) return WASTE_SUBTYPE_COLORS[event.subtype];
  const { color, tint } = categoryPresentation(event);
  return { color, tint };
}

export function calendarEventInk(event) {
  return isCustomCategory(event.category) ? categoryInk(event.categoryColor) : calendarEventColors(event).color;
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
  background:   'linear-gradient(145deg, #F7F8F5 0%, #F1F3EF 100%)',
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
