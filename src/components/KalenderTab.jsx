import { useState, useSyncExternalStore } from 'react';
import { PageHeader } from './ShellViews';
import { ShellIcon } from './ShellIcon';
import { EventRows, CalendarError } from './CalendarEvents';
import { CATEGORIES } from '../calendar/eventModel';
import { getEventEditTarget } from '../calendar/eventRepository.js';
import { categoryPresentation } from '../calendar/categoryModel.js';
import { AV, CALENDAR_COLORS, calendarEventColors, calendarEventInk } from '../design/tokens';
import { expandOccurrences } from '../calendar/recurrence';
import { addDays, addMonths, agendaGroup, formatDate, localDate, monthDays } from '../calendar/dates';
import { useCalendarNow } from '../calendar/useCalendarNow';

const emptySync = { oversizedEventIds: [] };
const getEmptySync = () => emptySync;
const subscribeEmpty = () => () => {};
const fullDate = { day:'numeric', month:'long', year:'numeric' };

function SizeRecoveryEvent({ event, onRecover }) {
  const occurrences = Object.keys(event.overrides).sort().flatMap(occurrenceDate => {
    const occurrence = getEventEditTarget(event, { scope:'occurrence', occurrenceDate });
    return occurrence ? [{ occurrenceDate, occurrence }] : [];
  });
  const scope = event.recurrence.frequency === 'none' ? null : 'series';
  return <article className="mm-card mm-calendar-size-event">
    <h3>{event.title}</h3>
    <p className="mm-footnote">{formatDate(event.date, fullDate)}</p>
    <button type="button" className="mm-button mm-button-secondary" aria-label={`Ava sündmus: ${event.title}`}
      onClick={() => onRecover(event.id, scope)}>Ava sündmus</button>
    {occurrences.length > 0 && <details>
      <summary>Muudetud üksikkorrad ({occurrences.length})</summary>
      <ul>{occurrences.map(({ occurrenceDate, occurrence }) => {
        const date = formatDate(occurrence.date, fullDate);
        const label = occurrence.date === occurrenceDate ? date : `${date} (algselt ${formatDate(occurrenceDate, fullDate)})`;
        return <li key={occurrenceDate}><button type="button" className="mm-text-button"
          aria-label={`Ava üksikkord: ${event.title}, ${label}`} onClick={() => onRecover(event.id, 'occurrence', occurrenceDate)}>{label}</button></li>;
      })}</ul>
    </details>}
  </article>;
}

function CalendarSyncWarnings({ sync, events, onRecover }) {
  const view = useSyncExternalStore(sync?.subscribe ?? subscribeEmpty, sync?.getSnapshot ?? getEmptySync);
  const oversized = new Set(view.oversizedEventIds);
  const uncertain = new Set(view.uncertainEventIds);
  const conflicts = new Set(view.fieldConflictEventIds);
  if (!oversized.size && !uncertain.size && !conflicts.size) return null;
  const needsSizeEdit = events.filter(event => oversized.has(event.id));
  const titles = ids => {
    const affected = events.filter(event => ids.has(event.id));
    return affected.length > 0 && <ul>{affected.map(event => <li key={event.id}>{event.title}</li>)}</ul>;
  };
  return <>
    {needsSizeEdit.length > 0 && <section className="mm-section" aria-label="Mahukad sündmused">
      <p className="mm-notice mm-calendar-error" role="alert">Sündmus on sünkroonimiseks liiga mahukas. Sündmus on seadmes alles.</p>
      <p className="mm-footnote">Lühenda sündmuse või muudetud üksikkordade märkmeid ja salvesta. Sünkroonimist proovitakse uuesti.</p>
      {needsSizeEdit.map(event => <SizeRecoveryEvent key={event.id} event={event} onRecover={onRecover} />)}
    </section>}
    {uncertain.size > 0 && <section className="mm-section" aria-label="Kinnitust ootavad muudatused">
      <p className="mm-notice mm-calendar-error" role="alert">Sünkroonimise tulemus pole veel kinnitatud. Kohalik muudatus on alles.</p>
      {titles(uncertain)}
      <button type="button" className="mm-button mm-button-secondary" disabled={!view.ready || view.status === 'syncing'}
        onClick={() => sync.retryUncertain()}>Proovi uuesti</button>
    </section>}
    {conflicts.size > 0 && <section className="mm-section" aria-label="Sündmuste konfliktid">
      <p className="mm-notice mm-calendar-error" role="alert">Sündmust muudeti ka teises seadmes. Sinu kohalik muudatus on alles.</p>
      {titles(conflicts)}
    </section>}
  </>;
}

export function KalenderTab({calendar,sync,onAdd,onOpen,onRecover}) {
  const now=useCalendarNow(), today=localDate(now);
  const [selected,setSelected]=useState(today);
  const days=monthDays(selected);
  const visible=expandOccurrences(calendar.events,days.find(Boolean),days.findLast(Boolean));
  const selectedItems=visible.filter(e=>e.date === selected);
  const agendaFrom=selected === '9999-12-31' ? selected : selected >= today ? addDays(selected,1) : today;
  const agenda=selected === '9999-12-31' ? [] : expandOccurrences(calendar.events,agendaFrom,addMonths(agendaFrom,3));
  return <div className="mm-page">
    <div className="mm-calendar-header">
      <PageHeader title="Kalender" subtitle="Kodu sündmused ühes vaates" />
      <button className="mm-button mm-button-primary" aria-label="Lisa sündmus" disabled={!calendar.writable} onClick={()=>onAdd(selected,setSelected)}>
        <ShellIcon name="add" /><span>Lisa</span>
      </button>
    </div>
    <CalendarError error={calendar.error} />
    <CalendarSyncWarnings sync={sync} events={calendar.events} onRecover={onRecover} />
    <section className="mm-card mm-month" aria-label="Kuukalender">
      <div className="mm-month-heading">
        <button className="mm-button mm-button-secondary" aria-label="Eelmine kuu" disabled={selected.startsWith('1000-01')} onClick={()=>setSelected(addMonths(selected,-1))}><ShellIcon name="back" /></button>
        <div className="mm-month-title">
          <h2>{formatDate(selected,{month:'long',year:'numeric'})}</h2>
          <button className="mm-text-button" onClick={()=>setSelected(today)}>Täna</button>
        </div>
        <button className="mm-button mm-button-secondary" aria-label="Järgmine kuu" disabled={selected.startsWith('9999-12')} onClick={()=>setSelected(addMonths(selected,1))}><ShellIcon name="next" /></button>
      </div>
      <div className="mm-month-grid" aria-hidden="true">{['E','T','K','N','R','L','P'].map((d,i)=><span className="mm-weekday" key={i}>{d}</span>)}</div>
      <div className="mm-month-grid" role="group" aria-label="Kuupäevad">
        {days.map((day,index)=>{
          if(!day) return <span key={`outside-${index}`} />;
          const events=visible.filter(e=>e.date === day);
          const categories=[...new Map(events.map(event=>[event.category,categoryPresentation(event)])).values()];
          const description=events.length ? `, ${events.length} sündmust: ${categories.map(category=>category.label).join(', ')}` : ', sündmusi pole';
          return <button key={day} type="button" data-date={day} aria-pressed={selected === day}
            aria-current={day === today ? 'date' : undefined} aria-label={formatDate(day,{weekday:'long',day:'numeric',month:'long',year:'numeric'})+description}
            className={`mm-day ${day.slice(0,7) !== selected.slice(0,7) ? 'mm-other-month' : ''}`}
            style={categories.length ? {'--day-tint':calendarEventColors(events[0]).tint,'--day-color':calendarEventColors(events[0]).color,'--day-ink':calendarEventInk(events[0])} : undefined}
            onClick={()=>setSelected(day)}>
            <span>{Number(day.slice(8))}</span>
            <span className="mm-day-markers" aria-hidden="true">{categories.length > 0 && <ShellIcon name={categories[0].icon} />}{events.length > 1 && <small>{events.length}</small>}</span>
          </button>;
        })}
      </div>
    </section>
    <section id="selected-events" aria-labelledby="selected-heading" className="mm-section">
      <h2 id="selected-heading" className="mm-selected-heading">{formatDate(selected,{weekday:'long',day:'numeric',month:'long'})}</h2>
      <EventRows items={selectedItems} today={today} now={now} onOpen={item=>onOpen(item,setSelected)} variant="selected" />
      {!selectedItems.length && <div className="mm-card mm-calendar-empty">
        <h3>{calendar.events.length ? 'Sel päeval pole midagi plaanis' : 'Ühtegi sündmust pole veel'}</h3>
        <p>{calendar.events.length ? 'Lisa siia kodu jaoks oluline tegevus.' : 'Lisa esimene pereplaan, trenn või prügipäev.'}</p>
        <button className="mm-button mm-button-secondary" disabled={!calendar.writable} onClick={()=>onAdd(selected,setSelected)}>{calendar.events.length ? 'Lisa sündmus siia' : 'Lisa esimene sündmus'}</button>
      </div>}
    </section>
    <div className="mm-calendar-legend" aria-label="Kalendri kategooriad">{Object.entries(CATEGORIES).map(([key,c])=><span key={key} style={{color:AV.textSoft,background:CALENDAR_COLORS[key].tint,'--event-color':CALENDAR_COLORS[key].color}}><ShellIcon name={key} />{c.label}</span>)}</div>
    {agenda.length > 0 && <p className="mm-footnote">Järgmised kolm kuud</p>}
    {['Sel nädalal','Järgmisel nädalal','Hiljem'].map(group=>{
      const items=agenda.filter(e=>agendaGroup(e.date,today) === group);
      if(!items.length) return null;
      return <section className="mm-section" key={group} aria-label={group}>
        <h2 className="mm-section-label">{group}</h2>
        <EventRows items={items.slice(0,20)} today={today} now={now} onOpen={item=>onOpen(item,setSelected)} variant="agenda" />
        {items.length > 20 && <p className="mm-footnote">Veel {items.length-20} sündmust. Vali kuupäev kuukalendrist.</p>}
      </section>;
    })}
  </div>;
}
