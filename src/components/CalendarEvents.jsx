import { CATEGORIES, WASTE_SUBTYPES } from '../calendar/eventModel';
import { formatDate, relativeDate } from '../calendar/dates';
import { ReminderStatus } from './ReminderStatus';
import { ShellIcon } from './ShellIcon';

export function EventRows({items,today,now,onOpen,variant='default'}) {
  return <div className={`mm-event-list mm-events-${variant}`}>
    {items.map(item=>{
      const category=CATEGORIES[item.category];
      const relative=relativeDate(item.date,today);
      const categoryLabel=category.label+(item.category === 'waste' ? ` · ${WASTE_SUBTYPES[item.subtype]}` : '');
      return <button key={item.occurrenceId} type="button" data-occurrence={item.occurrenceId}
        className={variant === 'agenda' ? 'mm-agenda-row' : 'mm-card mm-event-row'} style={{'--event-color':category.color,'--event-tint':category.tint}}
        onClick={()=>onOpen(item)}>
        {variant === 'default'
          ? <span className="mm-event-day" aria-hidden="true">{item.date.slice(8)}<small>{formatDate(item.date,{month:'short'})}</small></span>
          : <span className="mm-event-icon" aria-hidden="true"><ShellIcon name={item.category} /></span>}
        <span className="mm-event-copy"><strong title={variant === 'agenda' ? item.title : undefined}>{item.title}</strong>
          {variant === 'home' ? <span>{categoryLabel} · {item.time || 'Kogu päev'}</span>
            : variant === 'selected' ? <>
              <span>{item.time || 'Kogu päev'}</span>
              {item.notes && <span className="mm-event-notes">{item.notes}</span>}
              <span>{categoryLabel}</span>
            </> : variant === 'agenda' ? <span className="mm-sr-only">{categoryLabel}</span> : <>
              <span>{categoryLabel}</span>
              <span>{formatDate(item.date)}{item.time ? ` · ${item.time}` : ' · Kogu päev'}</span>
            </>}
          {now && <ReminderStatus item={item} now={now} />}
        </span>
        {variant === 'agenda' ? <span className="mm-agenda-when">{relative}<small>{item.time || 'Kogu päev'}</small></span>
          : variant !== 'selected' && <span className="mm-event-when" data-relative={relative}>{relative}</span>}
      </button>;
    })}
  </div>;
}

export function CalendarError({error}) {
  return error ? <p role="alert" className="mm-notice mm-calendar-error">{error}</p> : null;
}
