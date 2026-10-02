import assert from 'node:assert/strict';

export async function runTimetableChecks({ t, nav, click, input, evaluate, waitFor, body, send, readCalendarEvents }) {
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await t.test('Tunniplaan is the first Veel utility while the five primary destinations stay unchanged', async () => {
    await nav('Veel');
    assert.match(await evaluate("document.querySelector('.mm-utility-row').textContent"), /Tunniplaan/);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('nav button')].map(b=>b.textContent.trim())"),
      ['Kodu', 'Kalender', 'Buss', 'Veel', 'Seaded']);
  });
  const key = 'majamajandus_timetable_v1';
  const before = await evaluate(`localStorage.getItem('${key}')`);
  const calendarBefore = await readCalendarEvents();
  const select = async (selector, value) => {
    await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(String(value))}; el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  };
  const open = async () => {
    await nav('Veel');
    await evaluate("document.querySelector('.mm-utility-row').click();true");
    await waitFor("document.querySelector('h1')?.textContent==='Anni tunniplaan'");
  };
  const create = async (subject, number, start, end) => {
    await click('Lisa tund');await waitFor("!!document.querySelector('#lesson-subject')");
    await select('#lesson-weekday', 1);await input('#lesson-number', String(number));await input('#lesson-subject', subject);
    await input('#lesson-start', start);await input('#lesson-end', end);await input('#lesson-room', '203');await input('#lesson-teacher', 'Mari Tamm');
    await click('Salvesta tund');await waitFor("!document.querySelector('dialog[open]')");
  };
  try {
    await evaluate(`(() => { window.__ttDate=Date; const stamp=new Date(2026,8,28,8,30).getTime();
      window.Date=class extends window.__ttDate { constructor(...args){super(...(args.length?args:[stamp]));} static now(){return stamp;} };
      localStorage.removeItem('${key}');window.dispatchEvent(new StorageEvent('storage',{key:'${key}',newValue:null}));return true; })()`);
    await open();
    await t.test('manual timetable opens Anni with an empty school week and an unchanged floating nav', async () => {
      assert.match(await body(), /Selleks päevaks pole tunde lisatud/);
      assert.equal(await evaluate("document.querySelector('.mm-timetable-week').dataset.week"), '2026-09-28');
      assert.equal(await evaluate("document.querySelector('.mm-timetable-day[aria-current=date]').dataset.weekday"), '1');
      assert.equal(await evaluate("document.querySelector('nav [aria-current=page]').textContent.trim()"), 'Veel');
      assert.equal(await evaluate("document.querySelectorAll('.mm-nav-indicator').length"), 1);
    });
    await t.test('the school view shares the app surface while retaining rainbow and independent day colors', async () => {
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-timetable-page')).backgroundColor"),
        await evaluate("getComputedStyle(document.querySelector('[data-app-shell]')).backgroundColor"));
      assert.ok(await evaluate("!!document.querySelector('.mm-timetable-rainbow')"));
      assert.equal(await evaluate("document.querySelector('.mm-timetable-decoration').getAttribute('aria-hidden')"),'true');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-timetable-decoration')).pointerEvents"),'none');
      assert.deepEqual(await evaluate(`(() => {const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
        ctx.fillStyle=getComputedStyle(document.querySelector('[data-weekday="2"] > span')).color;ctx.fillRect(0,0,1,1);
        return Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3);})()`),[139,67,106]);
    });
    await t.test('previous and next week change actual dates, while Täna returns to the current school day', async () => {
      await click('Järgmine nädal');
      assert.equal(await evaluate("document.querySelector('.mm-timetable-week').dataset.week"), '2026-10-05');
      await click('Eelmine nädal');await click('Eelmine nädal');
      assert.equal(await evaluate("document.querySelector('.mm-timetable-week').dataset.week"), '2026-09-21');
      await click('Täna');
      assert.equal(await evaluate("document.querySelector('.mm-timetable-week').dataset.week"), '2026-09-28');
    });
    await t.test('day selection marks today independently and applies directional motion', async () => {
      await evaluate("document.querySelector('[data-weekday=\"3\"]').click();true");
      assert.equal(await evaluate("document.querySelector('.mm-timetable-day[aria-pressed=true]').dataset.weekday"), '3');
      assert.equal(await evaluate("document.querySelector('.mm-timetable-day[aria-current=date]').dataset.weekday"), '1');
      assert.equal(await evaluate("document.querySelector('.mm-timetable-list').dataset.direction"), 'forward');
      await evaluate("document.querySelector('[data-weekday=\"1\"]').click();true");
      assert.equal(await evaluate("document.querySelector('.mm-timetable-list').dataset.direction"), 'backward');
    });
    await t.test('real touch swipes cross Friday and Monday, while the day strip changes a full week', async () => {
      const settle=()=>waitFor("document.querySelector('.mm-timetable-list').dataset.phase==='idle'");
      const swipe=async (selector,delta,vertical=false)=>{
        const r=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
        const x=r.x+r.w*(delta>0?.8:.2),y=r.y+Math.min(r.h/2,100);
        await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:vertical?x:x-delta*r.w*.6,y:vertical?y+70:y,id:1}]});
        await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await settle();
      };
      const selected=()=>evaluate("document.querySelector('.mm-timetable-day[aria-pressed=true]').dataset.date");
      await evaluate("document.querySelector('[data-weekday=\"5\"]').click();true");await settle();
      await swipe('.mm-timetable-list',1);assert.equal(await selected(),'2026-10-05');
      await swipe('.mm-timetable-list',-1);assert.equal(await selected(),'2026-10-02');
      await swipe('.mm-timetable-days',1);assert.equal(await selected(),'2026-10-09');
      await swipe('.mm-timetable-days',-1);assert.equal(await selected(),'2026-10-02');
      await swipe('.mm-timetable-list',1,true);assert.equal(await selected(),'2026-10-02');
      assert.equal(await evaluate("!!document.querySelector('dialog[open]')"),false);
      await click('Täna');await settle();
    });
    await t.test('adding a real lesson persists its number, subject, time, room and teacher', async () => {
      await create('TT Matemaatika', 1, '08:15', '09:00');
      assert.match(await body(), /TT Matemaatika/);assert.match(await body(), /Mari Tamm/);assert.match(await body(), /Ruum\s+203/);
      assert.match(await evaluate("document.querySelector('.mm-lesson-current').textContent"), /PRAEGU · VEEL 30 MIN/);
      assert.equal(await evaluate("document.querySelector('.mm-lesson-progress').getAttribute('aria-valuenow')"),'33');
      const raw=await evaluate(`JSON.parse(localStorage.getItem('${key}')).lessons[0]`);
      assert.equal(raw.studentId,'anni');assert.equal(raw.period,1);assert.equal(raw.start,'08:15');assert.equal(raw.source,'local');
    });
    await t.test('the next real lesson is highlighted and school lessons stay out of calendar and reminders', async () => {
      await create('TT Eesti keel', 2, '09:10', '09:55');
      assert.match(await evaluate("document.querySelector('.mm-lesson-next').textContent"), /JÄRGMINE.*TT Eesti keel/s);
      assert.deepEqual(await readCalendarEvents(), calendarBefore);
      await nav('Kodu');
      assert.match(await evaluate("document.querySelector('.mm-school-card').textContent"), /ANNI · KOOL.*TT Eesti keel/s);
      assert.doesNotMatch(await evaluate("document.querySelector('.mm-section-primary').textContent"), /TT Matemaatika|TT Eesti keel/);
      const count = await evaluate("document.querySelector('.mm-today-total strong').textContent");
      await open();await click('Lisa tund');await input('#lesson-subject', 'Cancelled lesson');await click('Tühista');
      await nav('Kodu');assert.equal(await evaluate("document.querySelector('.mm-today-total strong').textContent"), count);
      await click('Ava tunniplaan');await waitFor("document.querySelector('h1')?.textContent==='Anni tunniplaan'");
    });
    await t.test('tapping a lesson opens the native detail sheet with empty informational homework', async () => {
      await click('Vaata tundi: TT Matemaatika');await waitFor("!!document.querySelector('.mm-lesson-sheet[open]')");
      await evaluate("Promise.all(document.querySelector('.mm-lesson-sheet').getAnimations().map(a=>a.finished.catch(()=>{}))).then(()=>true)");
      assert.ok(await evaluate("Math.abs(document.querySelector('.mm-lesson-sheet').getBoundingClientRect().bottom-innerHeight)<2"),'lesson detail is attached to the phone bottom');
      const detail=await evaluate("document.querySelector('.mm-lesson-sheet').textContent");
      assert.match(detail,/TT Matemaatika/);assert.match(detail,/08:15–09:00/);assert.match(detail,/203/);assert.match(detail,/Mari Tamm/);
      assert.match(detail,/Kodused tööd/);assert.match(detail,/pole veel/);
      assert.equal(await evaluate("document.querySelector('.mm-lesson-sheet').getAttribute('aria-modal')??document.querySelector('.mm-lesson-sheet').matches(':modal')"),true);
      await click('Sulge');assert.equal(await evaluate("!!document.querySelector('dialog[open]')"),false);
      assert.deepEqual(await readCalendarEvents(),calendarBefore);
    });
    await t.test('an exact duplicate slot reports an error and retains the authored draft', async () => {
      await click('Lisa tund');await select('#lesson-weekday', 1);await input('#lesson-number', '1');await input('#lesson-subject', 'Duplicate draft');
      await input('#lesson-start', '08:15');await input('#lesson-end', '09:00');await click('Salvesta tund');
      assert.match(await evaluate("document.querySelector('dialog [role=alert]').textContent"), /sama/i);
      assert.equal(await evaluate("document.querySelector('#lesson-subject').value"), 'Duplicate draft');
      await click('Tühista');
    });
    await t.test('an end before the start is refused by the visible editor', async () => {
      await click('Lisa tund');await input('#lesson-subject', 'Bad clock');await input('#lesson-start', '10:00');await input('#lesson-end', '09:00');
      await click('Salvesta tund');assert.match(await evaluate("document.querySelector('dialog [role=alert]').textContent"), /hiljem/);await click('Tühista');
    });
    await t.test('edit mode updates an existing lesson instead of creating another', async () => {
      await click('Muuda tunniplaani');await click('Muuda tund: TT Matemaatika');
      await input('#lesson-subject', 'TT Muudetud aine');await click('Salvesta tund');
      assert.match(await body(), /TT Muudetud aine/);assert.equal(await evaluate("document.querySelectorAll('.mm-lesson').length"), 2);
    });
    await t.test('a failed local save preserves the visible editor and previous durable data', async () => {
      await click('Muuda tund: TT Muudetud aine');await input('#lesson-subject', 'Unsaved draft');
      await evaluate(`(() => { window.__ttSet=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){if(k==='${key}')throw Error('quota');return window.__ttSet.call(this,k,v);};return true;})()`);
      await click('Salvesta tund');assert.match(await evaluate("document.querySelector('dialog [role=alert]').textContent"), /ebaõnnestus/);
      assert.equal(await evaluate("document.querySelector('#lesson-subject').value"), 'Unsaved draft');
      await evaluate("Storage.prototype.setItem=window.__ttSet;delete window.__ttSet;true");await click('Tühista');
      assert.match(await body(), /TT Muudetud aine/);
    });
    await t.test('delete requires confirmation and removes only the chosen lesson', async () => {
      await click('Muuda tund: TT Muudetud aine');await click('Kustuta tund');
      assert.match(await body(), /kõigil nädalatel/);await click('Kinnita kustutamine');
      assert.doesNotMatch(await body(), /TT Muudetud aine/);assert.match(await body(), /TT Eesti keel/);
      await click('Valmis');
    });
    await t.test('class editing keeps Anni and survives page navigation', async () => {
      await click('Muuda Anni klassi');await input('#timetable-class', '6A');await click('Salvesta klass');
      await nav('Kodu');assert.match(await evaluate("document.querySelector('.mm-school-card').textContent"), /6A/);
      await open();assert.equal(await evaluate("document.querySelector('.mm-timetable-class span').textContent"), '6A');
    });
    await t.test('a reload preserves the real saved timetable and the separate household calendar', async () => {
      await evaluate("location.reload();true");await waitFor("!!document.querySelector('.mm-home-header')");await open();
      await evaluate("document.querySelector('[data-weekday=\"1\"]').click();true");
      assert.match(await body(), /TT Eesti keel/);assert.equal(await evaluate("document.querySelector('.mm-timetable-class span').textContent"), '6A');
      assert.deepEqual(await readCalendarEvents(), calendarBefore);
    });
    await t.test('weekend Home explicitly explains when the next Monday has no saved lessons', async () => {
      const raw=await evaluate(`localStorage.getItem('${key}')`);
      try {
        await evaluate(`(()=>{window.__ttWeekendDate=Date;const stamp=new Date(2026,9,3,12).getTime();
          window.Date=class extends __ttWeekendDate{constructor(...args){super(...(args.length?args:[stamp]));}static now(){return stamp;}};
          const data=JSON.parse(${JSON.stringify(raw)});data.lessons=data.lessons.map(l=>({...l,weekday:2}));
          localStorage.setItem('${key}',JSON.stringify(data));window.dispatchEvent(new StorageEvent('storage',{key:'${key}'}));
          window.dispatchEvent(new Event('focus'));return true;})()`);
        await nav('Kodu');await waitFor("!!document.querySelector('.mm-school-card')");
        assert.match(await evaluate("document.querySelector('.mm-school-card').textContent"),/Esmaspäevaks pole tunde lisatud/);
        assert.deepEqual(await readCalendarEvents(),calendarBefore);
      } finally {
        await evaluate(`(()=>{window.Date=window.__ttWeekendDate;delete window.__ttWeekendDate;localStorage.setItem('${key}',${JSON.stringify(raw)});
          window.dispatchEvent(new StorageEvent('storage',{key:'${key}'}));window.dispatchEvent(new Event('focus'));return true;})()`);
        await open();
      }
    });
    await t.test('phone layout and reduced motion preserve usable day controls and editor sheets', async () => {
      for (const width of [360,390,430]) {
        await send('Emulation.setDeviceMetricsOverride', {width,height:844,deviceScaleFactor:1,mobile:false});
        await evaluate("Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))).then(()=>true)");
        assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"), false);
        assert.ok(await evaluate("[...document.querySelectorAll('.mm-timetable-day')].every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44;})"));
      }
      await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await evaluate("document.querySelector('[data-weekday=\"2\"]').click();true");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-timetable-list')).animationName"), 'none');
      assert.ok(await evaluate("[...document.querySelectorAll('.mm-school-blob,.mm-school-butterfly,.mm-school-wing,.mm-school-sparkle')].every(e=>getComputedStyle(e).animationName==='none')"));
      await click('Lisa tund');assert.ok(await evaluate("Math.abs(document.querySelector('dialog[open]').getBoundingClientRect().bottom-innerHeight)<2"),'editor remains a bottom sheet');assert.equal(await evaluate("getComputedStyle(document.querySelector('dialog[open]')).animationName"), 'none');await click('Tühista');
      await send('Emulation.setEmulatedMedia', {features:[]});
    });
  } finally {
    await evaluate(`(() => { if(window.__ttDate){window.Date=window.__ttDate;delete window.__ttDate;} if(window.__ttSet){Storage.prototype.setItem=window.__ttSet;delete window.__ttSet;}
      const raw=${JSON.stringify(before)};if(raw===null)localStorage.removeItem('${key}');else localStorage.setItem('${key}',raw);
      window.dispatchEvent(new StorageEvent('storage',{key:'${key}',newValue:raw}));window.dispatchEvent(new Event('focus'));return true;})()`);
    await nav('Kodu');
  }
}
