import { useEffect, useState } from 'react';
import { CalendarError } from './CalendarEvents';

export function NotificationSettings({reminders}) {
  const {service,preferences,delivery}=reminders;
  const [capability,setCapability]=useState(()=>service.getNotificationCapability());
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const refresh=()=>setCapability(service.getNotificationCapability());
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return ()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[service]);
  function save(patch) {try {reminders.save(patch);setError('');} catch(failure) {setError(failure.message);}}
  async function enable() {
    setBusy(true);setError('');
    try {
      const next=await service.requestNotificationPermission({userInitiated:true});setCapability(next);
      if(next.permission === 'granted') reminders.save({systemEnabled:true});
    } catch(failure) {setError(failure.message);} finally {setBusy(false);}
  }
  const status={unsupported:'Seadme teavitused pole selles brauseris toetatud.',default:'Teavituste luba pole veel küsitud.',
    granted:'Brauseri teavituste luba on antud.',denied:'Brauser on teavitused keelanud. Luba saad muuta brauseri seadetes.'};
  const deliveryReady=delivery.load().writable;
  return <section className="mm-settings-group" id="teavitused" aria-labelledby="notifications-heading">
    <h2 className="mm-section-label" id="notifications-heading">Teavitused</h2>
    <div className="mm-card mm-notification-settings">
      <h3>Meeldetuletused sinu kodu jaoks</h3>
      <p>Meeldetuletused äpis töötavad ka seadme teavitusteta.</p>
      <p role="status">{status[capability.permission]}</p>
      {capability.supported && !capability.activeDelivery && <p>Turvaline korduste vältimine pole siin saadaval. Kasuta meeldetuletusi äpis.</p>}
      <CalendarError error={preferences.error || error} />
      {!deliveryReady && <p className="mm-notice">Saatmisajalugu ei saanud lugeda. Seadme teavitused on peatatud, et vältida kordusi; sündmused jäävad alles.</p>}
      {capability.activeDelivery && !preferences.systemEnabled && ['default','granted'].includes(capability.permission) &&
        <button className="mm-button mm-button-primary" disabled={busy || !preferences.writable || !deliveryReady} onClick={enable}>{busy ? 'Ootan brauseri vastust…' : 'Luba seadme teavitused'}</button>}
      {preferences.systemEnabled && <button className="mm-button mm-button-secondary" onClick={()=>save({systemEnabled:false})}>Lülita seadme teavitused välja</button>}
      <label className="mm-field" htmlFor="default-reminder">Uue sündmuse vaikimisi meeldetuletus
        <select id="default-reminder" value={preferences.defaultDaysBefore} disabled={!preferences.writable} onChange={e=>save({defaultDaysBefore:Number(e.target.value)})}>
          {[[0,'Puudub'],[1,'1 päev enne'],[3,'3 päeva enne'],[7,'1 nädal enne']].map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <details>
        <summary>Kuidas meeldetuletused töötavad</summary>
        <p className="mm-footnote">Seadme teavitus, kui brauser/seade seda toetab. Proovime saata ainult siis, kui äpp on avatud ja nähtav ning teenusetöötaja on valmis. Suletud äpis ega taustal saatmist ei lubata.</p>
        <p className="mm-footnote">Kuupäevaga sündmuse meeldetuletus algab kell 09:00; kellaajaga sündmusel sama kellaaja võrra valitud päevad varem. Sündmuse möödumisel uut seadme teavitust ei saadeta.</p>
        <p className="mm-footnote">Kehtib ainult uue käsitsi lisatava sündmuse loomisel. Olemasolev valik, ka „Puudub”, jääb alati alles.</p>
      </details>
    </div>
  </section>;
}
