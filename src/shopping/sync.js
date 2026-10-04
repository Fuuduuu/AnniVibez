export function createShoppingSync({store,fetchImpl,isReady=()=>true}) {
  const listeners=new Set();let disposed=false,running,rerun=false;
  let view={status:'local',active:false,error:null};
  const publish=patch=>{if(disposed)return;view={...view,...patch};listeners.forEach(listener=>listener());};
  async function api(path,auth,body){
    if(disposed||!isReady())throw new Error('Shopping storage is unavailable');
    let response;
    try{response=await fetchImpl(path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${auth.deviceToken}`,...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',redirect:'error'});}
    catch{const error=new Error('Shopping network unavailable');error.network=true;throw error;}
    if(!response.ok){const error=new Error('Shopping request failed');error.status=response.status;try{error.code=(await response.json())?.error?.code}catch{}throw error;}
    return response.json();
  }
  async function bootstrap(auth){const response=await api('/api/shopping/bootstrap',auth);await store.applyRemote(response.shoppingItems,response.cursor,true);}
  async function once(){
    if(disposed||!isReady()){publish({status:'local',active:false});return;}
    if(!(await store.snapshot()).auth){publish({status:'local',active:false,error:null});return;}
    const auth=await store.prepareSync();if(!auth){publish({status:'local',active:false,error:null});return;}
    publish({status:'syncing',active:true,error:null});
    try{
      if(!(await store.snapshot()).state.bootstrapCompleted)await bootstrap(auth);
      while(!disposed&&isReady()){
        const current=await store.snapshot();const blocked=new Set(current.conflicts.map(row=>row.entityId));
        const queued=current.outbox.find(row=>!blocked.has(row.entityId));if(!queued)break;
        const item=await store.attempt(queued.mutationId);if(!item)continue;
        const response=await api('/api/shopping/push',auth,{mutations:[{mutationId:item.mutationId,entityType:'shopping_item',entityId:item.entityId,operation:item.operation,baseRevision:item.baseRevision,patch:item.patch}]});
        if(!Array.isArray(response.results)||response.results.length!==1||response.results[0].mutationId!==item.mutationId)throw new TypeError('Invalid shopping acknowledgement');
        const result=response.results[0].status==='REPLAYED'?response.results[0].result:response.results[0];
        if(['APPLIED','MERGED'].includes(result?.status))await store.acknowledge(item.mutationId,result.revision);
        else if(['CONFLICT','REJECTED'].includes(result?.status))await store.reject(item.mutationId,result);
        else throw new TypeError('Invalid shopping mutation result');
      }
      const current=await store.snapshot();
      try{
        const response=await api(`/api/shopping/pull?after=${current.state.serverCursor}`,auth);
        if(!Array.isArray(response.changes)||response.changes.some(row=>row.entityType!=='shopping_item'))throw new TypeError('Invalid shopping delta');
        await store.applyRemote(response.changes.map(row=>row.record),response.cursor);
      }catch(error){if(error.status!==409||error.code!=='RESYNC_REQUIRED')throw error;await bootstrap(auth);}
      const conflicts=(await store.snapshot()).conflicts.length;
      publish({status:conflicts?'attention':'synced',error:conflicts?'Ostu muudatus vajab tähelepanu. Sinu kohalik muudatus on alles.':null});
    }catch(error){publish({status:error.network||error.status>=500?'waiting':'attention',error:error.network||error.status>=500
      ?'Ostud ootavad võrguühendust. Kohalikud muudatused on alles.':'Ostude sünkroonimine vajab tähelepanu. Kohalikud muudatused on alles.'});}
  }
  function run(){
    if(disposed)return Promise.resolve();
    if(running){rerun=true;return running;}
    running=(async()=>{do{rerun=false;await once();}while(rerun&&!disposed&&isReady());})()
      .catch(()=>publish({status:'attention',error:'Ostude sünkroonimine vajab tähelepanu. Kohalikud muudatused on alles.'}))
      .finally(()=>{running=undefined;});return running;
  }
  return {run,getSnapshot:()=>view,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},dispose:()=>{disposed=true;listeners.clear();}};
}
