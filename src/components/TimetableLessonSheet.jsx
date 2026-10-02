import { useEffect, useRef } from 'react';
import { WEEKDAYS } from '../timetable/model.js';
import { subjectColors } from '../timetable/presentation.js';
import { lessonHomework } from '../homework/model.js';
import { HomeworkRow } from '../homework/HomeworkRow';

export function TimetableLessonSheet({ lesson, date, now, homework, homeworkError, writable, onEdit, onClose,
  onAddHomework, onOpenHomework, onCompleteHomework }) {
  const ref = useRef(null);
  const tasks = lessonHomework(homework.items, lesson, date);
  useEffect(() => { const dialog = ref.current;dialog.showModal();return () => dialog.close(); }, []);
  return <dialog ref={ref} role="dialog" className="mm-event-dialog mm-timetable-dialog mm-lesson-sheet"
    aria-labelledby="lesson-detail-title" style={subjectColors(lesson.subject)}
    onCancel={event => { event.preventDefault();onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) {
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    } }}>
    <header className="mm-lesson-sheet-heading">
      <span className="mm-lesson-number">{lesson.period}</span>
      <div><p>{WEEKDAYS[lesson.weekday - 1].label} · {lesson.period}. tund</p><h2 id="lesson-detail-title">{lesson.subject}</h2></div>
    </header>
    <dl className="mm-lesson-sheet-facts">
      <div><dt>Aeg</dt><dd>{lesson.start}–{lesson.end}</dd></div>
      <div><dt>Ruum</dt><dd>{lesson.room || '—'}</dd></div>
      <div><dt>Õpetaja</dt><dd>{lesson.teacher || '—'}</dd></div>
    </dl>
    <section className="mm-lesson-homework" aria-label="Kodused tööd"><h3>Kodused tööd</h3>
      {(homework.error || homeworkError) && <p role="alert">{homework.error || homeworkError}</p>}
      {tasks.length ? <ul className="mm-homework-list mm-lesson-homework-list">{tasks.map(item => <li key={item.id}>
        <HomeworkRow item={item} now={now} writable={homework.writable} compact onOpen={onOpenHomework} onComplete={onCompleteHomework} />
      </li>)}</ul> : <p>Siin pole veel koduseid töid.</p>}
      <button type="button" className="mm-button mm-button-primary mm-lesson-homework-add" disabled={!homework.writable} onClick={onAddHomework}>Lisa kodune töö</button>
    </section>
    <div className="mm-lesson-sheet-actions">
      <button type="button" className="mm-button mm-button-secondary" disabled={!writable} onClick={onEdit}>Muuda tund</button>
      <button type="button" className="mm-button mm-button-primary" onClick={onClose}>Sulge</button>
    </div>
  </dialog>;
}
