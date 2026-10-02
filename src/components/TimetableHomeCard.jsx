import { homeSchoolSummary } from '../timetable/model.js';
import { lessonCount, subjectColors } from '../timetable/presentation.js';
import { ShellIcon } from './ShellIcon';
import { SchoolButterfly } from './TimetableDecoration';
import { homeworkHomeSummary } from '../homework/model.js';

export function TimetableHomeCard({ timetable, homework, now, onOpen }) {
  const summary = homeSchoolSummary(timetable, now);
  const tasks = homework.writable ? homeworkHomeSummary(homework.items, now) : null;
  if (!summary && !tasks && !homework.error) return null;
  const shown = summary?.lesson ?? summary?.current;
  const remaining = !summary ? 'Ainult selles seadmes' : summary.remaining ? summary.lesson ? `Täna veel ${lessonCount(summary.remaining)}` : 'Viimane tund käib'
    : summary.kind === 'monday' && summary.lesson && !summary.text.includes('läbi') ? 'Järgmine koolipäev' : summary.text;
  return <section className="mm-section mm-school-section" aria-labelledby="school-heading">
    <div className="mm-school-card" style={shown ? subjectColors(shown.subject) : undefined}>
      <div className="mm-school-home-blob" aria-hidden="true" /><SchoolButterfly className="mm-school-butterfly-home" />
      <div className="mm-school-heading"><h2 id="school-heading">ANNI · KOOL</h2>{timetable.student.className && <span>{timetable.student.className}</span>}</div>
      {summary && <div className="mm-school-summary"><p>{summary.label}</p>
        {shown && <div><time>{shown.start}</time><strong>{shown.subject}</strong></div>}</div>}
      {summary?.current && <p className="mm-school-now"><span aria-hidden="true" />Praegu {summary.current.subject.toLocaleLowerCase('et')} · veel {summary.current.remainingMinutes} min</p>}
      {tasks && <div className={`mm-school-homework${tasks.kind === 'overdue' ? ' mm-school-homework-overdue' : ''}`}>
        <strong>{tasks.label}</strong><p>{tasks.title}</p></div>}
      {homework.error && <p className="mm-footnote" role="alert">{homework.error}</p>}
      <footer className="mm-school-footer"><span>{remaining}</span>
        <button type="button" className="mm-button mm-button-primary" onClick={onOpen}>Ava tunniplaan<ShellIcon name="next" /></button>
      </footer>
    </div>
  </section>;
}
