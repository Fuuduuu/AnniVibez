import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {waitForBrowserEndpoint} from '../bus/browser-lifecycle.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const browser=[process.env.STORAGE_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function migrationStatements(sql){
  const statements=[];let start=0,quote=null;
  for(let index=0;index<sql.length;index++){
    const char=sql[index];if(quote){if(char===quote&&sql[index-1]!=='\\')quote=null;continue;}
    if(char==="'"||char==='"'){quote=char;continue;}if(char!==';')continue;
    const statement=sql.slice(start,index+1);
    if(/^\s*CREATE\s+TRIGGER\b/i.test(statement)&&!/\bEND\s*;\s*$/i.test(statement))continue;
    if(statement.trim())statements.push(statement.replace(/\s+/g,' ').trim());start=index+1;
  }
  assert.equal(sql.slice(start).trim(),'');return statements;
}
const fixture=`
import {createStorageAuthorityController} from './src/storage/storageAuthority.js';
import {runLegacyMigration} from './src/storage/legacyMigration.js';
import {createShoppingStore} from './src/shopping/shoppingStore.js';
import {createShoppingSync} from './src/shopping/sync.js';
import {createCalendarSyncStore} from './src/sync/calendarSyncStore.js';
import {createCalendarSync} from './src/sync/calendarSync.js';
import {createReplicaRepositories} from './src/storage/replicaRepositories.js';
const clock=()=> '2026-10-04T08:00:00.000Z';
const newId=()=>crypto.randomUUID();
const makeController=(mode='forward')=>createStorageAuthorityController({indexedDb:indexedDB,storage:localStorage,cryptoApi:crypto,newId,clock,mode});
const controller=makeController(new URL(location.href).searchParams.get('storageMode')??'forward');
const boot=await controller.boot();if(!['READY','LEGACY'].includes(boot.state))throw Error('Shopping fixture not usable: '+boot.state);
const authority=controller.getReadyAuthorityIdentity();
const replica=controller.replica;
const controls=window.controls={offline:false,loseReply:false,holdPush:false,calls:[],pushes:[],pushCapabilities:[],pushResponses:[],ids:[],abortNextCommit:false};
const transact=replica.transact.bind(replica);
replica.transact=(names,mode,body)=>transact(names,mode,async context=>{
  const result=await body(context);
  if(mode==='readwrite'&&names.includes('shoppingItems')&&controls.abortNextCommit){controls.abortNextCommit=false;context.transaction.abort();}
  return result;
});
const shoppingFor=owner=>createShoppingStore({replica:owner.replica,authority:owner.getReadyAuthorityIdentity(),
  newId:()=>{const id=newId();controls.ids.push(id);return id;},clock,
  isWritable:()=>['READY','LEGACY'].includes(owner.getState())});
const store=shoppingFor(controller);
await store.refresh();
const nativeFetch=window.fetch.bind(window);
const fetchImpl=async(path,options={})=>{
  if(!['/api/shopping/','/api/sync/'].some(prefix=>String(path).startsWith(prefix)))throw Error('Unexpected sync route');
  controls.calls.push(path);
  const pushing=path==='/api/shopping/push'||path==='/api/sync/push';
  if(pushing){
    controls.pushes.push(JSON.parse(options.body));
    controls.pushCapabilities.push(new Headers(options.headers).get('X-Annivibe-Sync-Capabilities'));
  }
  if(controls.offline)throw new TypeError('Offline test');
  if(pushing && controls.upgradeRequired) return new Response(JSON.stringify({error:{code:'CLIENT_UPGRADE_REQUIRED'}}),{status:409});
  if(pushing&&(controls.holdPush||controls.holdPushNumber===controls.pushes.length)){
    controls.holdPush=false;controls.pushHeld=true;
    await new Promise(resolve=>controls.releasePush=resolve);
  }
  const response=await nativeFetch(path,options);
  if(pushing)controls.pushResponses.push({status:response.status,body:await response.clone().json().catch(()=>null)});
  if(controls.loseReply&&pushing){controls.loseReply=false;throw new TypeError('Lost acknowledgement');}
  return response;
};
const sync=createShoppingSync({store,fetchImpl,isReady:()=>controller.getState()==='READY'});
const calendar=createCalendarSyncStore({replica,authority,newId,clock});
const calendarSync=createCalendarSync({replica,authority,newId,clock,fetchImpl,isReady:()=>controller.getState()==='READY'});
const calendarRepository=createReplicaRepositories({replica,authority,newId,clock}).calendar;
window.client={store,sync,calendar,calendarSync,calendarRepository,replica,controller,makeController,shoppingFor,
  migrate:()=>runLegacyMigration({replica,storage:localStorage,cryptoApi:crypto,newId,newPreparationId:newId,now:clock}),
  snapshot:()=>store.snapshot(),
  install:async auth=>{await replica.putAuth(auth);await store.refresh();},
  row:async(name)=> (await store.snapshot()).records.find(row=>row.payload.name===name),
  all:async(name)=>replica.transact(name,'readonly',({stores})=>new Promise((resolve,reject)=>{const request=stores[name].getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})),
};
window.clientReady=true;
`;

export async function shoppingHarness({sharedBackend=null,backend=false,storageMode='forward',clientRoot=root,backendRoot=root}={}){
  assert.ok(browser,'Chromium required; shopping safety must not skip');
  const bundle=await build({absWorkingDir:clientRoot,bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',
    stdin:{contents:fixture,resolveDir:clientRoot}});
  const fixturePath=resolve(clientRoot)===resolve(root)?'/fixture.js':'/fixture-baseline.js';
  const fixtures=sharedBackend?.fixtures??new Map();
  fixtures.set(fixturePath,bundle.outputFiles[0].text);
  let miniflare=null,db=sharedBackend?.db,routes=new Map();
  async function loadRoutes(directory) {
    const entries = await Promise.all([
      ['/api/auth/create-household','onRequestPost'],
      ['/api/auth/device-link','onRequestPost'],
      ['/api/auth/claim-device','onRequestPost'],
      ['/api/shopping/bootstrap','onRequestGet'],
      ['/api/shopping/pull','onRequestGet'],
      ['/api/shopping/push','onRequestPost'],
      ['/api/sync/bootstrap','onRequestGet'],
      ['/api/sync/pull','onRequestGet'],
      ['/api/sync/push','onRequestPost'],
    ].map(async ([path, method]) => [path, (await import(pathToFileURL(join(directory, 'functions', `${path}.js`)).href))[method]]));
    routes = new Map(entries);
  }
  if(backend&&!sharedBackend){
    miniflare=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",d1Databases:['DB']});
    db=await miniflare.getD1Database('DB');
    for(const name of ['0001_majandus_backend.sql','0002_shopping_items.sql'])for(const sql of migrationStatements(readFileSync(resolve(root,'migrations',name),'utf8')))await db.exec(sql);
    await loadRoutes(backendRoot);
  }
  const server=sharedBackend?.server??createServer(async(req,res)=>{
    try{
      const requestUrl=new URL(req.url,'http://127.0.0.1');
      const path=requestUrl.pathname;
      if(fixtures.has(path)){res.setHeader('Content-Type','text/javascript');res.end(fixtures.get(path));return;}
      if(routes.has(path)){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const response=await routes.get(path)({env:{DB:db},request:new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})})});
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(path.startsWith('/api/')){res.writeHead(404);res.end();return;}
      const asset=requestUrl.searchParams.has('baseline')?'/fixture-baseline.js':'/fixture.js';
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><script type="module" src="${asset}"></script>`);
    }catch(error){res.writeHead(500);res.end('Local bridge error: '+error.message);}
  });
  if(!sharedBackend)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile=mkdtempSync(join(tmpdir(),'annivibe-shopping-client-'));
  const child=spawn(browser,['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
  const port=new URL(await waitForBrowserEndpoint(child)).port;
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  async function connect(target){
  const socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const pending=new Map();let next=0;
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data),entry=pending.get(message.id);if(!entry)return;
    pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(Error(JSON.stringify(message.error))):entry.resolve(message.result);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},20000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;
  };
  const waitFor=async expression=>{
    const until=Date.now()+15000;do{if(await evaluate(expression))return;await pause(30);}while(Date.now()<until);
    assert.fail('Timed out: '+expression);
  };
  await send('Page.enable');await send('Runtime.enable');
  return {socket,send,evaluate,waitFor};
  }
  const {socket,send,evaluate,waitFor}=await connect(targets.find(target=>target.type==='page'));
  const query = new URLSearchParams();
  if (storageMode !== 'forward') query.set('storageMode', storageMode);
  if (fixturePath === '/fixture-baseline.js') query.set('baseline', '1');
  const url = 'http://127.0.0.1:' + server.address().port + (query.size ? '/?' + query : '');
  await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url});await waitFor('window.clientReady===true');
  return {db,server,url,fixturePath,fixtures,evaluate,waitFor,send,loadRoutes,
    loadClient:async baseline=>{
      const target=new URL(url);
      if(baseline)target.searchParams.set('baseline','1');else target.searchParams.delete('baseline');
      await evaluate('window.clientReady=false');
      await send('Page.navigate',{url:target.href});
      await waitFor('window.clientReady===true');
    },
    newTab:async()=>{
      const {targetId}=await send('Target.createTarget',{url:'about:blank'});
      const list=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
      const tab=await connect(list.find(target=>target.id===targetId));
      await tab.send('Page.navigate',{url});await tab.waitFor('window.clientReady===true');
      return {...tab,close:async()=>{await send('Target.closeTarget',{targetId});tab.socket.close();}};
    },
    reload:async()=>{await evaluate('window.clientReady=false');await send('Page.reload');await waitFor('window.clientReady===true');},
    close:async()=>{
      await send('Browser.close').catch(()=>child.kill());socket.close();
      for(let index=0;child.exitCode===null&&index<50;index++)await pause(20);if(child.exitCode===null)child.kill();
      if(!sharedBackend){await new Promise(resolve=>server.close(resolve));await miniflare?.dispose();}
      assert.equal(dirname(resolve(profile)),resolve(tmpdir()));rmSync(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});
    },
  };
}
