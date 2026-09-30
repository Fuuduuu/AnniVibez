export function SchoolButterfly({ className = '' }) {
  return <svg className={`mm-school-butterfly ${className}`} viewBox="0 0 36 32" aria-hidden="true" focusable="false">
    <g className="mm-school-wing mm-school-wing-left"><path d="M17 16C9-7-7 6 6 17C-2 24 10 33 17 20" fill="#d9cdfb" />
      <path d="M17 16C9 8 3 9 6 17C2 24 11 29 17 20" fill="#f7c3d6" /></g>
    <g className="mm-school-wing mm-school-wing-right"><path d="M19 16C27-7 43 6 30 17C38 24 26 33 19 20" fill="#bfe3f2" />
      <path d="M19 16C27 8 33 9 30 17C34 24 25 29 19 20" fill="#ffe0a3" /></g>
    <path d="M18 7v17m0-15-3-4m3 4 3-4" stroke="#6d5b7e" strokeWidth="2" strokeLinecap="round" fill="none" />
  </svg>;
}

export function TimetableDecoration() {
  return <div className="mm-timetable-decoration" aria-hidden="true">
    <i className="mm-school-blob mm-school-blob-purple" /><i className="mm-school-blob mm-school-blob-blue" />
    <i className="mm-school-blob mm-school-blob-peach" /><i className="mm-school-blob mm-school-blob-pink" />
    <SchoolButterfly className="mm-school-butterfly-header" />
    <span className="mm-school-sparkle">✦</span><span className="mm-school-sparkle mm-school-sparkle-small">✦</span>
  </div>;
}
