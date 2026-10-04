import assert from 'node:assert/strict';
import {test} from 'node:test';
const model=await import('../../src/shopping/model.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
const id='a0000000-0000-4000-8000-000000000001';
const stamp='2026-10-04T08:00:00.000Z';
const item=(patch={})=>({id,name:'Piim',quantity:'2 tk',category:'food',note:'Laktoosivaba',checkedAt:null,createdAt:stamp,...patch});

test('shopping validates and normalizes its own payload, independent of calendar',()=>{
  assert.equal(typeof model.validateShoppingItem,'function','Shopping validation is not implemented');
  assert.deepEqual(model.validateShoppingItem({id,name:'  Piim  ',createdAt:stamp}),item({quantity:'',note:''}));
});
for(const [label,patch] of [
  ['blank name',{name:'  '}],['name >160',{name:'x'.repeat(161)}],['non-string name',{name:1}],
  ['quantity >40',{quantity:'x'.repeat(41)}],['non-string quantity',{quantity:1}],
  ['note >500',{note:'x'.repeat(501)}],['non-string note',{note:[]}],['unknown category',{category:'calendar_event'}],
  ['noncanonical id',{id:'local-1'}],['invalid creation',{createdAt:'2026-02-30T08:00:00.000Z'}],
  ['invalid completion',{checkedAt:'2026-02-30T08:00:00.000Z'}],['household injection',{householdId:'other'}],
  ['credential injection',{deviceToken:'secret'}],
])test(`validation refuses ${label}`,()=>{
  assert.equal(typeof model.validateShoppingItem,'function');
  assert.throws(()=>model.validateShoppingItem(item(patch)),TypeError);
});

test('maximum valid multibyte fields fit and names trim without erasing notes',()=>{
  const result=model.validateShoppingItem(item({name:' õ'.repeat(80),quantity:'😀'.repeat(20),note:'😀'.repeat(250)}));
  assert.equal(result.name.length,159);assert.equal(result.quantity.length,40);assert.equal(result.note.length,500);
});
test('create generates immutable identity and timestamps with a food default',()=>{
  assert.deepEqual(model.createShoppingItem({name:'  Leib  '},{newId:()=>id,clock:()=>stamp}),item({name:'Leib',quantity:'',note:''}));
});
test('edit preserves identity/creation and refuses immutable or unknown fields',()=>{
  assert.deepEqual(model.updateShoppingItem(item(),{quantity:'1 l',note:'Jahutatud'}),item({quantity:'1 l',note:'Jahutatud'}));
  for(const patch of [{id},{createdAt:stamp},{householdId:'h'},{revision:3}])assert.throws(()=>model.updateShoppingItem(item(),patch));
});
test('check and uncheck are regular timestamp field updates',()=>{
  const checked=model.updateShoppingItem(item(),{checkedAt:'2026-10-04T09:00:00.000Z'});
  assert.equal(checked.checkedAt,'2026-10-04T09:00:00.000Z');
  assert.deepEqual(model.updateShoppingItem(checked,{checkedAt:null}),item());
});
test('group only nonempty unfinished categories in product order; checked are separate',()=>{
  const rows=[item({id:'a0000000-0000-4000-8000-000000000004',category:'other'}),
    item({id:'a0000000-0000-4000-8000-000000000002',category:'home'}),item(),
    item({id:'a0000000-0000-4000-8000-000000000003',category:'pharmacy',checkedAt:stamp})];
  const grouped=model.groupShoppingItems(rows);
  assert.deepEqual(grouped.groups.map(group=>[group.id,group.label,group.items.length]),[['food','Toit',1],['home','Kodu',1],['other','Muu',1]]);
  assert.equal(grouped.unfinished.length,3);assert.equal(grouped.checked.length,1);
});
test('ordering is deterministic by creation timestamp then id without mutating input',()=>{
  const a=item(),b=item({id:'a0000000-0000-4000-8000-000000000002'}),older=item({id:'a0000000-0000-4000-8000-000000000003',createdAt:'2026-10-03T08:00:00.000Z'});
  const rows=[b,a,older];
  assert.deepEqual(model.groupShoppingItems(rows).unfinished.map(row=>row.id),[older.id,a.id,b.id]);
  assert.equal(rows[0],b);
});
test('home count and three-name preview exclude checked items and keep distinct same-name ids',()=>{
  const rows=Array.from({length:8},(_,index)=>item({id:`a0000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,name:['Piim','Leib','Pesugeel'][index%3]}));
  rows.push(item({id:'a0000000-0000-4000-8000-000000000009',checkedAt:stamp,name:'Ostetud'}));
  assert.deepEqual(model.shoppingSummary(rows),{count:8,names:['Piim','Leib','Pesugeel'],extra:5});
  assert.deepEqual(model.shoppingSummary([rows.at(-1)]),{count:0,names:[],extra:0});
});
