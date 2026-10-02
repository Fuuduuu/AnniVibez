import { useEffect, useRef, useState } from 'react';
import { WEEKDAYS } from '../timetable/model.js';

export function HomeworkDialog({ selection, homework, lessons, onClose }) {
  const task = selection.task;
  const [form, setForm] = useState(() => ({ subject: task?.subject ?? selection.subject ?? '', title: task?.title ?? '',
    dueDate: task?.dueDate ?? selection.date, dueTime: task?.dueTime ?? '', lessonId: task?.lessonId ?? selection.lessonId ?? '', notes: task?.notes ?? '' }));
  const [error, setError] = useState(''), [deleting, setDeleting] = useState(false);
  const dialog = useRef(null);
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close(); }, []);
  const set = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const existing = task && homework.items.find(item => item.id === task.id);
  function save(event) {
    event.preventDefault(); setError('');
    try {
      const data = { ...form, dueTime: form.dueTime || null, lessonId: form.lessonId || null };
      if (task) homework.update(task.id, data); else homework.create(data);
      onClose();
    } catch (failure) { setError(failure.message); }
  }
  function remove() {
    setError('');
    try { homework.remove(task.id); onClose(); } catch (failure) { setError(failure.message); }
  }
  function complete() {
    setError('');
    try { homework.setCompleted(task.id, existing.completedAt === null); }
    catch (failure) { setError(failure.message); }
  }
  const title = deleting ? 'Kustuta kodune töö' : task ? 'Muuda kodust tööd' : 'Lisa kodune töö';
  const missingLesson = form.lessonId && !lessons.some(lesson => lesson.id === form.lessonId);
  return <dialog role="dialog" ref={dialog} className="mm-event-dialog mm-timetable-dialog mm-homework-dialog"
    aria-labelledby="homework-dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="mm-dialog-heading"><h2 id="homework-dialog-title">{title}</h2>
      <button type="button" className="mm-button mm-button-secondary" onClick={onClose}>Tühista</button></header>
    <div className="mm-dialog-body">
      {error && <p className="mm-notice mm-calendar-error" role="alert">{error}</p>}
      {deleting ? <><h3>{task.title}</h3><p>See eemaldab ainult valitud kodutöö sellest seadmest. Tunniplaan jääb alles.</p>
        <div className="mm-dialog-actions"><button type="button" className="mm-button mm-button-secondary" onClick={() => setDeleting(false)}>Tagasi</button>
          <button type="button" className="mm-button mm-delete-confirm" disabled={!homework.writable} onClick={remove}>Kinnita kustutamine</button></div></>
        : <form onSubmit={save}>
          <label className="mm-field" htmlFor="homework-subject">Aine
            <input id="homework-subject" required maxLength={200} autoFocus list="homework-subjects" value={form.subject} onChange={event => set('subject', event.target.value)} /></label>
          <datalist id="homework-subjects">{[...new Set(lessons.map(lesson => lesson.subject))].map(subject => <option key={subject} value={subject} />)}</datalist>
          <label className="mm-field" htmlFor="homework-title">Ülesanne
            <input id="homework-title" required maxLength={500} value={form.title} onChange={event => set('title', event.target.value)} /></label>
          <div className="mm-form-pair">
            <label className="mm-field" htmlFor="homework-date">Tähtaeg
              <input id="homework-date" type="date" required min="1000-01-01" max="9999-12-31" value={form.dueDate} onChange={event => set('dueDate', event.target.value)} /></label>
            <label className="mm-field" htmlFor="homework-time">Kellaaeg (valikuline)
              <input id="homework-time" type="time" value={form.dueTime} onChange={event => set('dueTime', event.target.value)} /></label>
          </div>
          <label className="mm-field" htmlFor="homework-lesson">Seotud tund (valikuline)
            <select id="homework-lesson" value={form.lessonId} onChange={event => {
              const lessonId = event.target.value, lesson = lessons.find(entry => entry.id === lessonId);
              setForm(previous => ({ ...previous, lessonId, subject: previous.subject || lesson?.subject || '' }));
            }}><option value="">Ilma seotud tunnita</option>
              {missingLesson && <option value={form.lessonId}>Kustutatud tund · {form.subject}</option>}
              {lessons.map(lesson => <option value={lesson.id} key={lesson.id}>{WEEKDAYS[lesson.weekday - 1].short} · {lesson.period}. tund · {lesson.subject}</option>)}
            </select></label>
          <label className="mm-field" htmlFor="homework-notes">Märkmed (valikuline)
            <textarea id="homework-notes" maxLength={5000} value={form.notes} onChange={event => set('notes', event.target.value)} /></label>
          {task && <div className="mm-homework-editor-actions">
            <button type="button" className="mm-button mm-button-secondary" disabled={!homework.writable || !existing} onClick={complete}>
              {existing?.completedAt ? 'Märgi uuesti tegemata' : 'Märgi tehtuks'}</button>
            <button type="button" className="mm-button mm-button-secondary mm-delete" disabled={!homework.writable} onClick={() => { setError(''); setDeleting(true); }}>Kustuta</button>
          </div>}
          <footer className="mm-event-footer"><button type="button" className="mm-button mm-button-secondary" onClick={onClose}>Tühista</button>
            <button type="submit" className="mm-button mm-button-primary" disabled={!homework.writable} >Salvesta kodutöö</button></footer>
        </form>}
    </div>
  </dialog>;
}
