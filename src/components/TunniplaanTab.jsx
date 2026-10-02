import { useState } from 'react';
import { addDays, formatDate, localDate } from '../calendar/dates.js';
import { useCalendarNow } from '../calendar/useCalendarNow';
import { dayItems, weekDates } from '../timetable/model.js';
import { lessonCount, lessonTag, subjectColors } from '../timetable/presentation.js';
import { useSchoolSwipe, useTimetableNavigation } from '../timetable/useTimetableNavigation.js';
import { ShellIcon } from './ShellIcon';
import { TimetableDialog } from './TimetableDialog';
import { TimetableDecoration, SchoolButterfly } from './TimetableDecoration';
import { TimetableLessonSheet } from './TimetableLessonSheet';
import { lessonHomework } from '../homework/model.js';
import { homeworkCount } from '../homework/presentation.js';
import { HomeworkView } from '../homework/HomeworkView';
import { HomeworkDialog } from '../homework/HomeworkDialog';

function HomeworkBadge({ homework, lesson, date }) {
  const count = lessonHomework(homework.items, lesson, date).filter(item => item.completedAt === null).length;
  return count > 0 ? <span className="mm-lesson-homework-badge">{homeworkCount(count)}</span> : null;
}

export function TunniplaanTab({ timetable, homework }) {
  const now = useCalendarNow(), today = localDate(now);
  const { selection, view, motion, choose, stepDay, stepWeek, goToday } = useTimetableNavigation(now);
  const stripSwipe = useSchoolSwipe(stepWeek), listSwipe = useSchoolSwipe(stepDay);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [schoolView, setSchoolView] = useState('timetable');
  const [homeworkDialog, setHomeworkDialog] = useState(null);
  const [homeworkError, setHomeworkError] = useState('');
  const days = weekDates(selection.monday);
  const date = addDays(view.monday, view.weekday - 1);
  const items = dayItems(timetable.lessons, date, now);
  const lessons = items.filter(item => item.kind === 'lesson');
  const lastEnd = lessons.length ? lessons.reduce((end, l) => l.end > end ? l.end : end, '') : null;
  const add = () => setDialog({ kind: 'lesson', weekday: selection.weekday,
    period: Math.max(0, ...timetable.lessons.filter(l => l.weekday === selection.weekday).map(l => l.period)) + 1 });
  const detail = dialog?.kind === 'detail' ? timetable.lessons.find(l => l.id === dialog.id) : null;
  const openHomework = (task, lesson = null) => {
    setHomeworkError('');
    setHomeworkDialog({ task, subject: lesson?.subject, lessonId: lesson?.id, date: lesson ? dialog.date : today,
      returnLesson: detail ? { id: detail.id, date: dialog.date } : null });
    setDialog(null);
  };
  const closeHomework = () => {
    if (homeworkDialog.returnLesson) setDialog({ kind: 'detail', ...homeworkDialog.returnLesson });
    setHomeworkDialog(null);
  };
  const completeHomework = (id, completed) => {
    setHomeworkError('');
    try { homework.setCompleted(id, completed); } catch (failure) { setHomeworkError(failure.message); }
  };
  return <div className="mm-page mm-timetable-page">
    <TimetableDecoration />
    <header className="mm-page-header mm-timetable-header">
      <div>{timetable.student.className ? <p className="mm-timetable-class"><span>{timetable.student.className}</span> klass</p>
        : <p className="mm-timetable-class">Minu koolinädal</p>}<h1>Anni tunniplaan</h1></div>
      <div className="mm-timetable-header-tools"><span className="mm-timetable-rainbow" aria-hidden="true"><i /><i /><i /><i /></span>
        <button type="button" className="mm-button mm-timetable-settings" aria-label="Muuda Anni klassi"
          disabled={!timetable.writable} onClick={() => setDialog({ kind: 'student' })}><ShellIcon name="seaded" /></button></div>
    </header>
    <div className="mm-school-view-switch" role="group" aria-label="Anni koolivaade">
      <button type="button" aria-pressed={schoolView === 'timetable'} onClick={() => setSchoolView('timetable')}>Tunniplaan</button>
      <button type="button" aria-pressed={schoolView === 'homework'} onClick={() => setSchoolView('homework')}>Kodused tööd</button>
    </div>
    {timetable.error && <p className="mm-notice mm-calendar-error" role="alert">{timetable.error}</p>}
    {(homework.error || homeworkError) && <p className="mm-notice mm-calendar-error" role="alert">{homework.error || homeworkError}</p>}
    {schoolView === 'homework' ? <HomeworkView homework={homework} now={now} onAdd={() => openHomework(null)}
      onOpen={task => openHomework(task)} onComplete={completeHomework} /> : <>
    <section className="mm-timetable-week" aria-label="Koolinädala valik" data-week={selection.monday}>
      <div className="mm-timetable-week-nav">
        <button type="button" className="mm-button mm-button-secondary" aria-label="Eelmine nädal" onClick={() => stepWeek(-1)}><ShellIcon name="back" /></button>
        <div className="mm-timetable-range" aria-live="polite"><strong>{formatDate(selection.monday, { day: 'numeric', month: 'short' })} – {formatDate(days[4].date, { day: 'numeric', month: 'short' })}</strong></div>
        <button type="button" className="mm-button mm-button-secondary" aria-label="Järgmine nädal" onClick={() => stepWeek(1)}><ShellIcon name="next" /></button>
      </div>
      <button type="button" className="mm-button mm-timetable-now"
        data-current={addDays(selection.monday, selection.weekday - 1) === today} onClick={goToday}>Täna</button>
      <div className="mm-timetable-days" role="group" aria-label="Nädalapäevad" {...stripSwipe}>
        {days.map(day => <button key={day.value} type="button" data-weekday={day.value} data-date={day.date}
          aria-pressed={selection.weekday === day.value} aria-current={day.date === today ? 'date' : undefined}
          aria-label={formatDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' }) + (day.date === today ? ', täna' : '')}
          style={{ '--tt-day-color': day.color }} className={`mm-timetable-day ${day.date === today ? 'mm-timetable-today' : ''}`}
          onClick={() => choose({ ...selection, weekday: day.value })}>
          <span>{day.short}</span><strong>{Number(day.date.slice(8))}</strong><small>{day.date === today ? 'Täna' : ' '}</small>
        </button>)}
      </div>
    </section>
    <div className="mm-timetable-actions">
      <button type="button" className="mm-button mm-button-secondary" aria-pressed={editing}
        onClick={() => setEditing(value => !value)}>{editing ? 'Valmis' : 'Muuda tunniplaani'}</button>
      <button type="button" className="mm-button mm-button-primary" disabled={!timetable.writable} onClick={add}><ShellIcon name="add" />Lisa tund</button>
    </div>
    <section className="mm-timetable-list" data-direction={motion.direction} data-phase={motion.phase}
      style={{ '--tt-day-color': days[view.weekday - 1].color }} aria-labelledby="timetable-day-title" {...listSwipe}>
      <div className="mm-timetable-list-heading"><h2 id="timetable-day-title">{formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
        <span>{lessonCount(lessons.length)}</span></div>
      {!lessons.length && <div className="mm-timetable-empty"><span className="mm-icon-tile"><ShellIcon name="tunniplaan" /></span>
        <h3>Selleks päevaks pole tunde lisatud.</h3><p>Lisa esimene tund. Tunniplaan kordub igal koolinädalal.</p></div>}
      <ol className="mm-timetable-lessons">
        {items.map(item => item.kind === 'break' ? <li key={item.id} className={`mm-school-break ${item.current ? 'mm-school-break-current' : ''}`}>
          <span>{item.current ? 'Praegu ' : ''}{item.label}<time>{item.start}–{item.end}</time></span>
        </li> : <li key={item.id} className={`mm-lesson mm-lesson-${item.status}`} data-lesson={item.id} style={subjectColors(item.subject)}>
          <button type="button" className="mm-lesson-open" aria-label={`Vaata tundi: ${item.subject}`}
            onClick={() => setDialog({ kind: 'detail', id: item.id, date })}>
            <span className="mm-lesson-number">{item.period}</span>
            <span className="mm-lesson-copy"><span className="mm-lesson-topline"><time>{item.start}–{item.end}</time>
              {lessonTag(item) && <span className="mm-lesson-status">{lessonTag(item)}</span>}</span>
              <strong>{item.subject}</strong>{item.teacher && <span className="mm-lesson-teacher">Õp. {item.teacher}</span>}
              <HomeworkBadge homework={homework} lesson={item} date={date} />
            </span>
            {item.room && <span className="mm-lesson-room"><span className="mm-sr-only">Ruum </span>{item.room}</span>}
            {item.status === 'current' && <span className="mm-lesson-progress" role="progressbar" aria-label="Tunni edenemine"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress)}
              aria-valuetext={`${item.remainingMinutes} minutit tunni lõpuni`}><span style={{ transform: `scaleX(${item.progress / 100})` }} /></span>}
          </button>
          {item.status === 'current' && <SchoolButterfly className="mm-school-butterfly-perched" />}
          {editing && <button type="button" className="mm-button mm-button-secondary mm-lesson-edit" disabled={!timetable.writable}
            aria-label={`Muuda tund: ${item.subject}`} onClick={() => setDialog({ kind: 'lesson', lesson: item })}><ShellIcon name="edit" /><span>Muuda</span></button>}
        </li>)}
      </ol>
      {lastEnd && <p className="mm-school-end">{lessons.every(l => l.status === 'past') && date === today ? 'Koolipäev läbi — tubli!' : `Koolipäev lõpeb ${lastEnd}`}</p>}
    </section>
    <p className="mm-footnote mm-school-swipe-hint">Libista nimekirja → päev · päevariba → nädal · puuduta tundi</p>
    <p className="mm-footnote mm-timetable-note">Käsitsi lisatud · ainult selles seadmes. Koolitunnid ei lähe kodu kalendrisse ega pilvesünki.</p>
    </>}
    {detail && <TimetableLessonSheet lesson={detail} date={dialog.date} now={now} homework={homework} homeworkError={homeworkError}
      onAddHomework={() => openHomework(null, detail)} onOpenHomework={task => openHomework(task)} onCompleteHomework={completeHomework}
      writable={timetable.writable} onClose={() => setDialog(null)}
      onEdit={() => setDialog({ kind: 'lesson', lesson: detail })} />}
    {dialog && dialog.kind !== 'detail' && <TimetableDialog selection={dialog} timetable={timetable} onClose={() => setDialog(null)}
      onSaved={weekday => { if (weekday) choose({ ...selection, weekday }); }} />}
    {homeworkDialog && <HomeworkDialog selection={homeworkDialog} homework={homework} lessons={timetable.lessons} onClose={closeHomework} />}
  </div>;
}
