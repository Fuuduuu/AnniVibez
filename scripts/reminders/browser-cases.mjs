import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function runReminderChecks({t,nav,click,input,evaluate,waitFor,body,send}) {
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const screenshot=async name=>{
    if(!process.env.MJM_SCREENSHOTS) return;
    const shot=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(process.env.MJM_SCREENSHOTS,name+'.png'),Buffer.from(shot.data,'base64'));
  };
  const select=async(id,value)=>evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const count=()=>evaluate("Number(sessionStorage.getItem('notificationCalls')||0)");
  const reload=async()=>{await send('Page.reload');await waitFor("!!document.querySelector('nav')");};
  await t.test('MJM04 unsupported is understandable, in-app reminders remain available, no startup prompt',async()=>{
    assert.equal(await evaluate("Number(sessionStorage.getItem('permissionCalls')||0)"),0);
    await nav('Seaded');assert.match(await body(),/Seadme teavitused pole selles brauseris toetatud/);
    assert.match(await body(),/Meeldetuletused äpis töötavad/);
    await select('default-reminder','3');
    await waitFor("JSON.parse(localStorage.getItem('majamajandus_reminder_preferences_v1')).defaultDaysBefore===3");
  });
  await t.test('MJM04 new default applies, explicit none persists and is not reactivated',async()=>{
    await nav('Kodu');await click('Lisa sündmus');await waitFor("!!document.querySelector('#event-reminder')");
    assert.equal(await evaluate("document.querySelector('#event-reminder').value"),'3');
    await input('#event-title','Ilma meeldetuletuseta');await input('#event-date','2026-09-15');await select('event-reminder','0');
    await click('Salvesta sündmus');await waitFor("!document.querySelector('dialog[open]')");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('majamajandus_household_events_v1')).events[0].reminder.daysBefore"),0);
    assert.equal(await evaluate("document.querySelector('[data-reminder-state=due]')"),null);
  });
  await t.test('MJM04 due Home/detail status reflects real waste and future reminders stay future',async()=>{
    await click('Lisa sündmus');await input('#event-title','Bio homme');await input('#event-date','2026-09-15');await input('#event-time','06:00');
    await select('event-category','waste');await select('event-subtype','bio');await select('event-reminder','1');
    await click('Salvesta sündmus');await waitFor("!!document.querySelector('[data-reminder-state=due]')");
    assert.match(await body(),/Meeldetuletus käes/);
    await evaluate("[...document.querySelectorAll('[data-occurrence]')].find(b=>b.textContent.includes('Bio homme')).click()");
    await waitFor("!!document.querySelector('dialog[open]')");assert.match(await evaluate("document.querySelector('dialog').innerText"),/Meeldetuletus käes/);await click('Tühista');
    await click('Lisa sündmus');await input('#event-title','Tulevane hooldus');await input('#event-date','2026-09-20');await select('event-reminder','1');
    await click('Salvesta sündmus');await waitFor("!document.querySelector('dialog[open]')");
    assert.equal(await evaluate("[...document.querySelectorAll('[data-occurrence]')].find(b=>b.textContent.includes('Tulevane hooldus')).querySelector('[data-reminder-state=due]')"),null);
    assert.equal(await count(),0);
    await screenshot('Home-reminders');
  });
  await t.test('MJM04 only explicit enable requests permission; denied does not break navigation',async()=>{
    await evaluate("sessionStorage.setItem('notificationMode','default');sessionStorage.setItem('permissionAnswer','denied')");await reload();
    assert.equal(await evaluate("Number(sessionStorage.getItem('permissionCalls')||0)"),0);
    await nav('Seaded');await click('Luba seadme teavitused');await waitFor("document.body.innerText.includes('Brauser on teavitused keelanud')");
    assert.equal(await evaluate("Number(sessionStorage.getItem('permissionCalls')||0)"),1);assert.equal(await count(),0);
    await nav('Kodu');assert.match(await body(),/Bio homme/);
  });
  await t.test('MJM04 explicit grant delivers one due occurrence and reload cannot duplicate it',async()=>{
    await evaluate("sessionStorage.setItem('notificationMode','default');sessionStorage.setItem('permissionAnswer','granted')");await reload();await nav('Seaded');
    await click('Luba seadme teavitused');await waitFor("Number(sessionStorage.getItem('notificationCalls')||0)===1");
    await evaluate("document.querySelector('#teavitused').scrollIntoView({block:'start'})");await screenshot('Notification-settings');
    assert.equal(await evaluate("Object.keys(JSON.parse(localStorage.getItem('majamajandus_reminder_delivery_v1')).records).length"),1);
    await reload();await nav('Seaded');await nav('Kodu');assert.equal(await count(),1);
    await nav('Seaded');await click('Lülita seadme teavitused välja');
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('majamajandus_reminder_preferences_v1')).systemEnabled"),false);
  });
  await t.test('MJM04 malformed delivery state does not wipe events or prevent calendar CRUD',async()=>{
    await evaluate("localStorage.setItem('majamajandus_reminder_delivery_v1','{broken')");await reload();await nav('Seaded');
    assert.match(await body(),/Saatmisajalugu ei saanud lugeda/);
    await nav('Kalender');await evaluate("[...document.querySelectorAll('[data-occurrence]')].find(b=>b.textContent.includes('Bio homme')).click()");
    await click('Muuda');await input('#event-title','Bio muudetud');await click('Salvesta sündmus');await waitFor("!document.querySelector('dialog[open]')");
    assert.equal(await evaluate("localStorage.getItem('majamajandus_reminder_delivery_v1')"),'{broken');
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('majamajandus_household_events_v1')).events.length"),3);
    await evaluate("localStorage.removeItem('majamajandus_reminder_delivery_v1')");
  });
  await t.test('MJM04 revoked permission does not reserve or rewrite delivery history',async()=>{
    await evaluate("sessionStorage.setItem('notificationMode','denied');const prefs=JSON.parse(localStorage.getItem('majamajandus_reminder_preferences_v1'));prefs.systemEnabled=true;localStorage.setItem('majamajandus_reminder_preferences_v1',JSON.stringify(prefs))");
    await reload();await nav('Seaded');
    assert.equal(await evaluate("localStorage.getItem('majamajandus_reminder_delivery_v1')"),null);
    await click('Lülita seadme teavitused välja');
  });
}
