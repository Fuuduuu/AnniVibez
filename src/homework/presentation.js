import { formatDate } from '../calendar/dates.js';

export const homeworkCount = count => `${count} ${count === 1 ? 'kodune töö' : 'kodutööd'}`;
export function homeworkDueLabel(item) {
  return `${formatDate(item.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })}${item.dueTime ? ` · ${item.dueTime}` : ''}`;
}
