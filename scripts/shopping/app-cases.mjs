import assert from 'node:assert/strict';

export async function runShoppingAppChecks({t,nav,click,input,evaluate,waitFor,body,mode}){
  await t.test('shopping mounts in the real app, retains five destinations and opens from Veel',async()=>{
    assert.equal(await evaluate('!!__runtime.getSnapshot().session.shopping'),true);
    await nav('Veel');await evaluate("[...document.querySelectorAll('.mm-utility-row')].find(button=>button.innerText.includes('Ostunimekiri')).click()");
    await waitFor("!!document.querySelector('#shopping-quick-name')");
    assert.match(await body(),/Ainult selles seadmes/);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('nav button')].map(b=>b.textContent.trim())"),['Kodu','Kalender','Buss','Veel','Seaded']);
    assert.equal(await evaluate("document.querySelector('nav [aria-current]').textContent.trim()"),'Veel');
  });
  await t.test('real offline UI commit persists shopping without changing calendar or localStorage',async()=>{
    const before=await evaluate("Promise.all([__idb.getAll('calendarEvents'),__idb.getAll('outbox')]).then(JSON.stringify)");
    const legacy=await evaluate('JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)])))');
    await input('#shopping-quick-name','Äpi piim');
    await evaluate("document.querySelector('.mm-shopping-quick').requestSubmit()");
    await waitFor("document.querySelector('.mm-shopping-list')?.innerText.includes('Äpi piim')");
    assert.equal(await evaluate("document.querySelector('#shopping-quick-name').value"),'');
    const rows=await evaluate("__idb.getAll('shoppingItems')");
    assert.equal(rows.find(row=>row.payload.name==='Äpi piim').syncStatus,'local');
    assert.equal(rows.find(row=>row.payload.name==='Äpi piim').revision,0);
    const outbox=await evaluate("__idb.getAll('outbox')");
    assert.ok(outbox.every(row=>row.entityType!=='shopping_item'));
    assert.equal(await evaluate("Promise.all([__idb.getAll('calendarEvents'),__idb.getAll('outbox')]).then(JSON.stringify)"),before);
    assert.equal(await evaluate('JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)])))'),legacy);
    assert.equal(mode==='READY'||mode==='LEGACY',true);
  });
  await t.test('Kodu shopping preview uses actual unfinished items and opens the list',async()=>{
    await nav('Kodu');await waitFor("document.querySelector('.mm-shopping-home-preview')?.innerText.includes('Äpi piim')");
    assert.match(await evaluate("document.querySelector('.mm-shopping-home').innerText"),/1 asi nimekirjas/);
    await click('Ava nimekiri');await waitFor("!!document.querySelector('#shopping-quick-name')");
  });
  await t.test('committed shopping broadcast refreshes mounted view without polling',async()=>{
    const created=await evaluate("__runtime.getSnapshot().session.shopping.add({name:'Teise akna ost'})");
    await evaluate(`__idb.get('shoppingItems',${JSON.stringify(created.id)}).then(row=>__idb.put('shoppingItems',{...row,payload:{...row.payload,name:'Värske teise akna ost'}}))`);
    await evaluate("(()=>{const other=new BroadcastChannel('majandus:replica');other.postMessage({type:'committed',domain:'shopping'});setTimeout(()=>other.close(),100);return true})()");
    await waitFor("document.querySelector('.mm-shopping-list')?.innerText.includes('Värske teise akna ost')");
  });
  await t.test('shopping remains locally usable after calendar is unreadable',async()=>{
    const original=await evaluate("__idb.getAll('calendarEvents')");
    try{
      await evaluate("__idb.put('calendarEvents',{id:'invalid-calendar',payload:{},revision:0,syncStatus:'local',updatedAt:'2026-09-14T06:00:00.000Z',deletedAt:null})");
      const created=await evaluate("__runtime.getSnapshot().session.shopping.add({name:'Sõltumatu ost'})");
      assert.ok(created.id);await waitFor("document.querySelector('.mm-shopping-list')?.innerText.includes('Sõltumatu ost')");
    }finally{
      await evaluate("__idb.delete('calendarEvents','invalid-calendar')");
      assert.deepEqual(await evaluate("__idb.getAll('calendarEvents')"),original);
    }
  });
  await t.test('local writes and foreground signals retry shopping independently of calendar',async()=>{
    const auth={key:'device',deviceToken:'m1s_'+'a'.repeat(43),householdId:'hld_11111111-1111-4111-8111-111111111111',
      userId:'usr_22222222-2222-4222-8222-222222222222',sessionId:'ses_33333333-3333-4333-8333-333333333333'};
    await evaluate(`__idb.put('auth',${JSON.stringify(auth)}).then(()=>__runtime.getSnapshot().session.shopping.refresh())`);
    await evaluate("__runtime.getSnapshot().session.shopping.add({name:'Võrgu katkemine ei takista'})");
    if(mode==='LEGACY'){
      assert.deepEqual(await evaluate('__shoppingCalls'),[]);return;
    }
    await waitFor("__runtime.getSnapshot().session.shoppingSync.getSnapshot().status==='waiting'");
    assert.match(await body(),/Võrgu katkemine ei takista/);
    for(const event of['online','focus','visibilitychange']){
      await evaluate('__runtime.getSnapshot().session.shoppingSync.run()');
      const count=await evaluate('__shoppingCalls.length');
      await evaluate(event==='visibilitychange'?"document.dispatchEvent(new Event('visibilitychange'))":`window.dispatchEvent(new Event(${JSON.stringify(event)}))`);
      await waitFor(`__shoppingCalls.length>${count}`);
      await evaluate('__runtime.getSnapshot().session.shoppingSync.run()');
    }
    const before=await evaluate('__shoppingCalls.length');await click('Värskenda');await waitFor(`__shoppingCalls.length>${before}`);
    const snapshot=await evaluate('__runtime.getSnapshot().session.shopping.snapshot()');assert.ok(snapshot.outbox.some(row=>row.patch.name==='Võrgu katkemine ei takista'));
    const view=JSON.stringify(await evaluate('__runtime.getSnapshot().session.shopping.getSnapshot()'));assert.equal(view.includes(auth.deviceToken),false);
  });
}
