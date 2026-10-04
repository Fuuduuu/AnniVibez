import assert from 'node:assert/strict';

const item = (name, index, patch = {}) => ({ id: `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  name, quantity: '', category: 'food', note: '', checkedAt: null, createdAt: '2026-10-04T08:00:00.000Z', syncStatus: 'local', ...patch });

export async function runShoppingChecks({ t, send, evaluate, waitFor, input, click, body, shot }) {
  await t.test('quick add commits a food item, clears the draft and keeps focus for the next item', async () => {
    assert.match(await body(), /Ostunimekiri on tühi/);
    assert.match(await body(), /Ainult selles seadmes/);
    await input('#shopping-quick-name', '  Piim  ');
    await click('Lisa ost');
    await waitFor("!![...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Muuda: Piim')");
    assert.match(await body(), /TOIT/);
    assert.match(await body(), /1 asi ostmata/);
    assert.equal(await evaluate("document.querySelector('#shopping-quick-name').value"), '');
    assert.equal(await evaluate("document.activeElement.id"), 'shopping-quick-name');
    await evaluate('location.reload();true');
    await waitFor("!!document.querySelector('#shopping-quick-name')");
    assert.match(await body(), /Piim/);
  });
  await t.test('explicit edit opens the item sheet and saves name, quantity, category and note', async () => {
    await click('Muuda: Piim');
    await waitFor("!!document.querySelector('dialog[open]')");
    assert.match(await body(), /Nimetus/);
    assert.match(await body(), /Kogus/);
    assert.match(await body(), /Kategooria/);
    assert.match(await body(), /Märkus/);
    await input('#shopping-name', 'Vitamiinid');
    await input('#shopping-quantity', '2 pakki');
    await input('#shopping-category', 'pharmacy');
    await input('#shopping-note', 'Apteek kesklinnas');
    await click('Salvesta', "document.querySelector('dialog[open]')");
    await waitFor("!document.querySelector('dialog[open]')");
    assert.match(await body(), /APTEEK/);
    assert.doesNotMatch(await body(), /TOIT/);
    assert.match(await body(), /Vitamiinid/);
    assert.match(await body(), /2 pakki/);
    await click('Muuda: Vitamiinid');
    assert.equal(await evaluate("document.querySelector('#shopping-note').value"), 'Apteek kesklinnas');
    await click('Tühista', "document.querySelector('dialog[open]')");
  });
  await t.test('checking moves an item to the collapsed purchased section and unchecking restores its category', async () => {
    await input('#shopping-quick-name', 'Leib'); await click('Lisa ost');
    await evaluate("document.querySelector('input[aria-label=\"Märgi ostetuks: Vitamiinid\"]').click();true");
    await waitFor("document.querySelector('.mm-shopping-checked summary')?.textContent.includes('OSTETUD · 1')");
    assert.equal(await evaluate("document.querySelector('.mm-shopping-checked').open"), false);
    assert.doesNotMatch(await body(), /APTEEK/);
    assert.match(await body(), /1 asi ostmata/);
    await evaluate("document.querySelector('.mm-shopping-checked summary').click();true");
    await waitFor("document.querySelector('.mm-shopping-checked').open");
    await evaluate("document.querySelector('input[aria-label=\"Märgi ostmata: Vitamiinid\"]').click();true");
    await waitFor("!document.querySelector('.mm-shopping-checked')");
    assert.match(await body(), /APTEEK/);
    assert.match(await body(), /2 asja ostmata/);
  });
  await t.test('item deletion needs a clear confirmation and cancellation leaves the item in the list', async () => {
    await click('Muuda: Leib'); await click('Kustuta', "document.querySelector('dialog[open]')");
    assert.match(await body(), /Kustuta ost/);
    assert.match(await body(), /Leib/);
    await click('Tühista', "document.querySelector('dialog[open]')");
    assert.match(await body(), /Leib/);
    await click('Muuda: Leib'); await click('Kustuta', "document.querySelector('dialog[open]')");
    await click('Kinnita kustutamine', "document.querySelector('dialog[open]')");
    await waitFor("!document.querySelector('dialog[open]')");
    assert.doesNotMatch(await body(), /Leib/);
    assert.match(await body(), /Vitamiinid/);
  });
  await t.test('clearing purchased items requires confirmation and keeps every unfinished item', async () => {
    await input('#shopping-quick-name', 'Õunad'); await click('Lisa ost');
    await evaluate("document.querySelector('input[aria-label=\"Märgi ostetuks: Vitamiinid\"]').click();true");
    await waitFor("!!document.querySelector('.mm-shopping-checked')");
    await evaluate("(()=>{const details=document.querySelector('.mm-shopping-checked');if(!details.open)details.querySelector('summary').click();return true;})()");
    await click('Kustuta ostetud');
    assert.match(await body(), /Kustuta ostetud asjad/);
    await click('Tühista', "document.querySelector('dialog[open]')");
    assert.match(await body(), /Vitamiinid/);
    await click('Kustuta ostetud'); await click('Kustuta ostetud', "document.querySelector('dialog[open]')");
    await waitFor("!document.querySelector('dialog[open]')");
    assert.doesNotMatch(await body(), /Vitamiinid/);
    assert.match(await body(), /Õunad/);
    assert.match(await body(), /1 asi ostmata/);
  });
  await t.test('Home shows eight unfinished items with a three-name preview and Veel opens shopping after Tunniplaan', async () => {
    const entries = ['Piim','Leib','Pesugeel','Tee','Vesi','Seep','Või','Mahl'].map((name, index) => item(name, index + 1));
    await evaluate(`__shoppingFixture.seed(${JSON.stringify(entries)}).then(()=>{__shoppingFixture.navigate('home');return true;})`);
    await waitFor("!!document.querySelector('.mm-home-header')");
    assert.match(await body(), /Täna kodus/i);
    assert.match(await body(), /Tulemas/);
    assert.match(await body(), /ANNI · KOOL/);
    assert.match(await body(), /OSTUD/);
    assert.match(await body(), /8 asja nimekirjas/);
    assert.match(await body(), /Piim · Leib · Pesugeel \+5/);
    await click('Ava nimekiri');
    await waitFor("!!document.querySelector('#shopping-quick-name')");
    assert.match(await body(), /8 asja ostmata/);
    await evaluate("__shoppingFixture.navigate('more');true");
    await waitFor("!!document.querySelector('.mm-utility-list')");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.mm-utility-row strong')].slice(0,2).map(element=>element.textContent)"), ['Tunniplaan','Ostunimekiri']);
    await evaluate("[...document.querySelectorAll('.mm-utility-row')].find(button=>button.querySelector('strong').textContent==='Ostunimekiri').click();true");
    await waitFor("document.querySelector('h1')?.textContent==='Ostunimekiri'");
  });
  await t.test('an aborted quick-add commit keeps the draft and existing list until a successful retry', async () => {
    await evaluate("window.__shoppingFailure='add';true");
    await input('#shopping-quick-name', 'Munad'); await click('Lisa ost');
    await waitFor("!!document.querySelector('[role=alert]')");
    assert.match(await body(), /Ostu lisamine ei õnnestunud/);
    assert.equal(await evaluate("document.querySelector('#shopping-quick-name').value"), 'Munad');
    assert.equal(await evaluate("!!document.querySelector('button[aria-label=\"Muuda: Munad\"]')"), false);
    assert.match(await body(), /8 asja ostmata/);
    await evaluate("window.__shoppingFailure=null;true"); await click('Lisa ost');
    await waitFor("!!document.querySelector('button[aria-label=\"Muuda: Munad\"]')");
    assert.match(await body(), /9 asja ostmata/);
  });
  await t.test('an aborted edit keeps every draft field and the previous item until the local retry commits', async () => {
    await click('Muuda: Munad');
    await input('#shopping-name', 'Talumunad'); await input('#shopping-quantity', '10 tk');
    await input('#shopping-note', 'Turult');
    await evaluate("window.__shoppingFailure='update';true"); await click('Salvesta', "document.querySelector('dialog[open]')");
    await waitFor("!!document.querySelector('dialog[open] [role=alert]')");
    assert.match(await body(), /Ostu salvestamine ei õnnestunud/);
    assert.equal(await evaluate("document.querySelector('#shopping-name').value"), 'Talumunad');
    assert.equal(await evaluate("document.querySelector('#shopping-quantity').value"), '10 tk');
    assert.equal(await evaluate("document.querySelector('#shopping-note').value"), 'Turult');
    assert.equal(await evaluate("!!document.querySelector('button[aria-label=\"Muuda: Talumunad\"]')"), false);
    await evaluate("window.__shoppingFailure=null;true"); await click('Salvesta', "document.querySelector('dialog[open]')");
    await waitFor("!document.querySelector('dialog[open]')");
    assert.match(await body(), /Talumunad/); assert.match(await body(), /10 tk/);
  });
  await t.test('offline cloud sync reports waiting while local additions still commit and survive reload', async () => {
    await evaluate("__shoppingFixture.installAuth().then(()=>{window.__shoppingNetwork='offline';return __shoppingFixture.sync.run();})");
    await waitFor("__shoppingFixture.sync.getSnapshot().status==='waiting'");
    assert.match(await body(), /Ootab võrguühendust/);
    await input('#shopping-quick-name', 'Või külmikusse'); await click('Lisa ost');
    await waitFor("!!document.querySelector('button[aria-label=\"Muuda: Või külmikusse\"]')");
    assert.match(await body(), /10 asja ostmata/);
    await evaluate('location.reload();true'); await waitFor("!!document.querySelector('#shopping-quick-name')");
    assert.match(await body(), /Või külmikusse/);
    assert.doesNotMatch(await body(), /Ainult selles seadmes/);
    assert.doesNotMatch(await body(), /m1s_|hld_|usr_|ses_/);
  });
  await t.test('a sync conflict keeps the local item visibly marked for attention across reload', async () => {
    await evaluate("window.__shoppingNetwork='conflict';__shoppingFixture.sync.run()");
    await waitFor("__shoppingFixture.sync.getSnapshot().status==='attention'");
    assert.equal(await evaluate("!!document.querySelector('button[aria-label=\"Muuda: Või külmikusse\"]')"), true);
    assert.match(await evaluate("document.querySelector('button[aria-label=\"Muuda: Või külmikusse\"]').closest('li').innerText"), /Vajab tähelepanu/);
    assert.match(await body(), /Sinu kohalik muudatus on alles/);
    await evaluate('location.reload();true'); await waitFor("!!document.querySelector('#shopping-quick-name')");
    assert.match(await evaluate("document.querySelector('button[aria-label=\"Muuda: Või külmikusse\"]').closest('li').innerText"), /Vajab tähelepanu/);
    assert.match(await body(), /10 asja ostmata/);
  });
  await t.test('manual refresh shows a committed item from another store without waiting for a poll', async () => {
    await evaluate("__shoppingFixture.externalAdd({name:'Seep varuks',category:'home'})");
    assert.equal(await evaluate("!!document.querySelector('button[aria-label=\"Muuda: Seep varuks\"]')"), false);
    await click('Värskenda');
    await waitFor("!!document.querySelector('button[aria-label=\"Muuda: Seep varuks\"]')");
    assert.match(await body(), /KODU/);
  });
  await t.test('a pending edit stays open and blocks cancellation until the durable local commit', async () => {
    await click('Muuda: Seep varuks'); await input('#shopping-quantity', '3 tk');
    await evaluate("window.__shoppingHold='update';true"); await click('Salvesta', "document.querySelector('dialog[open]')");
    assert.equal(await evaluate("document.querySelector('#shopping-name').disabled"), true);
    assert.equal(await evaluate("[...document.querySelectorAll('dialog[open] button')].find(button=>button.textContent==='Tühista').disabled"), true);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert.equal(await evaluate("!!document.querySelector('dialog[open]')"), true);
    assert.doesNotMatch(await evaluate("document.querySelector('button[aria-label=\"Muuda: Seep varuks\"]').innerText"), /3 tk/);
    await evaluate("window.__shoppingHold=null;window.__shoppingRelease();true");
    await waitFor("!document.querySelector('dialog[open]')");
    assert.match(await evaluate("document.querySelector('button[aria-label=\"Muuda: Seep varuks\"]').innerText"), /3 tk/);
  });
  await t.test('an unreadable list shows an error rather than a false empty state, then recovers visibly', async () => {
    await evaluate("__shoppingFixture.seed([])");
    await evaluate(`__shoppingFixture.replica.transact('shoppingItems','readwrite',({stores})=>stores.shoppingItems.put({id:'40000000-0000-4000-8000-000000000099',payload:{},revision:0,updatedAt:'2026-10-04T08:00:00.000Z',deletedAt:null,syncStatus:'local',householdId:null})).then(()=>__shoppingFixture.store.refresh().catch(()=>true))`);
    await waitFor("!__shoppingFixture.store.getSnapshot().writable");
    assert.match(await body(), /Ostunimekirja ei saanud lugeda/);
    assert.doesNotMatch(await body(), /Ostunimekiri on tühi|0 asja ostmata/);
    assert.equal(await evaluate("document.querySelector('#shopping-quick-name').disabled"), true);
    await evaluate("__shoppingFixture.navigate('home');true"); await waitFor("!!document.querySelector('.mm-home-header')");
    assert.match(await body(), /Ostunimekiri pole praegu saadaval/);
    assert.doesNotMatch(await body(), /Ostunimekiri on tühi/);
    await evaluate("__shoppingFixture.seed([])");
    await waitFor("document.querySelector('.mm-shopping-home-count')?.textContent==='Ostunimekiri on tühi'");
    await click('Ava nimekiri'); await waitFor("!!document.querySelector('#shopping-quick-name')");
    assert.match(await body(), /Ostunimekiri on tühi/);
  });
  await t.test('aborted check, delete and clear commits keep the prior visible item states', async () => {
    await evaluate(`__shoppingFixture.seed(${JSON.stringify([item('Juust',1),item('Riiv',2,{category:'home',checkedAt:'2026-10-04T09:00:00.000Z'})])})`);
    await evaluate("window.__shoppingFailure='check';document.querySelector('input[aria-label=\"Märgi ostetuks: Juust\"]').click();true");
    await waitFor("!document.querySelector('input[aria-label=\"Märgi ostetuks: Juust\"]').disabled");
    assert.match(await body(), /Ostu märkimine ei õnnestunud/);
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Märgi ostetuks: Juust\"]').checked"), false);
    assert.match(await body(), /1 asi ostmata/);
    await evaluate("window.__shoppingFailure='remove';true");
    await click('Muuda: Juust'); await click('Kustuta', "document.querySelector('dialog[open]')");
    await click('Kinnita kustutamine', "document.querySelector('dialog[open]')");
    await waitFor("!!document.querySelector('dialog[open] [role=alert]')");
    assert.match(await evaluate("document.querySelector('dialog[open] [role=alert]').textContent"), /Ostu kustutamine ei õnnestunud/);
    assert.equal(await evaluate("!!document.querySelector('button[aria-label=\"Muuda: Juust\"]')"), true);
    await click('Tühista', "document.querySelector('dialog[open]')");
    await evaluate("window.__shoppingFailure='clearChecked';(()=>{const details=document.querySelector('.mm-shopping-checked');if(!details.open)details.querySelector('summary').click();})();true");
    await click('Kustuta ostetud'); await click('Kustuta ostetud', "document.querySelector('dialog[open]')");
    await waitFor("!!document.querySelector('dialog[open] [role=alert]')");
    assert.match(await evaluate("document.querySelector('dialog[open] [role=alert]').textContent"), /Ostetud asjade kustutamine ei õnnestunud/);
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Märgi ostmata: Riiv\"]').checked"), true);
    await click('Tühista', "document.querySelector('dialog[open]')");
    await evaluate("window.__shoppingFailure=null;true");
    assert.deepEqual(await evaluate("window.__shoppingAborts.slice(-3)"), ['check','remove','clearChecked']);
    assert.match(await body(), /Juust/); assert.match(await body(), /Riiv/);
  });
  await t.test('the Home section entrance sequence includes the shopping card and still respects reduced motion', async () => {
    await evaluate("__shoppingFixture.navigate('home');true"); await waitFor("!!document.querySelector('.mm-home-header')");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[aria-labelledby=home-bus-heading]')).animationDelay"), '0.09s');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[aria-labelledby=quick-heading]')).animationDelay"), '0.12s');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-shopping-home')).animationName"), 'none');
    await send('Emulation.setEmulatedMedia', { features: [] });
    await click('Ava nimekiri'); await waitFor("!!document.querySelector('#shopping-quick-name')");
  });
  await t.test('shopping and its edit sheet remain usable at 320px and 390px with 200 percent text', async () => {
    const entries = [item('Piim',1,{quantity:'2 pakki'}),item('Pesugeel',2,{category:'home',note:'Väldi lõhnaaineid'}),
      item('Vitamiinid',3,{category:'pharmacy'}),item('Kingikott',4,{category:'other'}),item('Rätikud',5,{checkedAt:'2026-10-04T09:00:00.000Z'})];
    await evaluate(`__shoppingFixture.replica.clearAuth().then(()=>__shoppingFixture.seed(${JSON.stringify(entries)})).then(()=>__shoppingFixture.sync.run())`);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.mm-shopping-group > h2')].map(element=>element.textContent)"), ['TOIT','KODU','APTEEK','MUU']);
    for (const width of [320,390]) for (const scale of [100,200]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
      await evaluate(`document.documentElement.style.fontSize='${scale}%';window.scrollTo(0,0);true`);
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false);
      assert.ok(await evaluate("[...document.querySelectorAll('.mm-shopping-quick input,.mm-shopping-quick button,.mm-shopping-row button')].every(element=>{const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth+1;})"));
      await shot(`shopping-${width}-${scale}`);
      await click('Muuda: Pesugeel');
      await input('#shopping-note', 'M'.repeat(500));
      assert.equal(await evaluate("document.querySelector('dialog[open]').scrollWidth>document.querySelector('dialog[open]').clientWidth"), false);
      assert.ok(await evaluate("[...document.querySelectorAll('dialog[open] input,dialog[open] select,dialog[open] textarea,dialog[open] button')].every(element=>{const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth+1;})"));
      if (width === 320 && scale === 200) await shot('shopping-sheet-320-200');
      await click('Tühista', "document.querySelector('dialog[open]')");
    }
    await evaluate("__shoppingFixture.navigate('home');true"); await waitFor("!!document.querySelector('.mm-shopping-home')");
    assert.equal(await evaluate("document.querySelector('.mm-shopping-home').scrollWidth>document.querySelector('.mm-shopping-home').clientWidth"), false);
    await evaluate("document.querySelector('.mm-shopping-home').scrollIntoView({block:'center',behavior:'instant'});true");
    await shot('shopping-home-390-200');
    await evaluate("document.documentElement.style.fontSize='';true");
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  });
}
