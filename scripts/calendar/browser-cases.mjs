import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function runCalendarChecks({t,nav,click,input,evaluate,waitFor,body,send,readCalendarEvents,calendarRaw,corruptCalendar,repairCalendar,failWrites,restoreWrites}) {
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const select = async (id,value) => {
    await evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor(`document.getElementById(${JSON.stringify(id)}).value === ${JSON.stringify(value)}`);
  };
  // The shared calendar of the ACTIVE runtime (LEGACY localStorage or READY IndexedDB), never a frozen legacy copy.
  const storage = async () => ({events:await readCalendarEvents()});
  const openEvent = async title => {
    await evaluate(`[...document.querySelectorAll('[data-occurrence]')].find(b=>b.textContent.includes(${JSON.stringify(title)})).click()`);
    await waitFor("!!document.querySelector('dialog[open]')");
  };
  await t.test('MJM02 zero-event view and Home add create a real persisted waste event',async()=>{
    await nav('Kalender');assert.match(await body(),/Ühtegi sündmust pole veel/);
    await nav('Kodu');await click('Lisa sündmus');
    await waitFor("!!document.querySelector('#event-title')");
    assert.equal(await evaluate("document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth"),true);
    assert.equal(await evaluate("document.querySelector('dialog').contains(document.activeElement)"),true);
    await input('#event-title','Biojäätmed');await select('event-category','waste');await select('event-subtype','bio');
    await input('#event-date','2026-09-14');await input('#event-time','09:00');await select('event-reminder','3');
    await click('Salvesta sündmus');await waitFor("!document.querySelector('dialog[open]')");
    assert.match(await evaluate("document.querySelector('[aria-labelledby=upcoming-heading]').innerText"),/Biojäätmed/);
    const saved=await storage();assert.equal(saved.events.length,1);assert.equal(saved.events[0].source,'manual');
    assert.deepEqual(saved.events[0].reminder,{daysBefore:3});
    if(process.env.MJM_SCREENSHOTS) {
      const shot=await send('Page.captureScreenshot',{format:'png'});
      writeFileSync(join(process.env.MJM_SCREENSHOTS,'Home-events.png'),Buffer.from(shot.data,'base64'));
    }
  });
  await t.test('MJM02 selected day, category marker, reload persistence and edit',async()=>{
    await nav('Kalender');assert.match(await evaluate("document.querySelector('#selected-events').innerText"),/Biojäätmed/);
    assert.ok(await evaluate("document.querySelector('[data-date=\"2026-09-14\"]').getAttribute('aria-label').includes('Prügivedu')"));
    await send('Page.reload');await waitFor("!!document.querySelector('nav')");await nav('Kalender');
    await openEvent('Biojäätmed');await click('Muuda');await input('#event-title','Paberivedu');
    if(process.env.MJM_SCREENSHOTS) {
      const shot=await send('Page.captureScreenshot',{format:'png'});
      writeFileSync(join(process.env.MJM_SCREENSHOTS,'Edit-event.png'),Buffer.from(shot.data,'base64'));
    }
    await select('event-subtype','paper');await click('Salvesta sündmus');
    await waitFor("!document.querySelector('dialog[open]')");
    assert.match(await evaluate("document.querySelector('#selected-events').innerText"),/Paberivedu/);
    assert.equal((await storage()).events[0].subtype,'paper');
  });
  await t.test('MJM02 recurring future date, explicit occurrence edit and one-occurrence deletion',async()=>{
    await click('Lisa sündmus');await input('#event-title','Iganädalane hooldus');await select('event-category','maintenance');
    await input('#event-date','2026-09-14');await select('event-repeat','weekly');await click('Salvesta sündmus');
    await waitFor("!document.querySelector('dialog[open]')");
    await evaluate("document.querySelector('[data-date=\"2026-09-21\"]').click()");
    await waitFor("document.querySelector('#selected-events').innerText.includes('Iganädalane hooldus')");
    await openEvent('Iganädalane hooldus');await click('Muuda');
    assert.match(await body(),/Ainult see kord/);await click('Ainult see kord');
    await input('#event-title','Eriline hooldus');await click('Salvesta sündmus');
    await waitFor("!document.querySelector('dialog[open]')");
    await openEvent('Eriline hooldus');await click('Kustuta');await click('Ainult see kord');
    await click('Kinnita kustutamine');await waitFor("!document.querySelector('dialog[open]')");
    assert.doesNotMatch(await evaluate("document.querySelector('#selected-events').innerText"),/Eriline hooldus/);
    const series=(await storage()).events.find(e=>e.title==='Iganädalane hooldus');
    assert.deepEqual(series.excludedDates,['2026-09-21']);
    await evaluate("document.querySelector('[data-date=\"2026-09-28\"]').click()");
    await waitFor("document.querySelector('#selected-events').innerText.includes('Iganädalane hooldus')");
  });
  await t.test('MJM02 entire-series edit is explicit and month navigation preserves derived results',async()=>{
    await openEvent('Iganädalane hooldus');await click('Muuda');await click('Kogu sari');
    assert.match(await body(),/Alguskuupäeva või korduse muutmine eemaldab/);
    await input('#event-time','10:30');await click('Salvesta sündmus');
    await waitFor("!document.querySelector('dialog[open]')");
    const series=(await storage()).events.find(e=>e.title==='Iganädalane hooldus');
    assert.equal(series.time,'10:30');assert.deepEqual(series.excludedDates,['2026-09-21']);
    await evaluate("document.querySelector('[aria-label=\"Järgmine kuu\"]').click()");
    await waitFor("!!document.querySelector('[data-date=\"2026-10-12\"]')");
    await evaluate("document.querySelector('[data-date=\"2026-10-12\"]').click()");
    await waitFor("document.querySelector('#selected-events').innerText.includes('10:30')");
    if(process.env.MJM_SCREENSHOTS) {
      const shot=await send('Page.captureScreenshot',{format:'png'});
      writeFileSync(join(process.env.MJM_SCREENSHOTS,'Calendar-events.png'),Buffer.from(shot.data,'base64'));
    }
  });
  await t.test('MJM02 entire-series delete and standalone delete update Home with no phantom rows',async()=>{
    await openEvent('Iganädalane hooldus');await click('Kustuta');await click('Kogu sari');await click('Kinnita kustutamine');
    await waitFor("!document.querySelector('dialog[open]')");assert.equal((await storage()).events.length,1);
    await nav('Kodu');await openEvent('Paberivedu');await click('Kustuta');await click('Kinnita kustutamine');
    await waitFor("!document.querySelector('dialog[open]')");assert.equal((await storage()).events.length,0);
    assert.equal(await evaluate("document.querySelectorAll('[aria-labelledby=upcoming-heading] [data-occurrence]').length"),0);
  });
  await t.test('MJM02 failed save retains the form, Escape cancels, malformed storage is not overwritten',async()=>{
    await nav('Kodu');await click('Lisa sündmus');await input('#event-title','Ei salvestatud');
    const persisted=await calendarRaw();
    await failWrites('calendar');
    try {
      await click('Salvesta sündmus');await waitFor("document.body.innerText.includes('Salvestamine ebaõnnestus')");
      assert.match(await body(),/Kontrolli seadme salvestusruumi/);
      assert.equal(await evaluate("!!document.querySelector('dialog[open]')"),true,'the dialog stays open after a failed save');
      assert.equal(await evaluate("document.querySelector('#event-title').value"),'Ei salvestatud');
      assert.equal(await calendarRaw(),persisted,'the previous persisted calendar is untouched');
      assert.equal((await storage()).events.length,0);
    } finally { await restoreWrites(); }
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await waitFor("!document.querySelector('dialog[open]')");
    await corruptCalendar();
    const corrupt=await calendarRaw();
    await send('Page.reload');await waitFor("!!document.querySelector('nav')");
    assert.match(await body(),/Kalendri andmeid ei saanud lugeda/);await nav('Kalender');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Lisa sündmus\"]').disabled"),true);
    assert.equal(await calendarRaw(),corrupt,'an unreadable calendar is never overwritten');
    await repairCalendar();
    await send('Page.reload');await waitFor("!!document.querySelector('nav')");
  });
}
