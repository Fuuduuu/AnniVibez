const PATHS = {
  kodu: 'M3 11 12 3 21 11 M5 10v11h5v-7h4v7h5V10',
  kalender: 'M5 5h14v16H5z M8 3v4 M16 3v4 M5 10h14 M8 14h2 M14 14h2 M8 18h2',
  buss: 'M5 4h14v13H5z M5 11h14 M8 20v-3 M16 20v-3 M8 14h1 M15 14h1',
  veel: 'M5 5h5v5H5z M14 5h5v5h-5z M5 14h5v5H5z M14 14h5v5h-5z',
  seaded: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  add: 'M12 5v14 M5 12h14',
  waste: 'M4 7h16 M7 7l1 14h8l1-14 M9 7V3h6v4 M10 11v6 M14 11v6',
  maintenance: 'm14 6 4 4 M14 3a6 6 0 0 0-7 8L3 15a3 3 0 0 0 4 4l4-4a6 6 0 0 0 8-7l-4 3-3-3z',
  payment: 'M4 5h16v14H4z M4 9h16 M7 15h4',
  general: 'M5 4h14v17H5z M8 9h8 M8 13h8 M8 17h4',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16',
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
