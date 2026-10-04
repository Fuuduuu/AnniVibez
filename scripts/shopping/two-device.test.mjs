import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shoppingHarness} from './client-harness.mjs';

const authFrom=result=>({key:'device',deviceToken:result.deviceSession.token,householdId:result.household.id,
  userId:result.account.userId,sessionId:result.deviceSession.id});
async function post(url,path,body,token){
  const response=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  assert.equal(response.status,201,'Local real auth route '+path);return response.json();
}

test('two isolated devices share shopping through real authenticated handlers and local D1',{timeout:120000},async t=>{
  const a=await shoppingHarness({backend:true});let b,authA,authB,link;
  try{
    b=await shoppingHarness({sharedBackend:a});
    await t.test('OWNER setup and device-link bootstrap retain both same-name local items by identity',async()=>{
      const localA=await a.evaluate("client.store.add({name:'Piim'})");
      const localB=await b.evaluate("client.store.add({name:'Piim'})");
      assert.notEqual(localA.id,localB.id);
      authA=authFrom(await post(a.url,'/api/auth/create-household',{userName:'Shopping owner',householdName:'Local shopping test',deviceName:'A'}));
      await a.evaluate(`client.calendar.install(${JSON.stringify(authA)}).then(()=>client.store.refresh()).then(()=>client.sync.run())`);
      link=await post(a.url,'/api/auth/device-link',{},authA.deviceToken);
      authB=authFrom(await post(a.url,'/api/auth/claim-device',{linkToken:link.linkToken,deviceName:'B'}));
      assert.equal(authB.householdId,authA.householdId);assert.equal(authB.userId,authA.userId);assert.notEqual(authB.deviceToken,authA.deviceToken);
      await b.evaluate(`client.calendar.setupStatus('claiming').then(()=>client.calendar.installJoined(${JSON.stringify(authB)})).then(()=>client.store.refresh()).then(()=>client.sync.run())`);
      await a.evaluate('client.sync.run()');
      for(const h of[a,b])assert.deepEqual((await h.evaluate('client.store.getSnapshot().items')).map(row=>row.id).sort(),[localA.id,localB.id].sort());
      for(const[table,count]of[['households',1],['users',1],['device_sessions',2],['shopping_items',2]])assert.equal((await a.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,count);
    });
    let id;
    await t.test('A adds, B receives and checks, A receives the acknowledged check',async()=>{
      const row=await a.evaluate("client.store.add({name:'Leib',quantity:'2 tk'})");id=row.id;
      await a.evaluate('client.sync.run()');await b.evaluate('client.sync.run()');
      assert.equal((await b.evaluate(`client.row('Leib')`)).payload.quantity,'2 tk');
      await b.evaluate(`client.store.check(${JSON.stringify(id)},true).then(()=>client.sync.run())`);
      await a.evaluate('client.sync.run()');assert.ok((await a.evaluate("client.row('Leib')")).payload.checkedAt);
    });
    await t.test('disjoint quantity and check mutations on one stale revision both survive',async()=>{
      await Promise.all([a.evaluate(`client.store.update(${JSON.stringify(id)},{quantity:'3 tk'})`),b.evaluate(`client.store.check(${JSON.stringify(id)},false)`)]);
      await a.evaluate('client.sync.run()');await b.evaluate('client.sync.run()');await a.evaluate('client.sync.run()');
      for(const h of[a,b]){
        const snapshot=await h.evaluate('client.snapshot()'),row=snapshot.records.find(row=>row.id===id);
        assert.equal(row.payload.quantity,'3 tk');assert.equal(row.payload.checkedAt,null);assert.equal(snapshot.conflicts.length,0);assert.equal(snapshot.outbox.length,0);
      }
    });
    await t.test('same-field conflict visibly retains B local name and its durable pending mutation',async()=>{
      await a.evaluate(`client.store.update(${JSON.stringify(id)},{name:'A nimi'})`);
      await b.evaluate(`client.store.update(${JSON.stringify(id)},{name:'B nimi'})`);
      await a.evaluate('client.sync.run()');await b.evaluate('client.sync.run()');
      const conflict=await b.evaluate('client.snapshot()');
      assert.equal(conflict.records.find(row=>row.id===id).payload.name,'B nimi');
      assert.equal(conflict.conflicts[0].entityId,id);assert.ok(conflict.outbox.some(row=>row.entityId===id));
      assert.equal(await b.evaluate('client.sync.getSnapshot().status'),'attention');
      const server=await a.db.prepare('SELECT payload_json FROM shopping_items WHERE id=?').bind(id).first();assert.equal(JSON.parse(server.payload_json).name,'A nimi');
      await b.reload();assert.equal((await b.evaluate('client.snapshot()')).records.find(row=>row.id===id).payload.name,'B nimi');
    });
    await t.test('concurrent different-item writes survive and use only shopping cursor/outbox',async()=>{
      await Promise.all([a.evaluate("client.store.add({name:'A sõltumatu'})"),b.evaluate("client.store.add({name:'B sõltumatu'})")]);
      await Promise.all([a.evaluate('client.sync.run()'),b.evaluate('client.sync.run()')]);
      await a.evaluate('client.sync.run()');await b.evaluate('client.sync.run()');
      for(const h of[a,b]){
        const rows=await h.evaluate('client.store.getSnapshot().items');assert.ok(rows.some(row=>row.name==='A sõltumatu'));assert.ok(rows.some(row=>row.name==='B sõltumatu'));
        assert.equal((await h.evaluate('client.calendar.snapshot()')).state.serverCursor,0);
        assert.equal((await h.evaluate('client.calendar.snapshot()')).outbox.length,0);
      }
    });
    await t.test('offline addition survives reload and reconnect sends it to B',async()=>{
      await a.evaluate("controls.offline=true;client.store.add({name:'Offline õun'}).then(()=>client.sync.run())");
      assert.equal(await a.evaluate('client.sync.getSnapshot().status'),'waiting');
      const before=await a.evaluate('client.snapshot()');assert.ok(before.outbox.some(row=>row.patch.name==='Offline õun'));
      await a.reload();assert.deepEqual((await a.evaluate('client.snapshot()')).outbox,before.outbox);
      await a.evaluate('client.sync.run()');await b.evaluate('client.sync.run()');assert.ok((await b.evaluate('client.store.getSnapshot().items')).some(row=>row.name==='Offline õun'));
    });
    await t.test('lost reply retries the same mutation id without duplicate item or journal entry',async()=>{
      await a.evaluate("controls.loseReply=true;client.store.add({name:'Üks kord'}).then(()=>client.sync.run())");
      const before=await a.evaluate('client.snapshot()'),pending=before.outbox.find(row=>row.patch.name==='Üks kord');assert.ok(pending);
      await a.evaluate('client.sync.run()');const after=await a.evaluate('client.snapshot()');assert.equal(after.outbox.length,0);
      assert.equal((await a.db.prepare('SELECT COUNT(*) AS n FROM applied_mutations WHERE mutation_id=?').bind(pending.mutationId).first()).n,1);
      assert.equal((await a.db.prepare('SELECT COUNT(*) AS n FROM change_log WHERE entity_type=? AND entity_id=?').bind('shopping_item',pending.entityId).first()).n,1);
    });
    await t.test('delete is received as a tombstone and no credential enters shopping UI/outbox/payload',async()=>{
      const row=await a.evaluate("client.store.add({name:'Kustutatav'})");await a.evaluate('client.sync.run()');await b.evaluate('client.sync.run()');
      await a.evaluate(`client.store.remove(${JSON.stringify(row.id)}).then(()=>client.sync.run())`);await b.evaluate('client.sync.run()');
      const tombstone=(await b.evaluate('client.snapshot()')).records.find(item=>item.id===row.id);assert.ok(tombstone.deletedAt);
      assert.ok(!(await b.evaluate('client.store.getSnapshot().items')).some(item=>item.id===row.id));
      for(const h of[a,b]){
        const bytes=JSON.stringify(await h.evaluate('(async()=>({view:client.store.getSnapshot(),outbox:(await client.snapshot()).outbox,pushes:controls.pushes}))()'));
        for(const secret of[authA.deviceToken,authB.deviceToken,link.linkToken])assert.equal(bytes.includes(secret),false);
      }
    });
  }finally{await b?.close();await a.close();}
});

test('linked device preserves Milk/Bread beside household Eggs/Coffee and adopts local items once',{timeout:90000},async()=>{
  const a=await shoppingHarness({backend:true});let b;
  try{
    b=await shoppingHarness({sharedBackend:a});
    const authA=authFrom(await post(a.url,'/api/auth/create-household',{userName:'Owner',householdName:'Join preservation test',deviceName:'A'}));
    await a.evaluate(`client.calendar.install(${JSON.stringify(authA)}).then(()=>client.store.refresh())`);
    const household=await a.evaluate(`Promise.all([client.store.add({name:'Eggs'}),client.store.add({name:'Coffee'})])`);
    await a.evaluate('client.sync.run()');
    const local=await b.evaluate(`Promise.all([client.store.add({name:'Milk'}),client.store.add({name:'Bread'})])`);
    assert.deepEqual((await b.evaluate('client.snapshot()')).outbox,[]);
    const link=await post(a.url,'/api/auth/device-link',{},authA.deviceToken);
    const authB=authFrom(await post(a.url,'/api/auth/claim-device',{linkToken:link.linkToken,deviceName:'B'}));
    await b.evaluate(`client.calendar.setupStatus('claiming').then(()=>client.calendar.installJoined(${JSON.stringify(authB)})).then(()=>client.store.refresh())`);
    const pending=await b.evaluate('client.store.prepareSync().then(()=>client.snapshot())');
    assert.deepEqual(pending.outbox.map(row=>row.entityId).sort(),local.map(row=>row.id).sort());
    assert.ok(pending.outbox.every(row=>row.operation==='CREATE'&&row.baseRevision===0));
    await b.reload();await b.evaluate('Promise.all([client.sync.run(),client.sync.run(),client.sync.run()])');
    await a.evaluate('client.sync.run()');
    const expectedIds=[...local,...household].map(row=>row.id).sort();
    for(const h of[a,b]){
      const snapshot=await h.evaluate('client.snapshot()');
      assert.deepEqual(snapshot.records.map(row=>row.id).sort(),expectedIds);
      assert.deepEqual(snapshot.records.map(row=>row.payload.name).sort(),['Bread','Coffee','Eggs','Milk']);
      assert.ok(snapshot.records.every(row=>row.syncStatus==='synced'&&row.revision===1));
      assert.deepEqual(snapshot.outbox,[]);
    }
    await b.reload();await b.evaluate('client.sync.run()');
    assert.deepEqual(await b.evaluate('controls.pushes'),[]);
    for(const [table,count]of[['households',1],['users',1],['device_sessions',2],['shopping_items',4],['applied_mutations',4]]){
      assert.equal((await a.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,count,table);
    }
  }finally{await b?.close();await a.close();}
});

test('joining with a colliding unsynced shopping identity preserves both payloads in an explicit conflict',{timeout:90000},async()=>{
  const a=await shoppingHarness({backend:true});let b;
  try{
    b=await shoppingHarness({sharedBackend:a});
    const authA=authFrom(await post(a.url,'/api/auth/create-household',{userName:'Owner',householdName:'Collision test',deviceName:'A'}));
    await a.evaluate(`client.calendar.install(${JSON.stringify(authA)}).then(()=>client.store.refresh())`);
    const remote=await a.evaluate("client.store.add({name:'Household Coffee',quantity:'1 pack',note:'Server must survive'})");
    await a.evaluate('client.sync.run()');
    const local={...remote,name:'Local Milk',quantity:'2 l',note:'Local must survive'};
    await b.evaluate(`client.replica.putShoppingItem({id:${JSON.stringify(local.id)},payload:${JSON.stringify(local)},revision:0,
      updatedAt:${JSON.stringify(local.createdAt)},deletedAt:null,syncStatus:'local',householdId:null}).then(()=>client.store.refresh())`);
    const link=await post(a.url,'/api/auth/device-link',{},authA.deviceToken);
    const authB=authFrom(await post(a.url,'/api/auth/claim-device',{linkToken:link.linkToken,deviceName:'B'}));
    await b.evaluate(`client.calendar.setupStatus('claiming').then(()=>client.calendar.installJoined(${JSON.stringify(authB)})).then(()=>client.store.refresh()).then(()=>client.sync.run())`);
    const snapshot=await b.evaluate('client.snapshot()');
    assert.equal(snapshot.records[0].syncStatus,'conflict');
    assert.deepEqual(snapshot.records[0].payload,local);
    assert.equal(snapshot.conflicts.length,1);
    assert.deepEqual(snapshot.conflicts[0].localRecord.payload,local);
    assert.deepEqual(snapshot.conflicts[0].remoteRecord.payload,remote);
    assert.equal(snapshot.outbox.length,1,'retain the unsent local CREATE instead of dropping local data');
    assert.deepEqual(await b.evaluate('controls.pushes'),[],'the conflicting CREATE must not overwrite household data');
    const server=await a.db.prepare('SELECT payload_json,revision FROM shopping_items WHERE id=?').bind(remote.id).first();
    assert.deepEqual(JSON.parse(server.payload_json),remote);assert.equal(server.revision,1);
    await b.reload();await b.evaluate('client.sync.run()');
    const reloaded=await b.evaluate('client.snapshot()');
    assert.deepEqual(reloaded.conflicts[0].localRecord.payload,local);
    assert.deepEqual(reloaded.conflicts[0].remoteRecord.payload,remote);
    assert.deepEqual(reloaded.outbox,snapshot.outbox);
    assert.deepEqual(await b.evaluate('controls.pushes'),[]);
  }finally{await b?.close();await a.close();}
});
