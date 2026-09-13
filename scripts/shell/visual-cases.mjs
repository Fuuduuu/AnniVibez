import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function runVisualChecks({t,nav,click,input,evaluate,waitFor,send}) {
  const select = (id,value) => evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const screenshot = async name => {
    if (!process.env.MJM_SCREENSHOTS) return;
    const shot=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(process.env.MJM_SCREENSHOTS,name+'.png'),Buffer.from(shot.data,'base64'));
  };
  await nav('Kodu');
  for (const [title,date,category,time] of [
    ['Filter check','2026-09-14','maintenance','10:30'],
    ['Waste pickup','2026-09-15','waste',''],
    ['House payment','2026-09-18','payment','12:00'],
  ]) {
    await click('Lisa sündmus');await input('#event-title',title);await input('#event-date',date);
    await select('event-category',category);if(time) await input('#event-time',time);
    await click('Salvesta sündmus');await waitFor("!document.querySelector('dialog[open]')");
  }
  for (const width of [360,390,430]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    await t.test(`MM-VIS01 compact Home and agenda, category grid at ${width}px`,async()=>{
      await nav('Kodu');
      const home=await evaluate(`(()=>{const rows=[...document.querySelectorAll('[aria-labelledby=upcoming-heading] [data-occurrence]')];
        return rows.map(row=>({height:row.getBoundingClientRect().height,icon:!!row.querySelector('.mm-event-icon svg'),
          stripe:getComputedStyle(row).borderLeftWidth,chip:row.querySelector('.mm-event-when') && getComputedStyle(row.querySelector('.mm-event-when')).whiteSpace,
          dateTiles:row.querySelectorAll('.mm-event-day').length}));})()`);
      assert.equal(home.length,3);for(const row of home) {assert.equal(row.icon,true);assert.equal(row.stripe,'1px');assert.equal(row.chip,'nowrap');assert.equal(row.dateTiles,0);assert.ok(row.height<=90);}
      const chipColors=await evaluate("[...document.querySelectorAll('.mm-events-home .mm-event-when')].map(e=>[getComputedStyle(e).color,getComputedStyle(e).backgroundColor])");
      assert.deepEqual(chipColors,[['rgb(158, 59, 47)','rgb(247, 231, 227)'],['rgb(128, 83, 21)','rgb(248, 238, 221)'],['rgb(75, 83, 88)','rgb(237, 234, 228)']]);
      const luminance=rgb=>rgb.match(/\d+/g).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      for(const pair of chipColors) {const [dark,light]=pair.map(luminance).sort((a,b)=>a-b);assert.ok((light+.05)/(dark+.05)>=4.5);}
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
      await screenshot(`MM-VIS01-Home-${width}`);
      await nav('Kalender');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-date=\"2026-09-14\"]')).backgroundColor"),'rgb(26, 91, 105)');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-date=\"2026-09-14\"]')).color"),'rgb(255, 255, 255)');
      assert.equal(await evaluate("!!document.querySelector('[data-date=\"2026-09-15\"] .mm-day-markers svg')"),true);
      assert.equal(await evaluate("document.querySelectorAll('#selected-events .mm-event-when, #selected-events .mm-event-day').length"),0);
      assert.match(await evaluate("document.querySelector('#selected-events').innerText"),/10:30/);
      const agenda=await evaluate("[...document.querySelectorAll('.mm-agenda-row')].map(e=>({height:e.getBoundingClientRect().height,card:e.classList.contains('mm-card')}))");
      assert.equal(agenda.length,2);for(const row of agenda) {assert.ok(row.height>=44 && row.height<=48);assert.equal(row.card,false);}
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-other-month')).backgroundColor"),'rgba(0, 0, 0, 0)');
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
      await screenshot(`MM-VIS01-Calendar-${width}`);
      await evaluate("document.querySelector('.mm-events-agenda').scrollIntoView({block:'center'})");
      await screenshot(`MM-VIS01-Agenda-${width}`);
    });
    await t.test(`MM-VIS01 sticky native event form actions at ${width}px`,async()=>{
      await nav('Kalender');await click('Lisa sündmus');await waitFor("!!document.querySelector('#event-title')");
      const check=async()=>assert.equal(await evaluate(`(()=>{const b=document.querySelector('.mm-save-event'),r=b.getBoundingClientRect();
        return r.top>=0 && r.bottom<=innerHeight && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b;})()`),true);
      try {
        await check();
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-event-footer')).position"),'sticky');
        assert.equal(await evaluate("document.querySelector('#event-date').type"),'date');
        assert.equal(await evaluate("document.querySelector('#event-time').type"),'time');
        await evaluate("document.querySelector('#event-notes').scrollIntoView({block:'center'})");await check();
        await screenshot(`MM-VIS01-Event-${width}`);
      } finally {await click('Tühista');}
    });
    await t.test(`MM-VIS01 one-line departures and map controls at ${width}px`,async()=>{
      await nav('Buss');await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Näita busse minu lähedal')).click()");
      await evaluate('window.gpsSuccess({coords:{latitude:59.333238,longitude:26.375306}})');
      await waitFor("!!document.querySelector('[aria-label=\"Järgmised väljumised\"] li')");
      const heads=await evaluate("[...document.querySelectorAll('.mm-bus-headsign')].map(e=>({nowrap:getComputedStyle(e).whiteSpace,overflow:getComputedStyle(e).overflow,ellipsis:getComputedStyle(e).textOverflow,title:e.title,text:e.textContent}))");
      assert.ok(heads.length);for(const head of heads) {assert.equal(head.nowrap,'nowrap');assert.equal(head.overflow,'hidden');assert.equal(head.ellipsis,'ellipsis');assert.ok(head.title);assert.ok(head.text.includes(head.title));}
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
      assert.equal(await evaluate("/\\p{Extended_Pictographic}/u.test(document.querySelector('main').innerText)"),false);
      await screenshot(`MM-VIS01-Buss-${width}`);
      const opener=await evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Vali sihtkoht kaardilt');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
      await send('Input.dispatchMouseEvent',{type:'mousePressed',...opener,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',...opener,button:'left',clickCount:1});
      await waitFor("!!document.querySelector('.leaflet-container')");
      assert.equal(await evaluate("!!document.querySelector('.leaflet-top.leaflet-right .leaflet-control-zoom')"),true);
      const point=await evaluate("(()=>{const r=document.querySelector('.leaflet-container').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
      await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
      const focus=await evaluate("(()=>{const e=document.querySelector('.leaflet-container'),s=getComputedStyle(e);return {style:s.outlineStyle,color:s.outlineColor,focused:e===document.activeElement,visible:e.matches(':focus-visible')};})()");
      assert.equal(focus.style,'none',JSON.stringify(focus));
      await screenshot(`MM-VIS01-Map-${width}`);
      await click('Sulge');
    });
  }
  await t.test('MM-VIS01 semantic Settings disclosure, honest limits and keyboard focus',async()=>{
    await nav('Seaded');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('summary')).listStyleType"),'none');
    assert.equal(await evaluate("document.querySelector('.mm-notification-settings details').open"),false);
    await evaluate("document.querySelector('.mm-notification-settings summary').click()");
    assert.match(await evaluate("document.querySelector('.mm-notification-settings details').innerText"),/Suletud äpis ega taustal saatmist ei lubata/);
    const families=await evaluate("getComputedStyle(document.querySelector('[data-app-shell]')).fontFamily");
    assert.doesNotMatch(families,/Archivo|Instrument/);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineColor"),'rgb(26, 91, 105)');
    await screenshot('MM-VIS01-Settings');
    await evaluate("document.querySelector('.mm-notification-settings').scrollIntoView({block:'start'})");
    await screenshot('MM-VIS01-Notifications');
  });
  await t.test('MM-VIS01 pointer navigation avoids programmatic focus outlines',async()=>{
    await nav('Kodu');
    const point=await evaluate("(()=>{const b=[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='Prügivedu');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    await waitFor("document.activeElement.id==='prugivedu'");
    assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle'),'none');
  });
  await t.test('MM-VIS01 today retains a distinct keyboard ring when another date is selected',async()=>{
    await nav('Kalender');
    await evaluate("document.querySelector('[data-date=\"2026-09-15\"]').click()");
    await evaluate("document.querySelector('[data-date=\"2026-09-13\"]').focus()");
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    const focus=await evaluate("(()=>{const e=document.activeElement,s=getComputedStyle(e);return {date:e.dataset.date,selected:e.getAttribute('aria-pressed'),visible:e.matches(':focus-visible'),color:s.outlineColor,width:s.outlineWidth,offset:s.outlineOffset};})()");
    assert.deepEqual(focus,{date:'2026-09-14',selected:'false',visible:true,color:'rgb(26, 91, 105)',width:'2px',offset:'3px'});
  });
}
