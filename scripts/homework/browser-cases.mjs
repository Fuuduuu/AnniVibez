import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

export async function runHomeworkChecks({t,nav,click,input,evaluate,waitFor,body,send,mode,readCalendarEvents}) {
  const key='majamajandus_homework_v1',ttKey='majamajandus_timetable_v1';
  const before=await evaluate(`localStorage.getItem('${key}')`),ttBefore=await evaluate(`localStorage.getItem('${ttKey}')`);
  const calendarBefore=await readCalendarEvents();
  const outboxBefore=await evaluate("__idb.getAll('outbox')");
  const read=()=>evaluate(`JSON.parse(localStorage.getItem('${key}'))?.items??[]`);
  const selector=title=>`.mm-homework-card .mm-homework-open[aria-label="Muuda kodutööd: ${title}"]`;
  const open=async()=>{
    await nav('Veel');await evaluate("document.querySelector('.mm-utility-row').click();true");
    await waitFor("document.querySelector('h1')?.textContent==='Anni tunniplaan'");
  };
  const fillNotes=async value=>evaluate(`(()=>{const el=document.querySelector('#homework-notes');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  const create=async(title,date,time='')=>{
    await click('Lisa kodune töö');await input('#homework-subject','Matemaatika');await input('#homework-title',title);
    await input('#homework-date',date);await input('#homework-time',time);await click('Salvesta kodutöö');
    await waitFor("!document.querySelector('#homework-title')");
  };
  const toggle=async title=>{
    const completed=(await read()).find(item=>item.title===title).completedAt!==null;
    await evaluate(`document.querySelector(${JSON.stringify(selector(title))}).closest('article').querySelector('input').click();true`);
    await waitFor(`document.querySelector(${JSON.stringify(selector(title))})?.closest('article').querySelector('input').checked===${JSON.stringify(!completed)}`);
  };
  const refresh=()=>evaluate(`window.dispatchEvent(new StorageEvent('storage',{key:'${key}'}));true`);
  const shot=async name=>{
    if(process.env.HOMEWORK_EVIDENCE_DIR && mode==='READY') {
      const result=await send('Page.captureScreenshot',{format:'png'});
      writeFileSync(join(process.env.HOMEWORK_EVIDENCE_DIR,name+'.png'),Buffer.from(result.data,'base64'));
    }
  };
  try {
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await evaluate(`(()=>{window.__hwDate=Date;const stamp=new Date(2026,8,28,10,30).getTime();
      window.Date=class extends __hwDate{constructor(...args){super(...(args.length?args:[stamp]));}static now(){return stamp;}};
      localStorage.removeItem('${key}');localStorage.removeItem('${ttKey}');
      window.dispatchEvent(new StorageEvent('storage',{key:null}));return true;})()`);
    await open();
    await t.test('Anni defaults to timetable and opens a separate empty homework view',async()=>{
      assert.equal(await evaluate("document.querySelector('.mm-school-view-switch [aria-pressed=true]')?.textContent"),'Tunniplaan');
      await click('Kodused tööd');assert.match(await body(),/Kodutöid pole veel/);
      assert.equal(await evaluate("!!document.querySelector('.mm-timetable-week')"),false);
      assert.deepEqual(await evaluate("[...document.querySelectorAll('nav button')].map(b=>b.textContent.trim())"),['Kodu','Kalender','Buss','Veel','Seaded']);
    });
    await t.test('manual add uses a labelled bottom sheet with optional lesson/time and rejects blank authored text',async()=>{
      await click('Lisa kodune töö');await waitFor("!!document.querySelector('#homework-title')");
      assert.equal(await evaluate("document.querySelector('dialog[open]').matches(':modal')"),true);
      await evaluate("Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect.getTiming().iterations)).map(animation=>animation.finished.catch(()=>{}))).then(()=>true)");
      assert.ok(await evaluate("Math.abs(document.querySelector('dialog[open]').getBoundingClientRect().bottom-innerHeight)<2"));
      assert.equal(await evaluate("document.querySelector('#homework-date').value"),'2026-09-28');
      assert.equal(await evaluate("document.querySelector('#homework-lesson').value"),'');
      await input('#homework-subject','  ');await input('#homework-title','Õpi luuletus');await click('Salvesta kodutöö');
      assert.match(await evaluate("document.querySelector('dialog [role=alert]').textContent"),/kohustuslikud/);
      assert.equal((await read()).length,0);
    });
    await t.test('manual add persists an unlinked subject snapshot, due time and notes outside the calendar/outbox',async()=>{
      await input('#homework-subject',' Eesti keel ');await input('#homework-date','2026-09-29');await input('#homework-time','08:00');
      await fillNotes('Õpi kaks salmi.');await click('Salvesta kodutöö');await waitFor("!document.querySelector('dialog[open]')");
      const item=(await read())[0];assert.equal(item.subject,'Eesti keel');assert.equal(item.lessonId,null);assert.equal(item.notes,'Õpi kaks salmi.');
      assert.equal(item.studentId,'anni');assert.equal(item.source,'local');assert.equal(item.dueTime,'08:00');
      assert.match(await evaluate("document.querySelector('[data-homework-group=tomorrow]').textContent"),/Õpi luuletus/);
      assert.match(await body(),/Märkmed/);assert.deepEqual(await readCalendarEvents(),calendarBefore);assert.deepEqual(await evaluate("__idb.getAll('outbox')"),outboxBefore);
    });
    await t.test('edit changes the existing task while retaining its id and optional fields',async()=>{
      const id=(await read())[0].id;
      await click('Muuda kodutööd: Õpi luuletus');await input('#homework-title','Õpi luuletus üle');await input('#homework-date','2026-09-28');
      await input('#homework-time','');await click('Salvesta kodutöö');await waitFor("!document.querySelector('dialog[open]')");
      assert.equal((await read()).length,1);assert.equal((await read())[0].id,id);assert.equal((await read())[0].dueTime,null);
      assert.match(await evaluate("document.querySelector('[data-homework-group=today]').textContent"),/Õpi luuletus üle/);
    });
    await t.test('checkbox completes into a collapsed Tehtud section and reopens the same task',async()=>{
      await toggle('Õpi luuletus üle');await waitFor("!!document.querySelector('.mm-homework-completed')");
      assert.equal(await evaluate("document.querySelector('.mm-homework-completed').open"),false);
      assert.equal((await read())[0].completedAt,await evaluate('new Date().toISOString()'));
      await evaluate("document.querySelector('.mm-homework-completed summary').click();true");
      assert.match(await evaluate("document.querySelector('.mm-homework-done').textContent"),/TEHTUD/);
      await toggle('Õpi luuletus üle');await waitFor("!!document.querySelector('[data-homework-group=today]')");
      assert.equal((await read())[0].completedAt,null);assert.equal(await evaluate("!!document.querySelector('.mm-homework-completed')"),false);
    });
    await t.test('unfinished groups are chronological and an overdue task has an explicit text label',async()=>{
      await create('Vana ülesanne','2026-09-27');await create('Homne ülesanne','2026-09-29');
      await create('Reede ülesanne','2026-10-02');await create('Hilisem ülesanne','2026-10-10');
      assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-homework-group]')].map(el=>el.dataset.homeworkGroup)"),['overdue','today','tomorrow','week','later']);
      assert.match(await evaluate("document.querySelector('[data-homework-group=overdue]').textContent"),/ÜLE TÄHTAJA/);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-homework-group=tomorrow] .mm-homework-subject')).backgroundColor"),'rgb(232, 226, 251)');
    });
    await t.test('Home summary prioritizes overdue then today while preserving the small school card',async()=>{
      await nav('Kodu');await waitFor("!!document.querySelector('.mm-school-homework')");
      assert.match(await evaluate("document.querySelector('.mm-school-homework').textContent"),/1 töö üle tähtaja.*Vana ülesanne/);
      assert.equal(await evaluate("document.querySelectorAll('.mm-school-homework').length"),1);
      await open();await click('Kodused tööd');await toggle('Vana ülesanne');
      await nav('Kodu');assert.match(await evaluate("document.querySelector('.mm-school-homework').textContent"),/1 kodune töö täna/);
      await open();await click('Kodused tööd');
    });
    await t.test('delete asks confirmation and removes only the chosen homework',async()=>{
      await click('Muuda kodutööd: Hilisem ülesanne');await click('Kustuta');
      assert.match(await evaluate("document.querySelector('dialog').textContent"),/ainult valitud kodutöö/);
      assert.equal((await read()).length,5);await click('Kinnita kustutamine');await waitFor("!document.querySelector('dialog[open]')");
      assert.equal((await read()).length,4);assert.ok((await read()).some(item=>item.title==='Homne ülesanne'));
    });
    await t.test('timetable lessons still add normally with current status and progress independent of homework',async()=>{
      await click('Tunniplaan');await click('Lisa tund');await input('#lesson-subject','Matemaatika');
      await input('#lesson-number','1');await input('#lesson-start','10:15');await input('#lesson-end','11:00');
      await click('Salvesta tund');await waitFor("!!document.querySelector('.mm-lesson-current')");
      assert.match(await evaluate("document.querySelector('.mm-lesson-status').textContent"),/PRAEGU/);
      assert.ok(await evaluate("!!document.querySelector('.mm-lesson-progress')"));
      await nav('Kodu');assert.match(await evaluate("document.querySelector('.mm-school-now').textContent"),/Praegu matemaatika/);
      assert.match(await evaluate("document.querySelector('.mm-school-homework').textContent"),/1 kodune töö täna/);
      await open();
    });
    let timetableRaw;
    await t.test('lesson add prefills snapshot subject, link and the selected date then returns to its detail',async()=>{
      timetableRaw=await evaluate(`localStorage.getItem('${ttKey}')`);
      await click('Vaata tundi: Matemaatika');await click('Lisa kodune töö');
      assert.equal(await evaluate("document.querySelector('#homework-subject').value"),'Matemaatika');
      assert.equal(await evaluate("document.querySelector('#homework-date').value"),'2026-09-28');
      assert.equal(await evaluate("document.querySelector('#homework-lesson').value"),JSON.parse(timetableRaw).lessons[0].id);
      await input('#homework-title','Arvuta vihikusse');await click('Salvesta kodutöö');await waitFor("!!document.querySelector('.mm-lesson-sheet')");
      assert.match(await evaluate("document.querySelector('.mm-lesson-homework').textContent"),/Arvuta vihikusse/);
      assert.equal(await evaluate("localStorage.getItem('majamajandus_timetable_v1')"),timetableRaw);
      await click('Sulge');assert.equal(await evaluate("document.querySelector('.mm-lesson-homework-badge').textContent"),'1 kodune töö');
    });
    await t.test('lesson detail quick completion removes its unfinished badge and can reopen the task',async()=>{
      await click('Vaata tundi: Matemaatika');await toggle('Arvuta vihikusse');
      assert.match(await evaluate("document.querySelector('.mm-lesson-homework').textContent"),/TEHTUD/);
      await click('Sulge');assert.equal(await evaluate("!!document.querySelector('.mm-lesson-homework-badge')"),false);
      await click('Vaata tundi: Matemaatika');await toggle('Arvuta vihikusse');await click('Sulge');
      assert.equal(await evaluate("document.querySelector('.mm-lesson-homework-badge').textContent"),'1 kodune töö');
    });
    await t.test('a next-week lesson uses that selected date and its badge never leaks onto this week',async()=>{
      await click('Järgmine nädal');await waitFor("document.querySelector('.mm-timetable-list').dataset.phase==='idle'");
      assert.equal(await evaluate("!!document.querySelector('.mm-lesson-homework-badge')"),false);
      await click('Vaata tundi: Matemaatika');await click('Lisa kodune töö');
      assert.equal(await evaluate("document.querySelector('#homework-date').value"),'2026-10-05');
      await input('#homework-title','Järgmise nädala töö');await click('Salvesta kodutöö');await waitFor("!!document.querySelector('.mm-lesson-sheet')");
      await click('Sulge');assert.equal(await evaluate("document.querySelector('.mm-lesson-homework-badge').textContent"),'1 kodune töö');
      await click('Täna');await waitFor("document.querySelector('.mm-timetable-list').dataset.phase==='idle'");
    });
    await t.test('lesson rename/removal preserves homework snapshots and an optional deleted link stays editable',async()=>{
      const raw=await evaluate(`localStorage.getItem('${key}')`);
      await click('Vaata tundi: Matemaatika');await click('Muuda tund');await input('#lesson-subject','Arvutamine');await click('Salvesta tund');
      assert.equal(await evaluate(`localStorage.getItem('${key}')`),raw);
      await click('Vaata tundi: Arvutamine');assert.match(await evaluate("document.querySelector('.mm-lesson-homework').textContent"),/Arvuta vihikusse/);
      await click('Muuda tund');await click('Kustuta tund');await click('Kinnita kustutamine');await waitFor("!document.querySelector('dialog[open]')");
      assert.equal(await evaluate(`localStorage.getItem('${key}')`),raw);
      await click('Kodused tööd');await click('Muuda kodutööd: Arvuta vihikusse');
      assert.equal(await evaluate("document.querySelector('#homework-subject').value"),'Matemaatika');
      assert.match(await evaluate("document.querySelector('#homework-lesson option:checked').textContent"),/Kustutatud tund/);
      await click('Salvesta kodutöö');await waitFor("!document.querySelector('dialog[open]')");
      assert.deepEqual(await readCalendarEvents(),calendarBefore);
    });
    await t.test('failed device-local save retains the draft and previous durable homework',async()=>{
      const raw=await evaluate(`localStorage.getItem('${key}')`);await click('Muuda kodutööd: Arvuta vihikusse');
      await input('#homework-title','Salvestamata mustand');
      await evaluate(`(()=>{window.__hwSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='${key}')throw Error('quota');return __hwSet.call(this,k,v);};return true;})()`);
      await click('Salvesta kodutöö');assert.match(await evaluate("document.querySelector('dialog [role=alert]').textContent"),/ebaõnnestus/);
      assert.equal(await evaluate("document.querySelector('#homework-title').value"),'Salvestamata mustand');
      assert.equal(await evaluate(`localStorage.getItem('${key}')`),raw);
      await evaluate("Storage.prototype.setItem=__hwSet;delete window.__hwSet;true");await click('Tühista');
    });
    await t.test('a real same-origin second window storage event refreshes homework without polling',async()=>{
      await evaluate(`(()=>{const frame=document.createElement('iframe');frame.id='homework-other-window';frame.src='about:blank';document.body.append(frame);
        const data=JSON.parse(localStorage.getItem('${key}'));data.items.push({id:'hw-other-window',studentId:'anni',source:'local',subject:'Kunst',title:'Teise akna ülesanne',
          dueDate:'2026-09-29',dueTime:null,lessonId:null,notes:'',completedAt:null});frame.contentWindow.localStorage.setItem('${key}',JSON.stringify(data));return true;})()`);
      await waitFor("document.querySelector('.mm-homework-view').textContent.includes('Teise akna ülesanne')");
      assert.match(await body(),/Teise akna ülesanne/);await evaluate("document.querySelector('#homework-other-window').remove();true");
    });
    await t.test('focus and visibility return reread external homework and preserve unrelated domains',async()=>{
      for(const event of ['focus','visibilitychange']) {
        await evaluate(`(()=>{const data=JSON.parse(localStorage.getItem('${key}'));data.items.find(item=>item.id==='hw-other-window').title=${JSON.stringify(event+' ülesanne')};
          localStorage.setItem('${key}',JSON.stringify(data));${event==='focus'?'window':'document'}.dispatchEvent(new Event('${event}'));return true;})()`);
        await waitFor(`document.querySelector('.mm-homework-view').textContent.includes(${JSON.stringify(event+' ülesanne')})`);
      }
      assert.deepEqual(await readCalendarEvents(),calendarBefore);assert.deepEqual(await evaluate("__idb.getAll('outbox')"),outboxBefore);
    });
    await t.test('unreadable homework refuses writes without erasing the last visible snapshot or corrupt bytes',async()=>{
      const raw=await evaluate(`localStorage.getItem('${key}')`);
      await evaluate(`localStorage.setItem('${key}','{broken');true`);await refresh();
      await waitFor("document.querySelector('.mm-homework-heading button').disabled");
      assert.match(await body(),/Olemasolevat salvestust ei kirjutata üle/);
      assert.equal(await evaluate(`localStorage.getItem('${key}')`),'{broken');assert.match(await body(),/Arvuta vihikusse/);
      assert.ok(await evaluate("[...document.querySelectorAll('.mm-homework-check input')].every(input=>input.disabled)"));
      await evaluate(`localStorage.setItem('${key}',${JSON.stringify(raw)});true`);await refresh();await waitFor("!document.querySelector('.mm-homework-heading button').disabled");
    });
    await t.test('narrow phone and 200 percent text keep homework controls, long text and sheet fields within the viewport',async()=>{
      await shot('homework-phone');
      for(const width of [320,390]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
        await evaluate("document.documentElement.style.fontSize='200%';true");
        assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false);
        assert.ok(await evaluate("[...document.querySelectorAll('.mm-school-view-switch button,.mm-homework-check input')].every(el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44;})"));
        await click('Lisa kodune töö');await input('#homework-subject','Väga pikk aine nimi telefonis');
        await input('#homework-title','Pikk ülesanne, mida peab saama lugeda ka suurema tekstiga');
        assert.equal(await evaluate("document.querySelector('dialog').scrollWidth>document.querySelector('dialog').clientWidth"),false);
        assert.ok(await evaluate("[...document.querySelectorAll('dialog input,dialog textarea,dialog select')].every(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1;})"));
        await shot(`homework-sheet-${width}-200`);await click('Tühista');
        await evaluate("document.documentElement.style.fontSize='';true");
      }
      await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    });
    await t.test('reduced motion removes homework entrance and keeps the same usable bottom sheet',async()=>{
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await click('Tunniplaan');await click('Kodused tööd');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-homework-view')).animationName"),'none');
      await click('Lisa kodune töö');assert.equal(await evaluate("getComputedStyle(document.querySelector('dialog[open]')).animationName"),'none');
      await click('Tühista');await send('Emulation.setEmulatedMedia',{features:[]});
    });
    await t.test('reload preserves homework, completed state and an unchanged calendar/outbox; timetable remains the default',async()=>{
      const saved=await read();await evaluate("location.reload();true");await waitFor("!!document.querySelector('.mm-home-header')");await open();
      assert.equal(await evaluate("document.querySelector('.mm-school-view-switch [aria-pressed=true]').textContent"),'Tunniplaan');
      await click('Kodused tööd');assert.deepEqual(await read(),saved);assert.match(await body(),/Arvuta vihikusse/);
      assert.deepEqual(await readCalendarEvents(),calendarBefore);assert.deepEqual(await evaluate("__idb.getAll('outbox')"),outboxBefore);
    });
  } finally {
    await evaluate(`(()=>{if(window.__hwDate){window.Date=__hwDate;delete window.__hwDate;}if(window.__hwSet){Storage.prototype.setItem=__hwSet;delete window.__hwSet;}
      document.documentElement.style.fontSize='';document.querySelector('#homework-other-window')?.remove();
      for(const [key,raw] of ${JSON.stringify([[key,before],[ttKey,ttBefore]])}){if(raw===null)localStorage.removeItem(key);else localStorage.setItem(key,raw);}
      window.dispatchEvent(new StorageEvent('storage',{key:null}));window.dispatchEvent(new Event('focus'));return true;})()`);
    await nav('Kodu');
  }
}
