import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shoppingHarness} from './client-harness.mjs';

const options={timeout:60000};

test('LEGACY/no-auth shopping is durable local data with zero generic outbox mutations',options,async()=>{
  const h=await shoppingHarness({storageMode:'revert'});
  try{
    const result=await h.evaluate(`(async()=>{
      const item=await client.store.add({name:'Milk'});
      return {state:client.controller.getState(),item,snapshot:await client.snapshot(),outbox:await client.all('outbox'),ids:controls.ids};
    })()`);
    assert.equal(result.state,'LEGACY');
    assert.equal(result.snapshot.records[0].id,result.item.id);
    assert.equal(result.snapshot.records[0].syncStatus,'local');
    assert.equal(result.snapshot.records[0].revision,0);
    assert.deepEqual(result.outbox,[]);
    assert.equal(result.snapshot.sequence,0);
    assert.deepEqual(result.ids,[result.item.id],'allocate the local item identity, never a mutation ID');
    await h.reload();
    assert.deepEqual((await h.evaluate('client.snapshot()')).records,result.snapshot.records);
    assert.deepEqual(await h.evaluate('client.all("outbox")'),[]);
  }finally{await h.close();}
});

test('real stale migration reset reaches READY without deleting local-only shopping',options,async()=>{
  const h=await shoppingHarness({storageMode:'revert'});
  try{
    const result=await h.evaluate(`(async()=>{
      localStorage.setItem('majamajandus_household_profile_v1',JSON.stringify({version:1,profile:{name:'Before',address:''}}));
      const migration=await client.migrate();
      const oldMarker=await client.replica.getMeta('legacyMigrationV1');
      const item=await client.store.add({name:'Milk'});
      localStorage.setItem('majamajandus_household_profile_v1',JSON.stringify({version:1,profile:{name:'After',address:''}}));
      const forward=client.makeController();
      const boot=await forward.boot();
      const marker=await forward.replica.getMeta('legacyMigrationV1');
      const household=await forward.replica.getHouseholdProfile();
      const shopping=await client.all('shoppingItems');
      await forward.close();
      return {migration,oldMarker,marker,boot,household,shopping,item,outbox:await client.all('outbox')};
    })()`);
    assert.equal(result.migration.status,'completed');
    assert.equal(result.boot.state,'READY','local shopping must not block the real stale-reset guard');
    assert.notEqual(result.marker.preparationId,result.oldMarker.preparationId,'stale marker was actually reset and migrated');
    assert.equal(result.household.payload.name,'After');
    assert.equal(result.shopping[0].id,result.item.id);
    assert.equal(result.shopping[0].syncStatus,'local');
    assert.deepEqual(result.outbox,[]);
  }finally{await h.close();}
});

test('real completed-revert reset reaches READY and retains post-revert local shopping',options,async()=>{
  const h=await shoppingHarness();
  try{
    const result=await h.evaluate(`(async()=>{
      const oldAuthority=await client.replica.getMeta('storageAuthorityV1');
      const revert=client.makeController('revert');
      const reverted=await revert.boot();
      const local=client.shoppingFor(revert);
      const item=await local.add({name:'Bread'});
      const before=await local.snapshot();
      const forward=client.makeController();
      const boot=await forward.boot();
      const authority=await forward.replica.getMeta('storageAuthorityV1');
      const shopping=await client.all('shoppingItems');
      local.dispose();await revert.close();await forward.close();
      return {oldAuthority,reverted,item,before,boot,authority,shopping,outbox:await client.all('outbox')};
    })()`);
    assert.equal(result.reverted.state,'LEGACY');
    assert.equal(result.boot.state,'READY','must not return reverted-reset-blocked for local shopping');
    assert.notEqual(result.authority.switchId,result.oldAuthority.switchId,'reverted authority was actually reset');
    assert.equal(result.shopping[0].id,result.item.id);
    assert.deepEqual(result.shopping,result.before.records);
    assert.deepEqual(result.outbox,[]);
  }finally{await h.close();}
});

test('real pending calendar outbox continues to block stale and completed-revert resets',options,async()=>{
  for(const kind of ['stale','reverted']){
    const h=await shoppingHarness({storageMode:kind==='stale'?'revert':'forward'});
    try{
      const result=await h.evaluate(`(async()=>{
        if(${JSON.stringify(kind)}==='stale'){
          await client.migrate();
          localStorage.setItem('majamajandus_household_profile_v1',JSON.stringify({version:1,profile:{name:'Changed',address:''}}));
        }else{
          const revert=client.makeController('revert');await revert.boot();await revert.close();
        }
        const pending={mutationId:crypto.randomUUID(),entityType:'calendar_event',entityId:'calendar-protected',operation:'UPDATE',
          baseRevision:1,patch:{title:'Must survive'},createdAt:'2026-10-04T08:00:00.000Z',attemptCount:0,lastAttemptAt:null};
        await client.replica.enqueueOutbox(pending);
        const before=await client.all('outbox');
        const markerBefore=await client.replica.getMeta('legacyMigrationV1');
        const authorityBefore=await client.replica.getMeta('storageAuthorityV1');
        const forward=client.makeController();const boot=await forward.boot();await forward.close();
        return {boot,before,after:await client.all('outbox'),markerBefore,markerAfter:await client.replica.getMeta('legacyMigrationV1'),
          authorityBefore,authorityAfter:await client.replica.getMeta('storageAuthorityV1')};
      })()`);
      assert.deepEqual(result.after,result.before,kind);
      assert.deepEqual(result.markerAfter,result.markerBefore,kind);
      assert.deepEqual(result.authorityAfter,result.authorityBefore,kind);
      if(kind==='stale')assert.equal(result.boot.state,'LEGACY');
      else assert.deepEqual(result.boot,{state:'STORAGE_UNAVAILABLE',reason:'reverted-reset-blocked'});
    }finally{await h.close();}
  }
});

test('READY adoption queues one final surviving CREATE atomically and never repeats it after startup or acknowledgement',options,async()=>{
  const h=await shoppingHarness({backend:true});let tab;
  try{
    const local=await h.evaluate(`(async()=>{
      const kept=await client.store.add({name:'Milk',quantity:'1 tk'});
      await client.store.update(kept.id,{quantity:'2 tk',note:'Final local contents'});
      await client.store.check(kept.id,true);await client.store.check(kept.id,false);
      const deleted=await client.store.add({name:'Never upload'});
      await client.store.update(deleted.id,{quantity:'3 tk'});await client.store.check(deleted.id,true);await client.store.remove(deleted.id);
      return {keptId:kept.id,deletedId:deleted.id,snapshot:await client.snapshot()};
    })()`);
    assert.deepEqual(local.snapshot.outbox,[]);
    assert.equal(local.snapshot.records.find(row=>row.id===local.keptId).syncStatus,'local');
    const response=await fetch(h.url+'/api/auth/create-household',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({userName:'Adoption owner',householdName:'Local adoption test',deviceName:'A'})});
    assert.equal(response.status,201);
    const setup=await response.json();
    const auth={key:'device',deviceToken:setup.deviceSession.token,householdId:setup.household.id,userId:setup.account.userId,sessionId:setup.deviceSession.id};
    const aborted=await h.evaluate(`(async()=>{
      await client.calendar.install(${JSON.stringify(auth)});await client.store.refresh();
      const before=await client.snapshot();controls.abortNextCommit=true;
      let failed=false;try{await client.store.prepareSync()}catch{failed=true}
      return {failed,before,after:await client.snapshot()};
    })()`);
    assert.equal(aborted.failed,true);
    assert.deepEqual(aborted.after,aborted.before,'interrupted adoption must not leave pending data without its CREATE');
    const pending=await h.evaluate(`Promise.all(Array.from({length:4},()=>client.store.prepareSync())).then(()=>client.snapshot())`);
    assert.equal(pending.outbox.length,1,'adopt final local state once rather than replaying edit history');
    const mutation=pending.outbox[0],record=pending.records.find(row=>row.id===local.keptId);
    assert.equal(mutation.entityId,local.keptId);assert.equal(mutation.operation,'CREATE');assert.equal(mutation.baseRevision,0);
    assert.equal(mutation.householdId,auth.householdId);
    assert.deepEqual(mutation.patch,local.snapshot.records.find(row=>row.id===local.keptId).payload);
    assert.equal(record.syncStatus,'pending');assert.equal(record.revision,0);
    assert.equal(record.payload.quantity,'2 tk');assert.equal(record.payload.checkedAt,null);
    assert.equal(pending.records.find(row=>row.id===local.deletedId).syncStatus,'local');
    await h.reload();tab=await h.newTab();
    await Promise.all([h.evaluate('client.store.prepareSync()'),tab.evaluate('client.store.prepareSync()')]);
    assert.deepEqual((await h.evaluate('client.snapshot()')).outbox,pending.outbox,'reload and another tab reuse the durable CREATE');
    await tab.close();tab=null;
    await h.evaluate('client.sync.run()');
    const synced=await h.evaluate('client.snapshot()');
    assert.deepEqual(synced.outbox,[]);assert.equal(synced.records.find(row=>row.id===local.keptId).syncStatus,'synced');
    assert.equal(synced.records.find(row=>row.id===local.keptId).revision,1);
    const rows=await h.db.prepare('SELECT id,payload_json FROM shopping_items').all();
    assert.deepEqual(rows.results.map(row=>row.id),[local.keptId]);
    assert.deepEqual(JSON.parse(rows.results[0].payload_json),mutation.patch);
    await h.reload();await h.evaluate('Promise.all([client.sync.run(),client.sync.run(),client.sync.run()])');
    assert.deepEqual((await h.evaluate('client.snapshot()')).outbox,[]);
    assert.deepEqual(await h.evaluate('controls.pushes'),[],'acknowledged item must not be re-adopted');
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM applied_mutations').first()).n,1);
  }finally{await tab?.close();await h.close();}
});
