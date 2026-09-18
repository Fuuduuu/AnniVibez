import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function runWasteChecks({t,nav,click,input,evaluate,waitFor,body,send,readCalendarEvents,readHouseholdProfile,calendarRaw,householdRaw,corruptHousehold,repairHousehold,failWrites,restoreWrites}) {
  const screenshot=async name=>{
    if(!process.env.MJM_SCREENSHOTS) return;
    await evaluate("document.querySelector('#prugivedu').scrollIntoView({block:'start'})");
    const shot=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(process.env.MJM_SCREENSHOTS,name+'.png'),Buffer.from(shot.data,'base64'));
  };
  const select=async(id,value)=>{
    await evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  };
  const events=readCalendarEvents;
  const editAddress=async(address)=>{
    await evaluate("document.querySelector('#household-profile').open=true");
    await input('#household-address',address);await click('Salvesta majapidamine');
  };
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await t.test('MJM03 no-address state offers address editing and independent manual setup',async()=>{
    await nav('Kodu');await click('Prügivedu');assert.match(await body(),/Lisa aadress/);
    await click('Lisa käsitsi graafik');await waitFor("!!document.querySelector('#event-category')");
    assert.equal(await evaluate("document.querySelector('#event-category').value"),'waste');
    await click('Tühista');await click('Lisa aadress');
    assert.equal(await evaluate("document.activeElement.id"),'household-address');
    await input('#household-name','Meie kodu');await input('#household-address','Testi 1, Rakvere');await click('Salvesta majapidamine');
    assert.match(await body(),/Majapidamine salvestatud/);
    assert.equal(await evaluate("document.querySelector('#household-profile').open"),true);
    await send('Page.reload');await waitFor("!!document.querySelector('nav')");await nav('Seaded');
    assert.equal((await readHouseholdProfile()).address,'Testi 1, Rakvere');
  });
  await t.test('MJM03 unsupported lookup leads to manual recurring waste visible in Calendar and Home',async()=>{
    await click('Leia prügipäevad');await waitFor("document.querySelector('#prugivedu').innerText.includes('ühendatud automaatset allikat')");
    await screenshot('Waste-unsupported');
    await click('Lisa käsitsi graafik');await input('#event-title','Meie paber');await select('event-subtype','paper');
    await input('#event-date','2026-09-14');await select('event-repeat','weekly');await input('#event-interval','2');
    await click('Salvesta sündmus');await waitFor("!document.querySelector('dialog[open]')");
    assert.equal((await events())[0].source,'manual');
    await nav('Kalender');assert.match(await body(),/Meie paber/);
    await evaluate("document.querySelector('[data-date=\"2026-09-28\"]').click()");
    await waitFor("document.querySelector('#selected-events').innerText.includes('Meie paber')");
    await nav('Kodu');assert.match(await evaluate("document.querySelector('[aria-labelledby=upcoming-heading]').innerText"),/Meie paber/);
  });
  await t.test('MJM03 controlled adapter import uses shared calendar storage and idempotent refresh',async()=>{
    await nav('Seaded');await editAddress('Fixture 1');await click('Leia prügipäevad');
    await waitFor("document.querySelector('#prugivedu').innerText.includes('Leitud 1 kogumispäeva')");
    assert.equal((await events()).length,1);
    await click('Impordi kalendrisse');await waitFor("document.querySelector('#prugivedu').innerText.includes('Viimane edukas värskendus')");
    assert.equal((await events()).length,2);assert.equal((await events()).find(e=>e.source==='imported').title,'Allika bio');
    await click('Värskenda graafikut');await waitFor("!document.querySelector('#prugivedu [aria-busy=true]')");
    assert.equal((await events()).length,2);
    await screenshot('Waste-controlled-import');
    await nav('Kalender');await evaluate("document.querySelector('[data-date=\"2026-09-15\"]').click()");
    await waitFor("document.querySelector('#selected-events').innerText.includes('Allika bio')");
    await nav('Kodu');assert.match(await body(),/Allika bio/);
  });
  await t.test('MJM03 imported source fields are read-only while user notes/reminders survive refresh',async()=>{
    await evaluate("[...document.querySelectorAll('[data-occurrence]')].find(b=>b.textContent.includes('Allika bio')).click()");
    await click('Muuda');assert.match(await body(),/allika hallata/);
    assert.equal(await evaluate("document.querySelector('#event-date').matches(':disabled')"),true);
    await select('event-reminder','7');
    await evaluate("(()=>{const el=document.querySelector('#event-notes');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Värav lahti');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await click('Salvesta sündmus');await waitFor("!document.querySelector('dialog[open]')");
    await evaluate("window.wasteReply={entries:[{externalId:'one',title:'Allika paber',subtype:'paper',date:'2026-09-16'}]}");
    await nav('Seaded');await click('Värskenda graafikut');
    await waitFor("document.querySelector('#prugivedu').innerText.includes('Allika paber')");
    const item=(await events()).find(e=>e.source==='imported');assert.equal(item.notes,'Värav lahti');assert.equal(item.reminder.daysBefore,7);
    assert.equal(item.date,'2026-09-16');assert.equal((await events()).filter(e=>e.source==='manual').length,1);
  });
  await t.test('MJM03 error/empty refresh retain prior events and manual fallback; address change rejects stale response',async()=>{
    await evaluate('window.wasteFail=true');await click('Värskenda graafikut');await waitFor("!!document.querySelector('#prugivedu [role=alert]')");
    assert.match(await body(),/Proovi uuesti/);assert.match(await body(),/Lisa käsitsi graafik/);
    await evaluate('window.wasteFail=false;window.wasteReply={entries:[]}');await click('Proovi uuesti');
    await waitFor("document.querySelector('#prugivedu').innerText.includes('Allikas ei tagastanud kogumispäevi')");
    assert.equal((await events()).length,2);
    await evaluate('window.wasteDelay=true');await click('Värskenda graafikut');
    await waitFor("typeof window.resolveWaste === 'function'");await editAddress('Teine aadress');
    await evaluate("window.resolveWaste({entries:[{externalId:'stale',title:'EI TOHI ILMUDA',subtype:'bio',date:'2026-09-17'}]})");
    await click('Leia prügipäevad');await waitFor("document.querySelector('#prugivedu').innerText.includes('ühendatud automaatset allikat')");
    assert.ok(!(await events()).some(e=>e.title==='EI TOHI ILMUDA'));
    assert.doesNotMatch(await body(),/Viimane edukas värskendus/);
  });
  await t.test('MJM03 manual schedule edit/delete remains explicit and never removes imported data',async()=>{
    await click('Muuda graafikut');await click('Muuda');await input('#event-title','Uus paber');
    await click('Salvesta sündmus');await waitFor("!document.querySelector('dialog[open]')");assert.match(await body(),/Uus paber/);
    await click('Muuda graafikut');await click('Kustuta');assert.match(await body(),/kogu sarja/);
    await click('Kinnita kustutamine');await waitFor("!document.querySelector('dialog[open]')");
    assert.equal((await events()).length,1);assert.equal((await events())[0].source,'imported');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),true);
  });
  await t.test('MJM03 a failed import save shows no success, keeps the previous snapshot and leaves the calendar unchanged',async()=>{
    await nav('Seaded');await editAddress('Fixture 1');
    await evaluate("window.wasteFail=false;window.wasteDelay=false;window.wasteReply={entries:[{externalId:'fail-one',title:'Ei salvestu',subtype:'bio',date:'2026-09-17'}]}");
    await waitFor("[...document.querySelectorAll('#prugivedu button')].some(b=>b.textContent==='Värskenda graafikut')");
    const before=await calendarRaw();
    await failWrites('calendar');
    try {
      await click('Värskenda graafikut');
      await waitFor("!!document.querySelector('#prugivedu [role=alert]')");
      const section=await evaluate("document.querySelector('#prugivedu').innerText");
      assert.match(section,/Salvestamine ebaõnnestus/);
      assert.doesNotMatch(section,/Kalender uuendatud/,'no success notice before the commit');
    } finally { await restoreWrites(); }
    assert.equal(await calendarRaw(),before,'the previous persisted calendar is untouched');
    assert.ok(!(await events()).some(e=>e.title==='Ei salvestu'));
    await editAddress('Teine aadress');
  });
  await t.test('MJM03 malformed household profile leaves manual setup usable and original storage intact',async()=>{
    await corruptHousehold();
    const corrupt=await householdRaw();
    await send('Page.reload');await waitFor("!!document.querySelector('nav')");await nav('Seaded');await click('Lisa aadress');
    assert.match(await body(),/Majapidamise andmeid ei saanud lugeda/);
    assert.equal(await evaluate("document.querySelector('.mm-household-form button').disabled"),true);
    await click('Lisa käsitsi graafik');await waitFor("!!document.querySelector('#event-title')");await click('Tühista');
    assert.equal(await householdRaw(),corrupt,'an unreadable household profile is never overwritten');
    assert.equal((await events()).length,1);
    await repairHousehold();
    await send('Page.reload');await waitFor("!!document.querySelector('nav')");
  });
}
