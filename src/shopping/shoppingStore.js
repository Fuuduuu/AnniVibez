import {requestResult} from '../storage/indexedDb.js';
import {runReplicaMutation} from '../storage/runtimeWrites.js';
import {validateDeviceAuthRecord} from '../storage/localReplica.js';
import {reconcileMergeAcknowledgement} from '../sync/mergeAcknowledgement.js';
import {createShoppingItem,updateShoppingItem,SHOPPING_EDIT_FIELDS,SHOPPING_FIELDS} from './model.js';
import {emptyShoppingState,validateShoppingRecord,validateShoppingSyncState,validateShoppingOutbox,validateShoppingConflict} from './records.js';

const STORES=['auth','shoppingItems','outbox','syncState','conflicts'];

export class ShoppingSelectionChangedError extends Error {
  constructor() {
    super('Ostude valik muutus. Sulge kinnitus, värskenda nimekirja ja vali uuesti.');
  }
}
async function read(stores) {
  const [auth,records,allOutbox,state,sequence,allConflicts]=await Promise.all([
    requestResult(stores.auth.get('device')),requestResult(stores.shoppingItems.getAll()),
    requestResult(stores.outbox.index('bySequence').getAll()),requestResult(stores.syncState.get('shopping')),
    requestResult(stores.meta.get('outboxSequence')),requestResult(stores.conflicts.getAll()),
  ]);
  if(auth!==undefined)validateDeviceAuthRecord(auth);
  records.forEach(validateShoppingRecord);
  const outbox=allOutbox.filter(row=>row.entityType==='shopping_item');outbox.forEach(validateShoppingOutbox);
  const conflicts=allConflicts.filter(row=>row.entityType==='shopping_item');conflicts.forEach(validateShoppingConflict);
  const counter=sequence?.value??0;if(!Number.isSafeInteger(counter)||counter<0)throw new TypeError('Invalid shopping sequence');
  return {auth,records,outbox,state:validateShoppingSyncState(state??emptyShoppingState()),sequence:counter,conflicts};
}
function projected(current,plan) {
  const next={...current,records:[...current.records],outbox:[...current.outbox],conflicts:[...current.conflicts]};
  const fields={shoppingItems:['records','id'],outbox:['outbox','mutationId'],conflicts:['conflicts','id']};
  for(const put of plan.puts){
    if(fields[put.store]){const [field,key]=fields[put.store];next[field]=next[field].filter(row=>row[key]!==put.record[key]);next[field].push(put.record);}
    else if(put.store==='syncState')next.state=put.record;
    else if(put.store==='meta'&&put.record.key==='outboxSequence')next.sequence=put.record.value;
  }
  for(const removal of plan.deletes){const [field,key]=fields[removal.store];next[field]=next[field].filter(row=>row[key]!==removal.key);}
  next.outbox.sort((a,b)=>a.sequence-b.sequence);return next;
}
export function createShoppingStore({replica,authority=null,newId,clock,isWritable=()=>true,onCommitted=()=>{}}) {
  const listeners=new Set();let disposed=false,generation=0;
  let view={items:[],conflicts:[],loading:true,writable:false,error:null,hasAuth:false,pendingCount:0};
  const publish=current=>{
    if(disposed)return;
    view={items:current.records.filter(row=>!row.deletedAt).map(row=>({...row.payload,syncStatus:row.syncStatus})),
      conflicts:current.conflicts.map(row=>({entityId:row.entityId,localItem:row.localRecord.payload,remoteItem:row.remoteRecord?.payload??null,
        remoteDeleted:!!row.remoteRecord?.deletedAt,result:{status:row.result?.status,code:row.result?.code}})),
      loading:false,writable:isWritable(),error:null,hasAuth:!!current.auth,pendingCount:current.outbox.length};
    listeners.forEach(listener=>listener());
  };
  const snapshot=()=>replica.transact(['meta',...STORES],'readonly',({stores})=>read(stores));
  async function refresh(){
    const mine=++generation;
    try{const current=await snapshot();if(mine===generation)publish(current);return current;}
    catch(error){if(mine===generation&&!disposed){view={...view,loading:false,writable:false,error:'Ostunimekirja ei saanud lugeda. Salvestatud andmeid ei kirjutata üle.'};listeners.forEach(listener=>listener());}throw error;}
  }
  async function mutate(planner,kind='local'){
    if(disposed||!isWritable())throw new Error('Ostunimekirja salvestus pole praegu saadaval.');
    const plan=current=>{
      if(disposed||!isWritable())throw new Error('Ostunimekirja salvestus pole praegu saadaval.');
      const planned=planner(current);
      return {...planned,result:{value:planned.result,next:projected(current,planned)}};
    };
    let outcome;
    if(authority)outcome=await runReplicaMutation({replica,authority,domain:'shopping',stores:STORES,read,plan});
    else outcome=await replica.transact(['meta',...STORES],'readwrite',async({stores})=>{
      // Shopping is still IndexedDB-owned in LEGACY. Never write across an active shared-authority cutover.
      const owner=await requestResult(stores.meta.get('storageAuthorityV1'));
      if(owner!==undefined&&owner.status!=='reverted')throw new Error('Salvestuse olek muutus. Ava rakendus uuesti.');
      const planned=plan(await read(stores));
      for(const put of planned.puts){
        if(put.store==='shoppingItems')validateShoppingRecord(put.record);
        if(put.store==='outbox')validateShoppingOutbox(put.record);
        if(put.store==='syncState')validateShoppingSyncState(put.record);
        if(put.store==='conflicts')validateShoppingConflict(put.record);
      }
      for(const put of planned.puts)stores[put.store].put(put.record);
      for(const removal of planned.deletes)stores[removal.store].delete(removal.key);
      return planned.result;
    });
    ++generation;publish(outcome.next);onCommitted(kind);return outcome.value;
  }
  function queue(current,records,changes){
    // Device-local edits are not remote mutations. Keep their final state without allocating IDs
    // or touching the shared outbox/cursor that C4 uses to guard storage resets.
    if(!current.auth)return {puts:records.map(record=>({store:'shoppingItems',record:{...record,syncStatus:'local'}})),deletes:[],result:records[0]?.payload??null};
    let sequence=current.sequence;const puts=[];
    const queued=[...current.outbox];
    for(const change of changes){
      let record=records.find(row=>row.id===change.id);
      const previous=queued.filter(row=>row.entityId===record.id);
      const before=current.records.find(row=>row.id===record.id);
      const unadopted=before?.syncStatus==='local'&&before.revision===0&&previous.length===0;
      // A local item deleted before its first CREATE never existed remotely.
      if(unadopted&&record.deletedAt){
        puts.push({store:'shoppingItems',record:{...record,syncStatus:'local',householdId:before.householdId}});
        continue;
      }
      record={...record,householdId:current.auth.householdId};
      puts.push({store:'shoppingItems',record});
      const operation=unadopted?'CREATE':change.operation;
      const mutation={mutationId:newId(),entityType:'shopping_item',entityId:record.id,operation,
        baseRevision:operation==='CREATE'?0:record.revision+previous.length,patch:unadopted?record.payload:change.patch,createdAt:clock(),
        attemptCount:0,lastAttemptAt:null,sequence:++sequence,householdId:record.householdId};
      if(!Number.isSafeInteger(sequence))throw new RangeError('Shopping sequence exhausted');
      validateShoppingOutbox(mutation);queued.push(mutation);puts.push({store:'outbox',record:mutation});
    }
    if(sequence!==current.sequence)puts.push({store:'meta',record:{key:'outboxSequence',value:sequence}});
    return {puts,deletes:[],result:records[0]?.payload??null};
  }
  const existing=(current,id)=>{
    const record=current.records.find(row=>row.id===id);
    if(!record||record.deletedAt)throw new Error('See ost on vahepeal kustutatud.');
    if(record.householdId!==null&&record.householdId!==current.auth?.householdId)throw new Error('Ost kuulub teise majapidamisse.');
    return record;
  };
  function add(input){return mutate(current=>{
    const payload=createShoppingItem(input,{newId,clock});
    if(current.records.some(row=>row.id===payload.id))throw new Error('Ostu ID on juba kasutusel.');
    const record={id:payload.id,payload,revision:0,updatedAt:payload.createdAt,deletedAt:null,syncStatus:'pending',householdId:current.auth?.householdId??null};
    return queue(current,[record],[{id:record.id,operation:'CREATE',patch:payload}]);
  });}
  function update(id,patch){return mutate(current=>{
    const before=existing(current,id),payload=updateShoppingItem(before.payload,patch);
    const delta=Object.fromEntries(SHOPPING_EDIT_FIELDS.filter(key=>before.payload[key]!==payload[key]).map(key=>[key,payload[key]]));
    if(!Object.keys(delta).length)return {puts:[],deletes:[],result:before.payload};
    const record={...before,payload,updatedAt:clock(),syncStatus:before.syncStatus==='conflict'?'conflict':'pending'};
    return queue(current,[record],[{id,operation:'UPDATE',patch:delta}]);
  });}
  function removeMany(select){return mutate(current=>{
    const chosen=select(current.records.filter(row=>!row.deletedAt));
    for(const row of chosen)existing(current,row.id);
    const records=chosen.map(row=>({...row,deletedAt:clock(),updatedAt:clock(),syncStatus:row.syncStatus==='conflict'?'conflict':'pending'}));
    return queue(current,records,records.map(row=>({id:row.id,operation:'DELETE',patch:{}})));
  });}
  function clearChecked(confirmedItems) {
    if (!Array.isArray(confirmedItems) || !confirmedItems.length) throw new TypeError('Missing confirmed shopping items');
    const confirmed = new Map(confirmedItems.map(item => [item.id, { ...item }]));
    if (confirmed.size !== confirmedItems.length) throw new TypeError('Duplicate confirmed shopping items');
    return removeMany(available => {
      const chosen = available.filter(row => confirmed.has(row.id));
      // A sync acknowledgement can change bookkeeping without changing what the user confirmed.
      if (chosen.length !== confirmed.size || chosen.some(({ id, payload }) =>
        payload.checkedAt === null || SHOPPING_FIELDS.some(field => payload[field] !== confirmed.get(id)[field]))) {
        throw new ShoppingSelectionChangedError();
      }
      return chosen;
    });
  }
  function prepareSync(){return mutate(current=>{
    if(!current.auth)return {puts:[],deletes:[],result:null};
    const householdId=current.auth.householdId;
    if(current.state.householdId&&current.state.householdId!==householdId)throw new Error('Ostude majapidamine muutus. Kohalikud andmed on alles.');
    const puts=[],adopted=[];
    for(const row of current.records){
      if(row.householdId!==null&&row.householdId!==householdId)throw new Error('Ostude majapidamine muutus. Kohalikud andmed on alles.');
      if(row.syncStatus==='local'){
        if(!row.deletedAt)adopted.push({...row,householdId,syncStatus:'pending'});
      }else if(row.householdId===null)puts.push({store:'shoppingItems',record:{...row,householdId}});
    }
    for(const row of current.outbox){
      if(row.householdId!==null&&row.householdId!==householdId)throw new Error('Ostude majapidamine muutus. Kohalikud andmed on alles.');
      if(row.householdId===null)puts.push({store:'outbox',record:{...row,householdId}});
    }
    const adoption=queue(current,adopted,adopted.map(row=>({id:row.id,operation:'CREATE',patch:row.payload})));
    puts.push(...adoption.puts);
    if(!current.state.householdId)puts.push({store:'syncState',record:{...current.state,householdId}});
    return {puts,deletes:[],result:current.auth};
  },'sync');}
  function attempt(mutationId){return mutate(current=>{
    const item=current.outbox.find(row=>row.mutationId===mutationId);
    if(!item||current.conflicts.some(row=>row.entityId===item.entityId))return {puts:[],deletes:[],result:null};
    if(!current.auth||item.householdId!==current.auth.householdId)throw new Error('Invalid shopping scope');
    if(current.outbox.some(row=>row.entityId===item.entityId&&row.sequence<item.sequence))return {puts:[],deletes:[],result:null};
    const next={...item,attemptCount:item.attemptCount+1,lastAttemptAt:clock()};
    return {puts:[{store:'outbox',record:next},{store:'syncState',record:{...current.state,lastAttemptAt:clock()}}],deletes:[],result:next};
  },'sync');}
  function acknowledge(mutationId, revision, merge) {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('Invalid shopping acknowledgement');
    return mutate(current => {
      const item = current.outbox.find(row => row.mutationId === mutationId);
      if (!item) return { puts: [], deletes: [], result: null };
      if (revision <= item.baseRevision) throw new TypeError('Shopping revision did not advance');
      const local = current.records.find(row => row.id === item.entityId);
      if (!local) throw new Error('Missing acknowledged shopping item');
      const dependents = current.outbox.filter(row => row.entityId === item.entityId && row.sequence > item.sequence);
      const plan = reconcileMergeAcknowledgement({
        merge, mutation: item, revision, dependents, local, fields: SHOPPING_EDIT_FIELDS,
        group: field => field,
        readRecord: record => validateShoppingRecord({ ...record, householdId: current.auth.householdId, syncStatus: 'synced' }),
        validatePayload: payload => validateShoppingRecord({ ...local, payload }),
      });
      const record = { ...local, payload: plan.payload, revision: plan.revision,
        syncStatus: (plan.blocked || local.syncStatus === 'conflict') ? 'conflict' : dependents.length ? 'pending' : 'synced' };
      const puts = [{ store: 'shoppingItems', record }];
      if (plan.blocked) {
        const conflict = { id: `shopping:${item.entityId}`, entityType: 'shopping_item', entityId: item.entityId,
          ...plan.blocked, localRecord: record, updatedAt: clock() };
        puts.push({ store: 'conflicts', record: conflict });
      }
      if (plan.nextMutation) puts.push({ store: 'outbox', record: plan.nextMutation });
      if (plan.refreshSnapshot) {
        puts.push({ store: 'syncState', record: { ...current.state, bootstrapCompleted: false } });
      }
      return { puts, deletes: [{ store: 'outbox', key: mutationId }], result: null };
    }, 'sync');
  }
  function reject(mutationId,result){return mutate(current=>{
    const item=current.outbox.find(row=>row.mutationId===mutationId);if(!item)return {puts:[],deletes:[],result:null};
    const local=current.records.find(row=>row.id===item.entityId);if(!local)throw new Error('Missing rejected shopping item');
    const conflict={...current.conflicts.find(row=>row.entityId===item.entityId),id:`shopping:${item.entityId}`,entityType:'shopping_item',entityId:item.entityId,
      localRecord:local,mutation:item,result:{status:result.status,code:result.code??null},updatedAt:clock()};
    return {puts:[{store:'shoppingItems',record:{...local,syncStatus:'conflict'}},{store:'conflicts',record:conflict}],deletes:[],result:null};
  },'sync');}
  function applyRemote(records,cursor,bootstrap=false){
    if(!Array.isArray(records)||!Number.isSafeInteger(cursor)||cursor<0)throw new TypeError('Invalid shopping snapshot');
    const byId=new Map();
    for(const row of records){
      if(Object.keys(row).sort().join(',')!=='deletedAt,id,payload,revision,updatedAt'||!Number.isSafeInteger(row.revision)||row.revision<1)throw new TypeError('Invalid remote shopping envelope');
      const remote={...row,syncStatus:'synced',householdId:null};validateShoppingRecord(remote);
      const previous=byId.get(row.id);
      if(previous?.revision===row.revision&&JSON.stringify(previous)!==JSON.stringify(remote))throw new TypeError('Ambiguous shopping revision');
      if(!previous||previous.revision<=row.revision)byId.set(row.id,remote);
    }
    return mutate(current=>{
      if(!current.auth||current.state.householdId!==current.auth.householdId)throw new Error('Shopping auth not prepared');
      if (!bootstrap && (!current.state.bootstrapCompleted || cursor < current.state.serverCursor)) {
        return { puts: [], deletes: [], result: null };
      }
      const puts=[];
      for(const input of byId.values()){
        const remote={...input,householdId:current.auth.householdId};
        const local=current.records.find(row=>row.id===remote.id);
        if(local&&local.revision>remote.revision)continue;
        const pending=current.outbox.some(row=>row.entityId===remote.id);
        if(local&&(pending||local.syncStatus==='conflict')){
          if(local.syncStatus==='conflict'||remote.deletedAt||local.revision===0){
            const previous = current.conflicts.find(row => row.entityId === local.id);
            const remoteRecord = previous?.remoteRecord?.revision > remote.revision ? previous.remoteRecord : remote;
            const conflict={...previous,id:`shopping:${local.id}`,entityType:'shopping_item',entityId:local.id,
              localRecord:local,remoteRecord,updatedAt:clock()};
            puts.push({store:'shoppingItems',record:{...local,syncStatus:'conflict'}},{store:'conflicts',record:conflict});
          }
          continue;
        }
        puts.push({store:'shoppingItems',record:remote});
      }
      puts.push({store:'syncState',record:{...current.state,serverCursor:cursor,bootstrapCompleted:true,lastSuccessfulSyncAt:clock()}});
      return {puts,deletes:[],result:null};
    },'sync');
  }
  return {snapshot,refresh,add,update,check:(id,checked)=>update(id,{checkedAt:checked?clock():null}),
    remove:id=>removeMany(available=>available.filter(row=>row.id===id)),clearChecked,prepareSync,attempt,acknowledge,reject,applyRemote,
    getSnapshot:()=>view,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},
    refreshAvailability:()=>{view={...view,writable:!view.loading&&!view.error&&isWritable()};listeners.forEach(listener=>listener());},
    dispose:()=>{disposed=true;listeners.clear();},
  };
}
