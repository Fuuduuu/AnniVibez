import { useEffect, useRef, useState } from 'react';
import { WEEKDAYS } from '../timetable/model.js';

export function TimetableDialog({ selection, timetable, onClose, onSaved }) {
  const studentMode = selection.kind === 'student';
  const lesson = selection.lesson;
  const [form, setForm] = useState(() => studentMode ? { className: timetable.student.className } : {
    weekday: lesson?.weekday ?? selection.weekday, period: lesson?.period ?? selection.period,
    subject: lesson?.subject ?? '', start: lesson?.start ?? '', end: lesson?.end ?? '',
    room: lesson?.room ?? '', teacher: lesson?.teacher ?? '',
  });
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  const set = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  function save(event) {
    event.preventDefault();
    setError('');
    try {
      if (studentMode) timetable.saveStudent(form);
      else if (lesson) timetable.update(lesson.id, form);
      else timetable.create(form);
      onSaved?.(form.weekday);
      onClose();
    } catch (failure) { setError(failure.message); }
  }
  function remove() {
    setError('');
    try { timetable.remove(lesson.id); onClose(); }
    catch (failure) { setError(failure.message); }
  }
  const title = studentMode ? 'Anni klass' : deleting ? 'Kustuta tund' : lesson ? 'Muuda tund' : 'Lisa tund';
  return <dialog role="dialog" ref={dialog} className="mm-event-dialog mm-timetable-dialog" aria-labelledby="timetable-dialog-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="mm-dialog-heading"><h2 id="timetable-dialog-title">{title}</h2>
      <button type="button" className="mm-button mm-button-secondary" onClick={onClose}>Tühista</button></header>
    <div className="mm-dialog-body">
      {error && <p className="mm-notice mm-calendar-error" role="alert">{error}</p>}
      {deleting ? <>
        <h3>{lesson.subject}</h3>
        <p>See eemaldab tunni selle nädalapäeva tunniplaanist kõigil nädalatel.</p>
        <div className="mm-dialog-actions">
          <button type="button" className="mm-button mm-button-secondary" onClick={() => setDeleting(false)}>Tagasi</button>
          <button type="button" className="mm-button mm-delete-confirm" disabled={!timetable.writable} onClick={remove}>Kinnita kustutamine</button>
        </div>
      </> : <form onSubmit={save}>
        {studentMode ? <>
          <p className="mm-timetable-student-name">Anni</p>
          <label className="mm-field" htmlFor="timetable-class">Klass
            <input id="timetable-class" value={form.className} onChange={e => set('className', e.target.value)} maxLength={100} autoFocus placeholder="Näiteks 6A" /></label>
        </> : <>
          <div className="mm-form-pair">
            <label className="mm-field" htmlFor="lesson-weekday">Päev
              <select id="lesson-weekday" value={form.weekday} onChange={e => set('weekday', Number(e.target.value))}>
                {WEEKDAYS.map(d => <option value={d.value} key={d.value}>{d.label}</option>)}
              </select></label>
            <label className="mm-field" htmlFor="lesson-number">Tunni number
              <input id="lesson-number" type="number" min={1} step={1} required value={form.period}
                onChange={e => set('period', e.target.value === '' ? '' : Number(e.target.value))} /></label>
          </div>
          <label className="mm-field" htmlFor="lesson-subject">Aine
            <input id="lesson-subject" required maxLength={200} autoFocus value={form.subject} onChange={e => set('subject', e.target.value)} /></label>
          <div className="mm-form-pair">
            <label className="mm-field" htmlFor="lesson-start">Algus
              <input id="lesson-start" type="time" required value={form.start} onChange={e => set('start', e.target.value)} /></label>
            <label className="mm-field" htmlFor="lesson-end">Lõpp
              <input id="lesson-end" type="time" required value={form.end} onChange={e => set('end', e.target.value)} /></label>
          </div>
          <label className="mm-field" htmlFor="lesson-room">Ruum (valikuline)
            <input id="lesson-room" maxLength={100} value={form.room} onChange={e => set('room', e.target.value)} /></label>
          <label className="mm-field" htmlFor="lesson-teacher">Õpetaja (valikuline)
            <input id="lesson-teacher" maxLength={200} value={form.teacher} onChange={e => set('teacher', e.target.value)} /></label>
          {lesson && <button type="button" className="mm-button mm-button-secondary mm-delete mm-timetable-delete"
            disabled={!timetable.writable} onClick={() => { setError(''); setDeleting(true); }}>Kustuta tund</button>}
        </>}
        <footer className="mm-event-footer">
          <button type="button" className="mm-button mm-button-secondary" onClick={onClose}>Tühista</button>
          <button type="submit" className="mm-button mm-button-primary mm-save-event" disabled={!timetable.writable}>
            {studentMode ? 'Salvesta klass' : 'Salvesta tund'}</button>
        </footer>
      </form>}
    </div>
  </dialog>;
}
