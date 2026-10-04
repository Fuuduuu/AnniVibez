import {validateShoppingItemRecord,validateOutboxRecord} from '../storage/localReplica.js';
import {isShoppingId,isShoppingTimestamp,SHOPPING_EDIT_FIELDS,validateShoppingItem} from './model.js';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validateShoppingRecord(record) {
  validateShoppingItemRecord(record);
  const payload=validateShoppingItem(record.payload);
  if(record.id!==payload.id||JSON.stringify(payload)!==JSON.stringify(Object.fromEntries(Object.keys(payload).map(key=>[key,record.payload[key]]))))throw new TypeError('Invalid shopping payload snapshot');
  return record;
}
export const emptyShoppingState=()=>({key:'shopping',householdId:null,serverCursor:0,bootstrapCompleted:false,lastSuccessfulSyncAt:null,lastAttemptAt:null});
export function validateShoppingSyncState(state) {
  if(!plain(state)||state.key!=='shopping'||!Number.isSafeInteger(state.serverCursor)||state.serverCursor<0
    ||typeof state.bootstrapCompleted!=='boolean'||!(state.householdId===null||/^hld_[0-9a-f-]{36}$/.test(state.householdId))
    ||![state.lastSuccessfulSyncAt,state.lastAttemptAt].every(value=>value===null||isShoppingTimestamp(value))
    ||Object.keys(state).some(key=>!Object.keys(emptyShoppingState()).includes(key)))throw new TypeError('Invalid shopping sync state');
  return state;
}
export function validateShoppingOutbox(record) {
  validateOutboxRecord(record);
  if(record.entityType!=='shopping_item'||!isShoppingId(record.entityId)||!isShoppingId(record.mutationId)||!Number.isSafeInteger(record.sequence)||record.sequence<1)throw new TypeError('Invalid shopping outbox identity');
  if(record.householdId!==null&&!/^hld_[0-9a-f-]{36}$/.test(record.householdId))throw new TypeError('Invalid shopping outbox scope');
  if(record.operation==='CREATE'){
    const item=validateShoppingItem(record.patch);if(item.id!==record.entityId)throw new TypeError('Shopping CREATE identity mismatch');
  }else if(record.operation==='DELETE'){
    if(Object.keys(record.patch).length)throw new TypeError('Shopping DELETE patch must be empty');
  }else if(Object.keys(record.patch).some(key=>!SHOPPING_EDIT_FIELDS.includes(key)))throw new TypeError('Unknown shopping update field');
  return record;
}
export function validateShoppingConflict(record) {
  if(!plain(record)||record.entityType!=='shopping_item'||!isShoppingId(record.entityId)||record.id!==`shopping:${record.entityId}`)throw new TypeError('Invalid shopping conflict');
  validateShoppingRecord(record.localRecord);
  if(record.remoteRecord)validateShoppingRecord(record.remoteRecord);
  if(record.mutation)validateShoppingOutbox(record.mutation);
  if(!isShoppingTimestamp(record.updatedAt))throw new TypeError('Invalid shopping conflict timestamp');
  return record;
}
