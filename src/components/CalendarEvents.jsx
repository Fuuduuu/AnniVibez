import { CATEGORIES, WASTE_SUBTYPES } from '../calendar/eventModel';
import { formatDate, relativeDate } from '../calendar/dates';

export function EventRows({items,today,onOpen}) {
  return <div className="mm-event-list">
    {items.map(item=>{
      const category=CATEGORIES[item.category];
      return <button key={item.occurrenceId} type="button" data-occurrence={item.occurrenceId}
        className="mm-card mm-event-row" style={{'--event-color':category.color,'--event-tint':category.tint}}
        onClick={()=>onOpen(item)}>
        <span className="mm-event-day" aria-hidden="true">{item.date.slice(8)}<small>{formatDate(item.date,{month:'short'})}</small></span>
        <span className="mm-event-copy"><strong>{item.title}</strong>
          <span>{category.label}{item.category === 'waste' ? ` · ${WASTE_SUBTYPES[item.subtype]}` : ''}</span>
          <span>{formatDate(item.date)}{item.time ? ` · ${item.time}` : ' · Kogu päev'}</span>
        </span>
        <span className="mm-event-when">{relativeDate(item.date,today)}</span>
      </button>;
    })}
  </div>;
}

export function CalendarError({error}) {
  return error ? <p role="alert" className="mm-notice mm-calendar-error">{error}</p> : null;
}
