import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function runCalendarChecks({t,nav,click,input,evaluate,waitFor,body,send,mode,seedCalendar,readCalendarEvents,calendarRaw,corruptCalendar,repairCalendar,failWrites,restoreWrites}) {
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
  await t.test('categories V2 picker creates a reusable color snapshot and deleting the choice preserves the event',async()=>{
    await nav('Kalender');await click('Lisa sündmus');await input('#event-title','Koerte trenn');
    assert.deepEqual(await evaluate("[...document.querySelector('#event-category').options].map(option=>option.textContent)"),
      ['Kultuur','Sünnipäevad','Trenn','Prügivedu','Majahaldus','Auto','Üldine']);
    await click('Lisa kategooria');
    await waitFor("!!document.querySelector('#category-name')");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-category-dialog')).backgroundColor"),'rgb(244, 245, 242)');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-category-dialog')).fontFamily === getComputedStyle(document.querySelector('[data-app-shell]')).fontFamily"),true);
    await input('#category-name','Koertekool');await input('#category-color','#7a5cc8');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-category-dialog .mm-category-preview')).backgroundColor"),'rgb(236, 232, 247)');
    if(process.env.MJM_SCREENSHOTS) {
      const shot=await send('Page.captureScreenshot',{format:'png'});
      writeFileSync(join(process.env.MJM_SCREENSHOTS,`Category-new-${mode}.png`),Buffer.from(shot.data,'base64'));
    }
    await click('Salvesta kategooria');
    await waitFor("!document.querySelector('#category-name')");
    const category = await evaluate("document.querySelector('#event-category').value");
    assert.match(category,/^custom:/);
    assert.match(await evaluate("document.querySelector('.mm-category-preview').innerText"),/Koertekool/);
    await input('#event-date','2026-09-14');await click('Salvesta sündmus');
    await waitFor("!document.querySelector('dialog[open]')");
    const saved = (await storage()).events.find(event=>event.title==='Koerte trenn');
    assert.equal(saved.categoryLabel,'Koertekool');assert.equal(saved.categoryColor,'#7A5CC8');
    assert.match(await evaluate("document.querySelector('#selected-events').innerText"),/Koertekool/);
    assert.equal(await evaluate("document.querySelector('#selected-events [data-occurrence]').style.getPropertyValue('--event-color')"),'#7A5CC8');
    await evaluate("document.querySelector('[data-date=\"2026-09-13\"]').click()");
    await waitFor("document.querySelector('[data-date=\"2026-09-13\"]').getAttribute('aria-pressed') === 'true'");
    await evaluate("Promise.all(document.querySelector('[data-date=\"2026-09-14\"]').getAnimations().map(animation=>animation.finished.catch(()=>{}))).then(()=>true)");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-date=\"2026-09-14\"]')).backgroundColor"),'rgb(236, 232, 247)');
    assert.match(await evaluate("document.querySelector('.mm-agenda-row').textContent"),/Koertekool/);
    assert.equal(await evaluate("document.querySelector('.mm-agenda-row').style.getPropertyValue('--event-color')"),'#7A5CC8');
    await nav('Kodu');
    assert.match(await evaluate("document.querySelector('.mm-events-home').innerText"),/Koertekool/);
    assert.equal(await evaluate("document.querySelector('.mm-events-home [data-occurrence]').style.getPropertyValue('--event-color')"),'#7A5CC8');
    await send('Page.reload');await waitFor("!!document.querySelector('nav')");await nav('Kalender');
    await click('Lisa sündmus');
    assert.equal(await evaluate(`[...document.querySelector('#event-category').options].some(option=>option.value===${JSON.stringify(category)})`),true);
    await click('Halda kategooriaid');await click('Kustuta kategooria Koertekool');await click('Valmis');
    assert.equal(await evaluate(`[...document.querySelector('#event-category').options].some(option=>option.value===${JSON.stringify(category)})`),false);
    await click('Tühista');
    assert.equal((await storage()).events.find(event=>event.id===saved.id).categoryColor,'#7A5CC8');
    await openEvent('Koerte trenn');await click('Muuda');
    assert.equal(await evaluate("document.querySelector('#event-category').value"),category);
    await select('event-category','culture');await click('Salvesta sündmus');
    await waitFor("!document.querySelector('dialog[open]')");
    const changed = (await storage()).events.find(event=>event.id===saved.id);
    assert.equal(changed.category,'culture');assert.equal(changed.categoryLabel,null);assert.equal(changed.categoryColor,null);
    await openEvent('Koerte trenn');await click('Kustuta');await click('Kinnita kustutamine');
    await waitFor("!document.querySelector('dialog[open]')");
  });
  await t.test('categories V2 old payloads render and payment edits migrate only the selected event',async()=>{
    const events=['payment','maintenance','waste','general'].map(category=>({id:`legacy-${category}`,title:`Vana ${category}`,
      category,subtype:category==='waste'?'paper':null,date:'2026-09-14',time:null,recurrence:{frequency:'none',interval:1},
      reminder:{daysBefore:0},source:'manual',householdId:null,notes:'',seriesId:null,excludedDates:[],overrides:{}}));
    await seedCalendar(events);
    const before=await calendarRaw();
    await send('Page.reload');await waitFor("!!document.querySelector('nav')");await nav('Kalender');
    assert.equal(await evaluate("document.querySelectorAll('#selected-events [data-occurrence]').length"),4);
    assert.match(await evaluate("document.querySelector('#selected-events').innerText"),/Majahaldus/);
    assert.match(await evaluate("document.querySelector('#selected-events').innerText"),/Paber ja papp/);
    assert.equal(await calendarRaw(),before,'ordinary legacy reads and rendering do not rewrite any calendar bytes');
    await openEvent('Vana payment');
    assert.match(await evaluate("document.querySelector('.mm-category-detail').innerText"),/Üldine/);
    await click('Muuda');
    assert.equal(await evaluate("document.querySelector('#event-category').value"),'general');
    assert.equal(await evaluate("[...document.querySelector('#event-category').options].some(option=>option.value==='payment')"),false);
    await input('#event-title','Muudetud vana sündmus');await click('Salvesta sündmus');
    await waitFor("!document.querySelector('dialog[open]')");
    const after=await readCalendarEvents();
    assert.equal(after.find(event=>event.id==='legacy-payment').category,'general');
    for(const original of events.filter(event=>event.category!=='payment')) assert.deepEqual(after.find(event=>event.id===original.id),original);
    await seedCalendar([]);await send('Page.reload');await waitFor("!!document.querySelector('nav')");
  });
}
