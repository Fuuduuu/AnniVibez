import { BussCard } from './BussCard';
import { ShellIcon } from './ShellIcon';
import { calendarEventColors, calendarEventInk } from '../design/tokens';
import { categoryPresentation } from '../calendar/categoryModel.js';
import { EventRows, CalendarError } from './CalendarEvents';
import { homeOccurrences } from '../reminders/due';
import { expandOccurrences } from '../calendar/recurrence';
import { localDate } from '../calendar/dates';
import { useCalendarNow } from '../calendar/useCalendarNow';
import { TimetableHomeCard } from './TimetableHomeCard';

export function PageHeader({ title, subtitle }) {
  return <header className="mm-page-header">
    <h1>{title}</h1>
    <p>{subtitle}</p>
  </header>;
}

export function KoduTab({ savedPlaces, onNavigate, calendar, onAdd, onOpen, timetable, homework }) {
  const now = useCalendarNow();
  const today = localDate(now);
  const todayItems = expandOccurrences(calendar.events, today, today);
  const upcoming = homeOccurrences(calendar.events, now);
  const date = now.toLocaleDateString('et-EE', { weekday: 'long', day: 'numeric', month: 'long' });
  return <div className="mm-page">
    <header className="mm-home-header">
      <span className="mm-mark" aria-hidden="true">MM</span>
      <div><h1>Majamajandus</h1><p className="mm-date">{date}</p></div>
    </header>
    <section className="mm-card mm-today" aria-labelledby="today-heading">
      <h2 id="today-heading" className="mm-section-label">Täna kodus</h2>
      {calendar.error ? <p>Kalendri ülevaade pole praegu saadaval.</p> : <>
        <p className="mm-today-total"><strong>{todayItems.length}</strong><span>{todayItems.length === 1 ? 'sündmus täna' : 'sündmust täna'}</span></p>
        <p className="mm-today-summary">{todayItems.length
          ? todayItems.slice(0, 2).map(item => `${item.title}${item.time ? ` kell ${item.time}` : ''}`).join(' · ')
          : 'Täna pole midagi plaanis. Hea hetk järgmised koduasjad paika panna.'}</p>
        {todayItems.length > 0 && <div className="mm-today-events">
          {todayItems.slice(0, 3).map(item => <button key={item.occurrenceId} className="mm-today-chip" style={{'--event-color':calendarEventColors(item).color,'--event-ink':calendarEventInk(item)}} onClick={() => onOpen(item)}>
            <ShellIcon name={categoryPresentation(item).icon} /><span>{item.time && <time dateTime={item.time}>{item.time} </time>}{item.title}</span>
          </button>)}
          {todayItems.length > 3 && <button className="mm-text-button" onClick={() => onNavigate('kalender')}>Veel {todayItems.length - 3} kalendris</button>}
        </div>}
      </>}
    </section>
    <section className="mm-section mm-section-primary" aria-labelledby="upcoming-heading">
      <div className="mm-section-heading">
        <h2 id="upcoming-heading">Tulemas</h2>
        <button className="mm-text-button" onClick={() => onNavigate('kalender')}>Kogu kalender</button>
      </div>
      <CalendarError error={calendar.error} />
      <EventRows items={upcoming} today={today} now={now} onOpen={onOpen} variant="home" />
      {!upcoming.length && <div className="mm-card mm-card-tinted mm-welcome">
        <span className="mm-icon-tile"><ShellIcon name="kodu" /></span>
        <h3>Paneme sinu kodu asjad ritta</h3>
        <p>Lähenevaid sündmusi pole. Lisa kalendrisse pereplaanid või prügipäevad.</p>
        <div className="mm-welcome-actions">
          <button className="mm-button mm-button-primary" onClick={() => onNavigate('seaded', 'prugivedu')}>Leia prügipäevad</button>
          <button className="mm-button mm-button-secondary" disabled={!calendar.writable} onClick={() => onAdd(today)}>Lisa esimene sündmus</button>
        </div>
        <p className="mm-footnote">Kalender töötab ka kohalikult. Pilvesüngi saad soovi korral Seadetes sisse lülitada.</p>
      </div>}
    </section>
    <TimetableHomeCard timetable={timetable} homework={homework} now={now} onOpen={() => onNavigate('tunniplaan')} />
    <section className="mm-section" aria-labelledby="home-bus-heading">
      <h2 className="mm-section-label" id="home-bus-heading">Buss praegu</h2>
      <BussCard savedPlaces={savedPlaces} onOpenBuss={() => onNavigate('buss')} />
    </section>
    <section className="mm-section" aria-labelledby="quick-heading">
      <h2 className="mm-section-label" id="quick-heading">Kiirtoimingud</h2>
      <div className="mm-quick-grid">
        <button className="mm-button mm-button-primary" disabled={!calendar.writable} onClick={() => onAdd(today)}>
          <ShellIcon name="add" />Lisa sündmus
        </button>
        <button className="mm-button mm-button-secondary" onClick={() => onNavigate('kalender')}>
          <ShellIcon name="kalender" />Kalender
        </button>
        <button className="mm-button mm-button-secondary" onClick={() => onNavigate('seaded', 'prugivedu')}>
          <ShellIcon name="waste" />Prügivedu
        </button>
        <button className="mm-button mm-button-secondary" onClick={() => onNavigate('buss')}>
          <ShellIcon name="buss" />Buss
        </button>
      </div>
    </section>
  </div>;
}

export function VeelTab({ onNavigate }) {
  return <div className="mm-page">
    <PageHeader title="Veel" subtitle="Muud tööriistad selles kodus" />
    <div className="mm-card mm-utility-list">
      {[
        { id:'tunniplaan', title:'Tunniplaan', description:'Anni koolinädal, tunnid ja klassiruumid.' },
        { id:'loo', title:'Joonistamine ja loomine', description:'Ideed, joonistamise nipid ja väikesed loovad projektid.' },
        { id:'paevik', title:'Päevik', description:'Sinu mõtted ja päeva hetked, olemasoleva PIN-i taga.' },
      ].map(item => <button key={item.id} className="mm-utility-row" onClick={() => onNavigate(item.id)}>
        <span className="mm-icon-tile"><ShellIcon name={item.id} /></span>
        <span className="mm-utility-copy"><strong>{item.title}</strong><span>{item.description}</span></span>
        <ShellIcon name="next" />
      </button>)}
    </div>
    <p className="mm-footnote">Loo ja Päevik on nüüd siin. Sinu senised salvestused jäävad alles.</p>
  </div>;
}
