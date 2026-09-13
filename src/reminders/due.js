import { addDays, localDate, localTime } from '../calendar/dates.js';
import { expandOccurrences, upcomingOccurrences } from '../calendar/recurrence.js';

export function reminderStatus(item,now) {
  const days=item.reminder?.daysBefore ?? 0;
  if(![1,3,7].includes(days)) return {state:'none'};
  // Date-only reminders use 09:00 local; timed reminders retain the event's local clock time, including across DST.
  const dueTime=item.time || '09:00';
  let dueDate;
  try {dueDate=addDays(item.date,-days);} catch {return {state:'none'};}
  const today=localDate(now),time=localTime(now);
  const overdue=today > item.date || (today === item.date && item.time && time > item.time);
  const state=overdue ? 'overdue' : today > dueDate || (today === dueDate && time >= dueTime) ? 'due' : 'future';
  return {state,dueDate,dueTime,reminderKey:JSON.stringify([item.eventId ?? item.id,item.seriesId ?? null,
    item.occurrenceDate ?? item.date,item.date,item.time ?? null,days])};
}

export function dueReminders(events,now) {
  const today=localDate(now);
  return expandOccurrences(events,today,addDays(today,7)).flatMap(item=>{
    const status=reminderStatus(item,now);
    return status.state === 'due' ? [{...item,...status}] : [];
  });
}

export function homeOccurrences(events,now) {
  const today=localDate(now);
  const items=new Map(upcomingOccurrences(events,now,5).map(item=>[item.occurrenceId,item]));
  // Keep today's elapsed reminders visible, without suggesting the household task was or was not completed.
  for(const item of expandOccurrences(events,today,today)) {
    if(reminderStatus(item,now).state === 'overdue') items.set(item.occurrenceId,item);
  }
  return [...items.values()].sort((a,b)=>a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.occurrenceId.localeCompare(b.occurrenceId)).slice(0,5);
}
