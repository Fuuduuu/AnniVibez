export const SHOPPING_CATEGORIES = Object.freeze({
  food: {label:'Toit',color:'#3A8F2B',tint:'#E7F1E2'},
  home: {label:'Kodu',color:'#3B6FB0',tint:'#E4ECF5'},
  pharmacy: {label:'Apteek',color:'#B44974',tint:'#F5E6EC'},
  other: {label:'Muu',color:'#75658E',tint:'#EDE8F2'},
});
export const SHOPPING_FIELDS = ['id','name','quantity','category','note','checkedAt','createdAt'];
export const SHOPPING_EDIT_FIELDS = ['name','quantity','category','note','checkedAt'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const requireValue=(condition,message)=>{if(!condition)throw new TypeError(message);};
export const isShoppingId=id=>typeof id==='string'&&UUID.test(id);
export const isShoppingTimestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;

export function validateShoppingItem(value) {
  requireValue(plain(value),'Vigane ost.');
  requireValue(Object.keys(value).every(key=>SHOPPING_FIELDS.includes(key)),'Ost sisaldab tundmatuid andmeid.');
  requireValue(isShoppingId(value.id),'Vigane ostu ID.');
  requireValue(typeof value.name==='string'&&value.name.trim().length>0&&value.name.length<=160,'Lisa nimetus (kuni 160 märki).');
  const quantity=value.quantity===undefined?'':value.quantity;
  const category=value.category===undefined?'food':value.category;
  const note=value.note===undefined?'':value.note;
  const checkedAt=value.checkedAt===undefined?null:value.checkedAt;
  requireValue(typeof quantity==='string'&&quantity.length<=40,'Kogus võib olla kuni 40 märki.');
  requireValue(Object.hasOwn(SHOPPING_CATEGORIES,category),'Vali ostu kategooria.');
  requireValue(typeof note==='string'&&note.length<=500,'Märkus võib olla kuni 500 märki.');
  requireValue(checkedAt===null||isShoppingTimestamp(checkedAt),'Vigane ostmise aeg.');
  requireValue(isShoppingTimestamp(value.createdAt),'Vigane loomise aeg.');
  return {id:value.id,name:value.name.trim(),quantity,category,note,checkedAt,createdAt:value.createdAt};
}

export function createShoppingItem(input,{newId,clock}) {
  requireValue(plain(input)&&Object.keys(input).every(key=>['name','quantity','category','note'].includes(key)),'Vigased uue ostu andmed.');
  return validateShoppingItem({...input,id:newId(),createdAt:clock(),checkedAt:null});
}
export function updateShoppingItem(item,patch) {
  requireValue(plain(patch)&&Object.keys(patch).every(key=>SHOPPING_EDIT_FIELDS.includes(key)),'Ostu ID ja loomise aeg ei ole muudetavad.');
  return validateShoppingItem({...validateShoppingItem(item),...patch});
}
const compare=(a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
export function groupShoppingItems(items) {
  const unfinished=items.filter(item=>item.checkedAt===null).sort(compare);
  const checked=items.filter(item=>item.checkedAt!==null).sort((a,b)=>b.checkedAt.localeCompare(a.checkedAt)||compare(a,b));
  return {unfinished,checked,groups:Object.entries(SHOPPING_CATEGORIES).map(([id,category])=>({id,label:category.label,items:unfinished.filter(item=>item.category===id)})).filter(group=>group.items.length)};
}
export function shoppingSummary(items) {
  const {unfinished}=groupShoppingItems(items);
  return {count:unfinished.length,names:unfinished.slice(0,3).map(item=>item.name),extra:Math.max(0,unfinished.length-3)};
}
