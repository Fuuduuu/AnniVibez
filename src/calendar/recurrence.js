import { addDays, addMonths, dayNumber, daysApart, localDate, localTime } from './dates.js';

export function matchesDate(event,date) {
  if (date < event.date) return false;
  const {frequency,interval} = event.recurrence;
  if (frequency === 'none') return date === event.date;
  if (frequency === 'weekly') return daysApart(event.date,date) % (7*interval) === 0;
  const [y,m] = date.split('-').map(Number);
  const [startY,startM] = event.date.split('-').map(Number);
  const months = (y-startY)*12 + m-startM;
  const step = frequency === 'yearly' ? 12 : interval;
  return months % step === 0 && addMonths(event.date,months) === date;
}

function occurrence(event, date) {
  return {...event,...event.overrides[date], eventId:event.id, occurrenceDate:date,
    date:event.overrides[date]?.date ?? date, occurrenceId:JSON.stringify([event.id,date])};
}

const compare = (a,b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.occurrenceId.localeCompare(b.occurrenceId);

function datesInRange(event,from,to) {
  const {frequency,interval}=event.recurrence;
  if(frequency === 'none') return [event.date];
  const monthsBetween = date => {
    const [y,m]=date.split('-').map(Number), [sy,sm]=event.date.split('-').map(Number);
    return (y-sy)*12+m-sm;
  };
  const weekly=frequency === 'weekly', step=weekly ? interval*7 : frequency === 'yearly' ? 12 : interval;
  const distance=date=>weekly ? daysApart(event.date,date) : monthsBetween(date);
  const first=Math.max(0,Math.floor(distance(from)/step));
  const last=Math.floor(distance(to)/step);
  const result=[];
  // Jump directly to the requested window instead of scanning the series history or each calendar day.
  for(let i=first;i<=last;i++) {
    const date=weekly ? addDays(event.date,i*step) : addMonths(event.date,i*step);
    if(date >= from && date <= to) result.push(date);
  }
  return result;
}

export function expandOccurrences(events,from,to) {
  const length = daysApart(from,to);
  if (length < 0 || length > 3660) throw new Error('Kuupäevavahemik peab olema kuni kümme aastat.');
  const result=[];
  for (const event of events) {
    const excluded = new Set(event.excludedDates);
    const candidates = new Set([...datesInRange(event,from,to),...Object.keys(event.overrides)]);
    for(const date of candidates) {
      if (excluded.has(date) || !matchesDate(event,date)) continue;
      const item=occurrence(event,date);
      if(item.date >= from && item.date <= to) result.push(item);
    }
  }
  return result.sort(compare);
}

export function upcomingOccurrences(events,now,limit=5) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new Error('Vigane sündmuste arv.');
  const today=localDate(now), time=localTime(now);
  const candidates=new Map();
  for(const event of events) {
    const from=event.date > today ? event.date : today;
    const to=addMonths(from,(limit+1)*12);
    for(const item of expandOccurrences([event],from,to)) candidates.set(item.occurrenceId,item);
    // Moved occurrences may precede the source anchor or lie beyond the bounded normal series window.
    for(const date of Object.keys(event.overrides)) {
      dayNumber(date);
      if (!event.excludedDates.includes(date) && matchesDate(event,date)) {
        const item=occurrence(event,date);candidates.set(item.occurrenceId,item);
      }
    }
  }
  return [...candidates.values()].filter(item=>item.date > today || (item.date === today && (!item.time || item.time >= time)))
    .sort(compare).slice(0,limit);
}
