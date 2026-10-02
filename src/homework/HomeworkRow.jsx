import { subjectColors } from '../timetable/presentation.js';
import { isOverdue } from './model.js';
import { homeworkDueLabel } from './presentation.js';

export function HomeworkRow({ item, now, writable, compact = false, onOpen, onComplete }) {
  const done = item.completedAt !== null, overdue = isOverdue(item, now);
  const action = done ? 'Märgi uuesti tegemata' : 'Märgi tehtuks';
  return <article className={`mm-homework-card${done ? ' mm-homework-done' : ''}${compact ? ' mm-homework-compact' : ''}`}
    data-homework={item.id} style={subjectColors(item.subject)}>
    <label className="mm-homework-check">
      <input type="checkbox" checked={done} disabled={!writable} aria-label={`${action}: ${item.title}`}
        onChange={event => onComplete(item.id, event.target.checked)} />
      <span aria-hidden="true">{done ? '✓' : ''}</span>
    </label>
    <button type="button" className="mm-homework-open" aria-label={`Muuda kodutööd: ${item.title}`}
      aria-describedby={`homework-meta-${item.id}${done || overdue ? ` homework-status-${item.id}` : ''}`} onClick={() => onOpen(item)}>
      {!compact && <span className="mm-homework-subject">{item.subject}</span>}
      <strong>{item.title}</strong>
      <span className="mm-homework-meta" id={`homework-meta-${item.id}`}><time dateTime={item.dueDate}>{homeworkDueLabel(item)}</time>
        {item.notes && <span className="mm-homework-notes">Märkmed</span>}</span>
      {(overdue || done) && <span id={`homework-status-${item.id}`} className={`mm-homework-status${overdue ? ' mm-homework-overdue' : ''}`}>{done ? 'TEHTUD' : 'ÜLE TÄHTAJA'}</span>}
    </button>
  </article>;
}
