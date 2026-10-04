import { useCallback, useMemo, useSyncExternalStore } from 'react';

const unavailable = {items:[],conflicts:[],loading:false,writable:false,hasAuth:false,pendingCount:0,
  error:'Ostunimekirja salvestus pole praegu saadaval. Salvestatud andmeid ei kirjutata üle.'};
const local = {status:'local',active:false,error:null};
const subscribeNone = () => () => {};
const unavailableSnapshot = () => unavailable;
const localSnapshot = () => local;

export function useShopping(session) {
  const store=session.shopping,engine=session.shoppingSync;
  const view=useSyncExternalStore(store?.subscribe??subscribeNone,store?.getSnapshot??unavailableSnapshot);
  const syncView=useSyncExternalStore(engine?.subscribe??subscribeNone,engine?.getSnapshot??localSnapshot);
  const refresh=useCallback(async()=>{await store?.refresh();await engine?.run();},[store,engine]);
  const actions=useMemo(()=>Object.fromEntries(['add','update','check','remove','clearChecked'].map(method=>[
    method,(...args)=>store?store[method](...args):Promise.reject(new Error(unavailable.error))
  ])),[store]);
  return useMemo(()=>({...view,...actions,refresh,sync:{...syncView,active:view.hasAuth&&!!engine,
    pendingCount:view.pendingCount,conflictCount:view.conflicts.length}}),[view,syncView,actions,refresh,engine]);
}
