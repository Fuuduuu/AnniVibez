import { useState } from 'react';
import { PageHeader } from './ShellViews';
import { ShellIcon } from './ShellIcon';
import { EventRows, CalendarError } from './CalendarEvents';
import { CATEGORIES } from '../calendar/eventModel';
import { expandOccurrences } from '../calendar/recurrence';
import { addDays, addMonths, agendaGroup, formatDate, localDate, monthDays } from '../calendar/dates';
import { useCalendarNow } from '../calendar/useCalendarNow';

export function KalenderTab({calendar,onAdd,onOpen}) {
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
          const categories=[...new Set(events.map(e=>e.category))];
          const description=events.length ? `, ${events.length} sündmust: ${categories.map(c=>CATEGORIES[c].label).join(', ')}` : ', sündmusi pole';
          return <button key={day} type="button" data-date={day} aria-pressed={selected === day}
            aria-current={day === today ? 'date' : undefined} aria-label={formatDate(day,{weekday:'long',day:'numeric',month:'long',year:'numeric'})+description}
            className={`mm-day ${day.slice(0,7) !== selected.slice(0,7) ? 'mm-other-month' : ''}`}
            style={categories.length ? {'--day-tint':CATEGORIES[categories[0]].tint,'--day-color':CATEGORIES[categories[0]].color} : undefined}
            onClick={()=>setSelected(day)}>
            <span>{Number(day.slice(8))}</span>
            <span className="mm-day-markers" aria-hidden="true">{categories.length > 0 && <ShellIcon name={categories[0]} />}{events.length > 1 && <small>{events.length}</small>}</span>
          </button>;
        })}
      </div>
    </section>
    <section id="selected-events" aria-labelledby="selected-heading" className="mm-section">
      <h2 id="selected-heading" className="mm-selected-heading">{formatDate(selected,{weekday:'long',day:'numeric',month:'long'})}</h2>
      <EventRows items={selectedItems} today={today} now={now} onOpen={item=>onOpen(item,setSelected)} variant="selected" />
      {!selectedItems.length && <div className="mm-card mm-calendar-empty">
        <h3>{calendar.events.length ? 'Sel päeval pole midagi plaanis' : 'Ühtegi sündmust pole veel'}</h3>
        <p>{calendar.events.length ? 'Lisa siia kodu jaoks oluline tegevus.' : 'Lisa esimene hooldus, makse või prügipäev.'}</p>
        <button className="mm-button mm-button-secondary" disabled={!calendar.writable} onClick={()=>onAdd(selected,setSelected)}>{calendar.events.length ? 'Lisa sündmus siia' : 'Lisa esimene sündmus'}</button>
      </div>}
    </section>
    <div className="mm-calendar-legend">{Object.entries(CATEGORIES).map(([key,c])=><span key={key} style={{color:c.color,background:c.tint}}>{c.label}</span>)}</div>
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
