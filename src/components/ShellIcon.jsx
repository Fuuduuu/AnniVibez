const PATHS = {
  kodu: 'M3 11 12 3 21 11 M5 10v11h5v-7h4v7h5V10',
  kalender: 'M5 5h14v16H5z M8 3v4 M16 3v4 M5 10h14 M8 14h2 M14 14h2 M8 18h2',
  buss: 'M5 4h14v13H5z M5 11h14 M8 20v-3 M16 20v-3 M8 14h1 M15 14h1',
  veel: 'M5 5h5v5H5z M14 5h5v5h-5z M5 14h5v5H5z M14 14h5v5h-5z',
  seaded: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  add: 'M12 5v14 M5 12h14',
  waste: 'M4 7h16 M7 7l1 14h8l1-14 M9 7V3h6v4 M10 11v6 M14 11v6',
  culture: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z M15 7v2 M15 12v1 M15 16v1',
  birthday: 'M3 9h18v4H3z M5 13v8h14v-8 M12 9v12 M12 9H8a3 3 0 1 1 3-3l1 3 M12 9h4a3 3 0 1 0-3-3l-1 3',
  training: 'M3 12h4l3-7 4 14 3-7h4',
  maintenance: 'm14 6 4 4 M14 3a6 6 0 0 0-7 8L3 15a3 3 0 0 0 4 4l4-4a6 6 0 0 0 8-7l-4 3-3-3z',
  car: 'M4 11l2-6h12l2 6 M3 11h18v7H3z M6 18v3 M18 18v3 M6 14h2 M16 14h2',
  general: 'M5 4h14v17H5z M8 9h8 M8 13h8 M8 17h4',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16',
  cloud: 'M7 18H6a4 4 0 0 1-1-7.9 7 7 0 0 1 13.5-1.6A4.8 4.8 0 0 1 19 18h-2 M9 15l3-3 3 3 M12 12v9',
  tunniplaan: 'M3 5h7l2 2 2-2h7v15h-7l-2 2-2-2H3z M12 7v15 M6 9h3 M6 13h3 M15 9h3 M15 13h3',
  room: 'M6 21V3h12v18 M3 21h18 M14 12h1',
  edit: 'm4 16 12-12 4 4-12 12-5 1z M13 7l4 4',
  loo: 'm4 16 12-12 4 4-12 12-5 1z M13 7l4 4',
  paevik: 'M5 3h14v18H5z M8 3v18 M11 8h5 M11 12h5',
  next: 'm9 5 7 7-7 7',
  back: 'm15 5-7 7 7 7',
};

export function ShellIcon({ name }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={PATHS[name]} />
  </svg>;
}
