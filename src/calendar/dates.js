const DAY = 86400000;
const pad = value => String(value).padStart(2, '0');

// UTC is used only for Gregorian day arithmetic, never to serialize local event dates.
export function dayNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Vigane kuupäev.');
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000 || year > 9999) throw new Error('Vigane aasta.');
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('Vigane kuupäev.');
  return stamp / DAY;
}

export function fromDay(number) {
  const date = new Date(number * DAY);
  const value = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  dayNumber(value);
  return value;
}

export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function localTime(now) { return `${pad(now.getHours())}:${pad(now.getMinutes())}`; }
export function addDays(date, days) { return fromDay(dayNumber(date) + days); }
export function daysApart(from, to) { return dayNumber(to) - dayNumber(from); }
export function monthStart(date) { dayNumber(date); return date.slice(0, 8) + '01'; }
export function addMonths(date, months) {
  dayNumber(date);
  const [y, m, d] = date.split('-').map(Number);
  const index = y * 12 + m - 1 + months;
  const year = Math.floor(index / 12), month = index % 12;
  if (year > 9999) return '9999-12-31';
  if (year < 1000) return '1000-01-01';
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const result = `${year}-${pad(month + 1)}-${pad(Math.min(d, last))}`;
  dayNumber(result);
  return result;
}

export function weekStart(date) {
  const weekday = new Date(dayNumber(date) * DAY).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function monthDays(date) {
  const first = dayNumber(monthStart(date));
  const weekday = new Date(first * DAY).getUTCDay();
  const start = first - ((weekday + 6) % 7);
  const min = dayNumber('1000-01-01'), max = dayNumber('9999-12-31');
  return Array.from({length:42}, (_, i) => start+i < min || start+i > max ? null : fromDay(start+i));
}

export function formatDate(date, options = {day:'numeric', month:'long'}) {
  dayNumber(date);
  const [y,m,d] = date.split('-').map(Number);
  return new Date(y,m-1,d,12).toLocaleDateString('et-EE',options);
}

export function relativeDate(date, today) {
  const days = daysApart(today,date);
  if (days === 0) return 'täna';
  if (days === 1) return 'homme';
  if (days > 1) return `${days} päeva pärast`;
  return formatDate(date);
}

export function agendaGroup(date, today) {
  const monday = weekStart(today);
  if (date < addDays(monday,7)) return 'Sel nädalal';
  if (date < addDays(monday,14)) return 'Järgmisel nädalal';
  return 'Hiljem';
}
