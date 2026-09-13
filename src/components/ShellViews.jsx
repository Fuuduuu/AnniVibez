import { BussCard } from './BussCard';
import { ShellIcon } from './ShellIcon';
import { EventRows, CalendarError } from './CalendarEvents';
import { homeOccurrences } from '../reminders/due';
import { localDate } from '../calendar/dates';
import { useCalendarNow } from '../calendar/useCalendarNow';

export function PageHeader({ title, subtitle }) {
  return <header className="mm-page-header">
    <h1>{title}</h1>
    <p>{subtitle}</p>
  </header>;
}

export function KoduTab({ savedPlaces, onNavigate, calendar, onAdd, onOpen }) {
  const now = useCalendarNow();
  const today = localDate(now);
  const upcoming = homeOccurrences(calendar.events, now);
  const date = now.toLocaleDateString('et-EE', { weekday: 'long', day: 'numeric', month: 'long' });
  return <div className="mm-page">
    <header className="mm-home-header">
      <span className="mm-mark" aria-hidden="true">MM</span>
      <div><h1>Majamajandus</h1><p className="mm-date">{date}</p></div>
    </header>
    <section className="mm-section" aria-labelledby="upcoming-heading">
      <div className="mm-section-heading">
        <h2 id="upcoming-heading">Tulemas</h2>
        <button className="mm-text-button" onClick={() => onNavigate('kalender')}>Kogu kalender</button>
      </div>
      <CalendarError error={calendar.error} />
      <EventRows items={upcoming} today={today} now={now} onOpen={onOpen} variant="home" />
      {!upcoming.length && <div className="mm-card mm-welcome">
        <span className="mm-icon-tile"><ShellIcon name="kodu" /></span>
        <h3>Paneme sinu kodu asjad ritta</h3>
        <p>Lähenevaid sündmusi pole. Lisa kalendrisse hooldus, makse või prügipäev.</p>
      </div>}
    </section>
    <section className="mm-section" aria-labelledby="home-bus-heading">
      <h2 className="mm-section-label" id="home-bus-heading">Buss praegu</h2>
      <BussCard savedPlaces={savedPlaces} onOpenBuss={() => onNavigate('buss')} />
    </section>
    <section className="mm-section" aria-labelledby="quick-heading">
      <h2 className="mm-section-label" id="quick-heading">Kiirtoimingud</h2>
      <div className="mm-quick-grid">
        <button className="mm-button mm-button-primary mm-wide" disabled={!calendar.writable} onClick={() => onAdd(today)}>
          <ShellIcon name="add" />Lisa sündmus
        </button>
        <button className="mm-button mm-button-secondary" onClick={() => onNavigate('kalender')}>
          <ShellIcon name="kalender" />Kalender
        </button>
        <button className="mm-button mm-button-secondary" onClick={() => onNavigate('seaded', 'prugivedu')}>
          <ShellIcon name="waste" />Prügivedu
        </button>
        <button className="mm-button mm-button-secondary mm-wide" onClick={() => onNavigate('buss')}>
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
