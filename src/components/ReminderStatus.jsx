import { reminderStatus } from '../reminders/due';
import { formatDate } from '../calendar/dates';

export function ReminderStatus({item,now,detail=false}) {
  const status=reminderStatus(item,now);
  if(status.state === 'none') return detail ? <p>Meeldetuletus puudub.</p> : null;
  if(status.state === 'future') return detail ? <p>Meeldetuletus: {formatDate(status.dueDate)} kell {status.dueTime}.</p> : null;
  return <span className="mm-reminder-status" data-reminder-state={status.state}>
    {status.state === 'overdue' ? 'Sündmuse aeg on möödas' : 'Meeldetuletus käes'}
  </span>;
}
