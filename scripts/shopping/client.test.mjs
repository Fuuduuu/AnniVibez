import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shoppingHarness} from './client-harness.mjs';
const options={timeout:60000};

test('offline shopping add/edit/check/uncheck/delete preserve final local state without auth or mutation history',options,async()=>{
  const h=await shoppingHarness();
  try{
    const result=await h.evaluate(`(async()=>{
      const row=await client.store.add({name:'  Piim ',quantity:'2 tk'});
      await client.store.update(row.id,{quantity:'1 l',note:'Jahutatud'});
      await client.store.check(row.id,true);await client.store.check(row.id,false);
      const before=await client.snapshot();await client.store.remove(row.id);
      return {before,after:await client.snapshot(),view:client.store.getSnapshot()};
    })()`);
    assert.equal(result.before.records[0].payload.name,'Piim');assert.equal(result.before.records[0].payload.quantity,'1 l');
    assert.equal(result.before.records[0].payload.checkedAt,null);assert.equal(result.after.records[0].deletedAt,'2026-10-04T08:00:00.000Z');
    assert.deepEqual(result.before.outbox,[]);assert.deepEqual(result.after.outbox,[]);
    assert.equal(result.before.records[0].syncStatus,'local');assert.equal(result.after.records[0].syncStatus,'local');
    assert.equal(result.after.records[0].revision,0);assert.equal(result.after.sequence,0);
    assert.deepEqual(result.view.items,[]);assert.equal(result.after.auth,undefined);
    assert.deepEqual(await h.evaluate('controls.calls'),[]);
    await h.reload();assert.deepEqual((await h.evaluate('client.snapshot()')).outbox,result.after.outbox);
  }finally{await h.close();}
});
test('failed local commit retains prior bytes and rejects without publishing success',options,async()=>{
  const h=await shoppingHarness();
  try{
    const result=await h.evaluate(`(async()=>{await client.store.add({name:'Leib'});const before=await client.snapshot();
      controls.abortNextCommit=true;let rejected=false;try{await client.store.add({name:'Ei salvestu'})}catch{rejected=true}
      return {before,after:await client.snapshot(),view:client.store.getSnapshot(),rejected};})()`);
    assert.equal(result.rejected,true);assert.deepEqual(result.after,result.before);assert.deepEqual(result.view.items.map(item=>item.name),['Leib']);
  }finally{await h.close();}
});
test('two same-origin tabs serialize distinct adds and clearing purchased re-reads current data',options,async()=>{
  const a=await shoppingHarness();let b;
  try{
    // One browser origin/profile is opened twice through a CDP target; independent store handles share IndexedDB.
    b=await a.newTab();
    await Promise.all([a.evaluate(`Promise.all(Array.from({length:4},(_,i)=>client.store.add({name:'A '+i}))).then(()=>true)`),
      b.evaluate(`Promise.all(Array.from({length:4},(_,i)=>client.store.add({name:'B '+i}))).then(()=>true)`)]);
    const first=await a.evaluate('client.snapshot()');
    assert.equal(first.records.length,8);assert.deepEqual(first.outbox,[]);assert.equal(first.sequence,0);
    assert.ok(first.records.every(row=>row.syncStatus==='local'&&row.revision===0));
    assert.equal(first.records.filter(row=>row.payload.name.startsWith('A ')).length,4);
    assert.equal(first.records.filter(row=>row.payload.name.startsWith('B ')).length,4);
    const cleared=await a.evaluate(`(async()=>{const rows=(await client.snapshot()).records;await client.store.check(rows[0].id,true);await client.store.check(rows[1].id,true);await client.store.clearChecked();return client.store.getSnapshot();})()`);
    assert.equal(cleared.items.length,6);assert.ok(cleared.items.every(item=>item.checkedAt===null));
    await b.evaluate('client.store.refresh()');
    assert.deepEqual(await b.evaluate('client.store.getSnapshot().items'),cleared.items);
  }finally{await b?.close();await a.close();}
});
test('shopping shared state filters generic calendar outbox and keeps its own cursor',options,async()=>{
  const h=await shoppingHarness();
  try{
    const result=await h.evaluate(`(async()=>{
      await client.install({key:'device',deviceToken:'m1s_'+'a'.repeat(43),householdId:'hld_11111111-1111-4111-8111-111111111111',
        userId:'usr_22222222-2222-4222-8222-222222222222',sessionId:'ses_33333333-3333-4333-8333-333333333333'});
      await client.store.prepareSync();
      const mutationId=crypto.randomUUID();await client.replica.enqueueOutbox({mutationId,entityType:'calendar_event',entityId:'calendar-protected',operation:'CREATE',baseRevision:0,patch:{title:'Protected'},createdAt:'2026-10-04T08:00:00.000Z',attemptCount:0,lastAttemptAt:null});
      await client.replica.transact('syncState','readwrite',({stores})=>{stores.syncState.put({key:'calendar',serverCursor:17,bootstrapCompleted:true,lastSuccessfulSyncAt:null,lastAttemptAt:null});});
      await client.store.add({name:'Pesugeel',category:'home'});
      return {shopping:await client.snapshot(),calendar:await client.calendar.snapshot(),all:await client.all('outbox')};
    })()`);
    assert.equal(result.shopping.state.key,'shopping');assert.equal(result.shopping.state.serverCursor,0);
    assert.equal(result.shopping.outbox.length,1);assert.equal(result.shopping.outbox[0].entityType,'shopping_item');
    assert.equal(result.calendar.state.serverCursor,17);assert.equal(result.calendar.outbox.length,1);
    assert.equal(result.all.length,2);assert.deepEqual(result.all.map(row=>row.sequence).sort((a,b)=>a-b),[1,2]);
  }finally{await h.close();}
});
