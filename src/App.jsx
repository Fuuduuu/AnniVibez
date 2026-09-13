import { useState } from 'react';
import { AV, FONT } from './design/tokens';
import { BussTab } from './components/BussTab';
import LooTab from './components/LooTab';
import { PaeviikTab } from './components/PaeviikTab';
import { SeadedTab } from './components/SeadedTab';
import { KoduTab, VeelTab } from './components/ShellViews';
import { KalenderTab } from './components/KalenderTab';
import { EventDialog } from './components/EventDialog';
import { useHouseholdEvents } from './calendar/useHouseholdEvents';
import { ShellIcon } from './components/ShellIcon';
import { useSettings } from './hooks/useSettings';
import { useSavedPlaces } from './hooks/useSavedPlaces';
import './design/shell.css';
import './design/calendar.css';

const TABS = [
  { id: 'kodu', label: 'Kodu' },
  { id: 'kalender', label: 'Kalender' },
  { id: 'buss', label: 'Buss' },
  { id: 'veel', label: 'Veel' },
  { id: 'seaded', label: 'Seaded' },
];

export default function MajamajandusApp() {
  const [tab, setTab] = useState('kodu');
  const [settingsSection, setSettingsSection] = useState(null);
  const [eventSelection, setEventSelection] = useState(null);
  const calendar = useHouseholdEvents();
  const { profile, saveName } = useSettings();
  const { places, update: updatePlace } = useSavedPlaces();
  const active = ['loo', 'paevik'].includes(tab) ? 'veel' : tab;

  function navigate(next, section = null) {
    setEventSelection(null);
    setSettingsSection(section);
    setTab(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  const openAdd = (date,onSaved) => setEventSelection({date,onSaved});
  const openEvent = (item,onSaved) => setEventSelection({item,onSaved});

  return (
    <div data-app-shell style={{
      '--mm-bg': AV.bg, '--mm-surface': AV.card, '--mm-secondary': AV.bgWarm,
      '--mm-tint': AV.primaryTint, '--mm-primary': AV.primary, '--mm-strong': AV.primaryStrong,
      '--mm-ink': AV.text, '--mm-soft': AV.textSoft, '--mm-muted': AV.muted,
      '--mm-border': AV.border, '--mm-border-strong': AV.borderStrong,
      '--mm-shadow': AV.shadow, '--mm-display': FONT.display,
      fontFamily: FONT.body, backgroundColor: AV.bg, color: AV.text,
    }}>
      <main key={tab} id="main-content" className="mm-main">
        {['loo', 'paevik'].includes(tab) && (
          <div className="mm-back">
            <button className="mm-button mm-button-secondary" onClick={() => navigate('veel')}>
              <ShellIcon name="back" />Tagasi: Veel
            </button>
          </div>
        )}
        {tab === 'kodu' && <KoduTab savedPlaces={places} onNavigate={navigate} calendar={calendar} onAdd={openAdd} onOpen={openEvent} />}
        {tab === 'kalender' && <KalenderTab calendar={calendar} onAdd={openAdd} onOpen={openEvent} />}
        {tab === 'buss' && <BussTab savedPlaces={places} />}
        {tab === 'veel' && <VeelTab onNavigate={navigate} />}
        {tab === 'loo' && <LooTab />}
        {tab === 'paevik' && <PaeviikTab />}
        {tab === 'seaded' && <SeadedTab profile={profile} saveName={saveName} places={places}
          updatePlace={updatePlace} initialSection={settingsSection} />}
      </main>
      {eventSelection && <EventDialog selection={eventSelection} calendar={calendar} onClose={() => setEventSelection(null)} />}
      <nav className="mm-nav" aria-label="Põhinavigatsioon">
        <div className="mm-nav-inner">
          {TABS.map(t => <button key={t.id} type="button" aria-current={active === t.id ? 'page' : undefined}
            onClick={() => navigate(t.id)}>
            <span className="mm-nav-icon"><ShellIcon name={t.id} /></span>
            <span>{t.label}</span>
          </button>)}
        </div>
      </nav>
    </div>
  );
}
