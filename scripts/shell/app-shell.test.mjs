import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { waitForBrowserEndpoint } from '../bus/browser-lifecycle.mjs';
import { runCalendarChecks } from '../calendar/browser-cases.mjs';
import { runWasteChecks } from '../waste/browser-cases.mjs';
import { runReminderChecks } from '../reminders/browser-cases.mjs';
import { runVisualChecks } from './visual-cases.mjs';
import { createEvent } from '../../src/calendar/eventModel.js';
import { createEventRepository } from '../../src/calendar/eventRepository.js';
import { normalizeWasteResult } from '../../src/waste/providers.js';
import { WASTE_SUBTYPES } from '../../src/calendar/eventModel.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const browser = [process.env.BUS_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(path => path && existsSync(path));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// The real runtime wiring in src/main.jsx is bundled and exercised in both storage modes.
//   LEGACY: a real C4 controller whose migration is refused (an invalid saved-places source) so it settles in LEGACY.
//   READY:  a real C4 controller on an empty profile: real migration, real authority switch, real C5 repositories.
// SHELL_RUNTIME_MODE=LEGACY|READY selects one mode; unset runs both.
const MODES = process.env.SHELL_RUNTIME_MODE ? [process.env.SHELL_RUNTIME_MODE] : ['LEGACY', 'READY'];
// The cutover acceptance checks run with the plain shell suite; the feature wrappers (calendar, waste, reminder, ...) skip them.
const OTHER_SUITE_FLAGS = ['CALENDAR_TESTS', 'WASTE_TESTS', 'REMINDER_TESTS', 'NATIVE_NOTIFICATION_TEST', 'VISUAL_TESTS'];
const SHARED_KEYS = ['majamajandus_household_events_v1', 'majamajandus_household_profile_v1', 'sade_saved_places'];
const HINT_KEY = 'majandus_storage_authority_v1';
const STAMP = '2026-09-14T06:00:00.000Z';

for (const mode of MODES) test(`Majamajandus shell in Chromium (${mode} runtime)`, { timeout: 240000 }, async t => {
  assert.ok(browser, 'Chromium is required; shell checks must not silently skip');
  const shim = `
    import RealApp, {createStorageRuntime as createRealStorageRuntime} from './src/App.jsx';
    ${process.env.WASTE_TESTS === '1' ? `import {createWasteLookup} from './src/waste/providers.js';
    const wasteLookup=createWasteLookup([{id:'fixture',name:'Controlled test source',supports:address=>address.startsWith('Fixture'),lookup:async()=>{
      if(window.wasteFail) throw Error('controlled failure');
      if(window.wasteDelay) return new Promise(resolve=>{window.resolveWaste=resolve;});
      return window.wasteReply || {entries:[{externalId:'one',title:'Allika bio',subtype:'bio',date:'2026-09-15'}]};
    }}]);` : 'const wasteLookup=undefined;'}
    ${process.env.REMINDER_TESTS === '1' ? `import {createNotificationService} from './src/reminders/capability.js';
    const notificationService=createNotificationService({isSecureContext:true,document,
      get Notification(){return !sessionStorage.getItem('notificationMode') ? undefined : {
        get permission(){return sessionStorage.getItem('notificationMode');},
        async requestPermission(){sessionStorage.setItem('permissionCalls',String(Number(sessionStorage.getItem('permissionCalls')||0)+1));
          const answer=sessionStorage.getItem('permissionAnswer')||'granted';sessionStorage.setItem('notificationMode',answer);return answer;}
      };},navigator:{locks:navigator.locks,serviceWorker:{getRegistration:async()=>({active:{},showNotification:async()=>{
        sessionStorage.setItem('notificationCalls',String(Number(sessionStorage.getItem('notificationCalls')||0)+1));
      }})}}
    });` : 'const notificationService=undefined;'}
    export function createStorageRuntime(options) {
      window.__runtime = createRealStorageRuntime(options);
      return window.__runtime;
    }
    export default function App(props) { return <RealApp {...props} wasteLookup={wasteLookup} notificationService={notificationService} />; }
  `;
  // src/main.jsx is the entry point under test; only its './App' import is redirected to add the test fixtures above.
  const shimPlugin = { name: 'app-shim', setup(b) {
    b.onResolve({ filter: /^\.\/App$/ }, args => (args.importer.split(String.fromCharCode(92)).join('/').endsWith('src/main.jsx') ? { path: 'app-shim', namespace: 'app-shim' } : undefined));
    b.onLoad({ filter: /.*/, namespace: 'app-shim' }, () => ({ contents: shim, loader: 'jsx', resolveDir: root }));
  } };
  const bundle = await build({
    absWorkingDir: root, bundle: true, write: false, outfile: 'shell.js', metafile: true,
    jsx: 'automatic', loader: { '.png': 'dataurl' },
    define: { 'import.meta.env': '{}' },
    entryPoints: ['src/main.jsx'], plugins: [shimPlugin],
  });
  assert.ok(Object.keys(bundle.metafile.inputs).every(path => !path.startsWith('docs/')),
    'Design reference and its bundled runtime must never enter the production app');
  const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(f => f.path.endsWith('.css'))?.text || '';
  const server = createServer((req, res) => {
    if (process.env.NATIVE_NOTIFICATION_TEST === '1' && req.url === '/notification-test-sw.js') {
      res.setHeader('Content-Type','text/javascript');
      res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));");return;
    }
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script>
      const NativeDate = Date;
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [2026,8,14,6,0,0])); }
        static now() { return new Date().getTime(); }
      };
      Object.defineProperty(navigator, 'geolocation', {value: {
        getCurrentPosition(success, error) { window.gpsSuccess = success; window.gpsDenied = error; }
      }});
      if (!sessionStorage.seeded) {
        localStorage.setItem('sade_diary_pin', btoa('1234'));
        localStorage.setItem('sade_diary_entries', JSON.stringify([
          {id:'preserved',date:'2026-09-14',title:'Säiliv päevik',emoji:'',free:'Minu kirje'}
        ]));
        localStorage.setItem('annivibe_saved_ideas', JSON.stringify([{idea_title:'Säiliv idee'}]));
        // LEGACY runtime: an invalid saved-places source makes the real migration refuse, so the real controller settles in LEGACY.
        if (${JSON.stringify(mode)} === 'LEGACY') localStorage.setItem('sade_saved_places', 'not json');
        sessionStorage.seeded = 'yes';
      }
      // ---- test-only fault injection and observation (flag-gated through sessionStorage; no production seam) ----
      (() => {
        const nativeSet = Storage.prototype.setItem, nativeGet = Storage.prototype.getItem;
        window.__sharedReads = []; window.__idbOpens = 0;
        if (nativeGet.call(sessionStorage, 'c6HoldLock') === '1' && navigator.locks) {
          navigator.locks.request('majandus:storage-authority', () => new Promise(resolve => { window.__releaseLock = resolve; }));
        }
        Storage.prototype.setItem = function(key, value) {
          if (key === '${HINT_KEY}' && nativeGet.call(sessionStorage, 'c6HintFail') === '1') throw new Error('hint blocked');
          return nativeSet.call(this, key, value);
        };
        Storage.prototype.getItem = function(key) {
          if (${JSON.stringify(SHARED_KEYS)}.includes(key)) window.__sharedReads.push(key);
          if (key === '${HINT_KEY}' && this === localStorage && nativeGet.call(sessionStorage, 'c6HintUnreadable') === '1') throw new Error('hint unreadable');
          return nativeGet.call(this, key);
        };
        if (nativeGet.call(sessionStorage, 'c6NoBroadcast') === '1') window.BroadcastChannel = undefined;
        // A blocked open (another connection refusing to close), simulated per call while the flag is set.
        const nativeOpenDb = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function(...args) {
          window.__idbOpens += 1;
          if (nativeGet.call(sessionStorage, 'c6Blocked') !== '1') return nativeOpenDb.apply(this, args);
          const request = {};
          setTimeout(() => request.onblocked && request.onblocked(new Event('blocked')), 0);
          return request;
        };
        window.__rwActive = 0; window.__rwStarted = 0; window.__rwDone = 0; window.__bcLog = [];
        const nativeTransaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function(...args) {
          const tx = nativeTransaction.apply(this, args);
          if (args[1] === 'readwrite') {
            window.__rwActive += 1; window.__rwStarted += 1;
            const done = () => { window.__rwActive -= 1; window.__rwDone += 1; };
            tx.addEventListener('complete', done); tx.addEventListener('abort', done);
          }
          return tx;
        };
        if (window.BroadcastChannel) {
          const nativePost = BroadcastChannel.prototype.postMessage;
          BroadcastChannel.prototype.postMessage = function(message) {
            window.__bcLog.push({message, rwActive: window.__rwActive, rwStarted: window.__rwStarted, rwDone: window.__rwDone});
            return nativePost.call(this, message);
          };
        }
        // Raw IndexedDB access for seeding and reading the authoritative READY state.
        const open = () => new Promise((resolve, reject) => {
          const request = indexedDB.open('majandus_local_v1');
          request.onupgradeneeded = () => request.transaction.abort();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const run = async (store, mode, work) => {
          const db = await open();
          try {
            return await new Promise((resolve, reject) => {
              const tx = db.transaction(store, mode);
              const request = work(tx.objectStore(store));
              tx.oncomplete = () => resolve(request && 'result' in request ? request.result : undefined);
              tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
            });
          } finally { db.close(); }
        };
        window.__idb = {
          getAll: store => run(store, 'readonly', s => s.getAll()),
          get: (store, key) => run(store, 'readonly', s => s.get(key)),
          put: (store, record) => run(store, 'readwrite', s => s.put(record)),
          delete: (store, key) => run(store, 'readwrite', s => s.delete(key)),
          clear: store => run(store, 'readwrite', s => s.clear()),
        };
      })();
    </script><script src="/app.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = mkdtempSync(join(tmpdir(), 'majamajandus-shell-'));
  const child = spawn(browser, ['--headless=new', '--no-first-run', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let socket;
  const errors = [];
  let send;
  try {
    const port = new URL(await waitForBrowserEndpoint(child)).port;
    const cdpPort = port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, {once:true});
      socket.addEventListener('error', reject, {once:true});
    });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails);
      if (msg.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(msg.params.type)) {
        errors.push(msg.params.args.map(arg => arg.value ?? arg.description).join(' '));
      }
      const request = pending.get(msg.id);
      if (!request) return;
      pending.delete(msg.id);
      clearTimeout(request.timer);
      if (msg.error) request.reject(new Error(JSON.stringify(msg.error)));
      else request.resolve(msg.result);
    });
    send = (method, params = {}) => new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(new Error(method + ' timed out')); }, 15000);
      pending.set(key, {resolve, reject, timer});
      socket.send(JSON.stringify({id:key, method, params}));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(expression)) return;
        await pause(30);
      }
      assert.fail('Condition not met: ' + expression);
    };
    const click = async (text, within = 'document') => {
      await evaluate(`[...${within}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} || b.getAttribute('aria-label') === ${JSON.stringify(text)}).click()`);
      await pause(80);
    };
    const nav = text => click(text, "document.querySelector('nav')");
    const input = async (selector, value) => {
      await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
        el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await pause(60);
    };
    const body = () => evaluate('document.body.innerText');
    const storage = () => evaluate('JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])))');
    // ---- mode-aware TEST-ONLY state helpers: they observe the ACTIVE authority, never a frozen legacy copy ----
    const asRecord = (id, payload) => ({ id, payload, revision: 0, updatedAt: STAMP, deletedAt: null, syncStatus: 'local' });
    const readCalendarEvents = () => evaluate(mode === 'READY'
      ? "__idb.getAll('calendarEvents').then(records=>records.map(record=>record.payload))"
      : "JSON.parse(localStorage.getItem('majamajandus_household_events_v1'))?.events || []");
    const readHouseholdProfile = () => evaluate(mode === 'READY'
      ? "__idb.get('householdProfile','household').then(record=>record ? (({serverHouseholdId,...profile})=>profile)(record.payload) : null)"
      : "JSON.parse(localStorage.getItem('majamajandus_household_profile_v1'))?.profile ?? null");
    const readSavedPlaces = () => evaluate(mode === 'READY'
      ? "__idb.getAll('sharedPlaces').then(records=>records.sort((a,b)=>a.order-b.order).map(record=>record.payload))"
      : "JSON.parse(localStorage.getItem('sade_saved_places'))");
    // Comparable raw snapshots (a string), used to prove that an unreadable or failed domain was never overwritten.
    const calendarRaw = () => evaluate(mode === 'READY'
      ? "__idb.getAll('calendarEvents').then(records=>JSON.stringify(records))"
      : "localStorage.getItem('majamajandus_household_events_v1')");
    const householdRaw = () => evaluate(mode === 'READY'
      ? "__idb.getAll('householdProfile').then(records=>JSON.stringify(records))"
      : "localStorage.getItem('majamajandus_household_profile_v1')");
    const placesRaw = () => evaluate(mode === 'READY'
      ? "__idb.getAll('sharedPlaces').then(records=>JSON.stringify(records))"
      : "localStorage.getItem('sade_saved_places')");
    const snapshotCalendar = () => evaluate(mode === 'READY'
      ? "__idb.getAll('calendarEvents')" : "localStorage.getItem('majamajandus_household_events_v1')");
    const restoreCalendar = snapshot => evaluate(mode === 'READY'
      ? `__idb.clear('calendarEvents').then(()=>Promise.all(${JSON.stringify(snapshot)}.map(record=>__idb.put('calendarEvents',record)))).then(()=>true)`
      : (snapshot === null ? "localStorage.removeItem('majamajandus_household_events_v1')"
        : `localStorage.setItem('majamajandus_household_events_v1',${JSON.stringify(snapshot)})`));
    const seedCalendar = events => evaluate(mode === 'READY'
      ? `__idb.clear('calendarEvents').then(()=>Promise.all(${JSON.stringify(events.map(event => asRecord(event.id, event)))}.map(record=>__idb.put('calendarEvents',record)))).then(()=>true)`
      : `localStorage.setItem('majamajandus_household_events_v1',${JSON.stringify(JSON.stringify({ version: 1, events }))})`);
    const corruptCalendar = () => evaluate(mode === 'READY'
      ? `__idb.put('calendarEvents',${JSON.stringify(asRecord('broken-record', { id: 'other-id', title: 'X' }))})`
      : "localStorage.setItem('majamajandus_household_events_v1','{broken')");
    const repairCalendar = () => evaluate(mode === 'READY'
      ? "__idb.delete('calendarEvents','broken-record')" : "localStorage.removeItem('majamajandus_household_events_v1')");
    const corruptHousehold = () => evaluate(mode === 'READY'
      ? `__idb.put('householdProfile',{key:'household',payload:{name:'Katki'},revision:0,updatedAt:${JSON.stringify(STAMP)},deletedAt:null,syncStatus:'local'})`
      : "localStorage.setItem('majamajandus_household_profile_v1','{broken')");
    const repairHousehold = () => evaluate(mode === 'READY'
      ? "__idb.delete('householdProfile','household')" : "localStorage.removeItem('majamajandus_household_profile_v1')");
    // Write failures use the mode's own real write path: Storage.setItem (LEGACY) or IDBObjectStore.put (READY).
    const failWrites = async domain => {
      const stores = { calendar: ['calendarEvents', 'wasteState'], household: ['householdProfile'], places: ['sharedPlaces'] }[domain];
      const keys = { calendar: 'majamajandus_household_events_v1', household: 'majamajandus_household_profile_v1', places: 'sade_saved_places' }[domain];
      await evaluate(mode === 'READY'
        ? `(()=>{window.__nativePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){
            if(${JSON.stringify(stores)}.includes(this.name)) throw new DOMException('quota','QuotaExceededError');
            return window.__nativePut.apply(this,args);};})()`
        : `(()=>{window.__nativeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){
            if(key===${JSON.stringify(keys)}) throw new DOMException('quota','QuotaExceededError');
            return window.__nativeSet.call(this,key,value);};})()`);
    };
    const restoreWrites = () => evaluate(mode === 'READY' ? 'IDBObjectStore.prototype.put=window.__nativePut;true' : 'Storage.prototype.setItem=window.__nativeSet;true');
    const ready = () => waitFor("!!document.querySelector('nav')");
    const shared = { mode, readCalendarEvents, readHouseholdProfile, readSavedPlaces, calendarRaw, householdRaw, placesRaw,
      corruptCalendar, repairCalendar, corruptHousehold, repairHousehold, failWrites, restoreWrites };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setBlockedURLs', {urls:['*://*.tile.openstreetmap.org/*','*://fonts.googleapis.com/*']});
    await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await send('Page.navigate', {url:`http://127.0.0.1:${server.address().port}`});
    await waitFor("!!document.querySelector('nav')");
    const initialStorage = await storage();

    await t.test(`the mounted runtime is the ${mode} authority and no shared legacy key was written`, async () => {
      const authority = await evaluate("__idb.get('meta','storageAuthorityV1')");
      const hint = await evaluate(`localStorage.getItem('${HINT_KEY}')`);
      if (mode === 'READY') {
        assert.equal(authority.status, 'active');
        assert.equal(JSON.parse(hint).switchId, authority.switchId, 'READY requires the verified hint');
      } else {
        assert.equal(authority, undefined, 'LEGACY: authority is proven absent');
        assert.equal(hint, null);
      }
      for (const key of SHARED_KEYS.slice(0, 2)) assert.equal(await evaluate(`localStorage.getItem('${key}')`), null, key);
      assert.equal(await evaluate("!!document.querySelector('[data-storage-state]')"), false, 'no storage status screen or banner in the normal state');
    });

    await t.test('five primary destinations, identity and truthful Home hierarchy', async () => {
      assert.deepEqual(await evaluate("[...document.querySelectorAll('nav button')].map(b=>b.textContent.trim())"),
        ['Kodu','Kalender','Buss','Veel','Seaded']);
      const text = await body();
      for (const label of ['Majandus','Tulemas','Buss praegu','Kiirtoimingud']) assert.ok(text.toLocaleLowerCase('et').includes(label.toLocaleLowerCase('et')), label);
      assert.equal(await evaluate("document.querySelector('.mm-mark').textContent"), 'M');
      assert.doesNotMatch(text, /AnniVibe|Tugi|Loo täna|Täna sulle/);
      assert.ok(await evaluate("document.querySelector('nav [aria-current=page]').textContent.includes('Kodu')"));
    });
    await t.test('Calendar and Home add flow remain empty until explicitly saved', async () => {
      await nav('Kalender');
      assert.match(await body(), /Kodu sündmused ühes vaates/);
      assert.match(await body(), /Ühtegi sündmust pole veel/);
      await nav('Kodu');
      await click('Lisa sündmus');
      await waitFor("!!document.querySelector('#event-title')");
      assert.equal(await evaluate("document.querySelector('#event-title').value"), '');
      await click('Tühista');
      assert.equal(await storage(), initialStorage);
    });
    await t.test('Veel opens existing Loo and returns without storage migration', async () => {
      await nav('Veel');
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Joonistamine ja loomine')).click()");
      await waitFor("document.body.innerText.includes('Üllata')");
      assert.ok(await evaluate("document.querySelector('nav [aria-current=page]').textContent.includes('Veel')"));
      await click('Tagasi: Veel');
      assert.match(await body(), /Muud tööriistad selles kodus/);
      assert.equal(await storage(), initialStorage);
    });
    await t.test('existing diary PIN and entries survive navigation and relock', async () => {
      await nav('Veel');
      await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent.includes('Päevik')).click()");
      await waitFor("!!document.querySelector('input[type=password]')");
      assert.doesNotMatch(await body(), /Säiliv päevik/);
      await input('input[type=password]', '9999');
      await click('Ava →');
      assert.match(await body(), /See PIN ei klapi/);
      await input('input[type=password]', '1234');
      await click('Ava →');
      assert.match(await body(), /Säiliv päevik/);
      await nav('Kodu');
      await nav('Veel');
      await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent.includes('Päevik')).click()");
      await waitFor("!!document.querySelector('input[type=password]')");
      assert.doesNotMatch(await body(), /Säiliv päevik/);
      assert.equal(await storage(), initialStorage);
    });
    await t.test('Settings groups and waste link expose no fake engines or destructive default', async () => {
      await nav('Kodu');
      await click('Prügivedu');
      const text = await body();
      for (const label of ['Majapidamine','Prügivedu','Teavitused','Buss','Rakendus']) assert.ok(text.toLocaleLowerCase('et').includes(label.toLocaleLowerCase('et')), label);
      assert.match(text, /Lisa aadress/);
      assert.doesNotMatch(text, /Perega jagamine|Tume režiim|Graafik leitud/);
      assert.equal(await evaluate("document.querySelector('#prugivedu').getBoundingClientRect().top >= 0"), true);
      assert.equal(await storage(), initialStorage);
    });
    await t.test('existing profile save and diary reset cancellation still work under Settings', async () => {
      await nav('Seaded');
      await evaluate("[...document.querySelectorAll('summary')].find(s=>s.textContent==='Sinu nimi').click()");
      await input('#profile-name', 'Mari');
      await click('Salvesta', "document.querySelector('[aria-labelledby=household-heading]')");
      assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('sade_profile'))"), {name:'Mari'});
      await evaluate("[...document.querySelectorAll('summary')].find(s=>s.textContent==='Päeviku PIN ja andmed').click()");
      const before = await storage();
      await click('Kustuta PIN ja päevik');
      assert.match(await body(), /jäädavalt/);
      await click('Tühista');
      assert.equal(await storage(), before);
      await nav('Kodu');
      await nav('Seaded');
      await evaluate("[...document.querySelectorAll('summary')].find(s=>s.textContent==='Sinu nimi').click()");
      assert.equal(await evaluate("document.querySelector('#profile-name').value"), 'Mari');
    });
    await t.test('Home bus uses existing GPS data and opens preserved bus view', async () => {
      await nav('Kodu');
      await evaluate('window.gpsSuccess({coords:{latitude:59.333238,longitude:26.375306}})');
      await pause(100);
      assert.match(await body(), /Ajad on sõiduplaani järgi/);
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Ava buss')).click()");
      await waitFor("!!document.querySelector('#buss-destination')");
      assert.ok(await evaluate("!!document.querySelector('#buss-destination')"));
      await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Vali sihtkoht kaardilt')).click()");
      await waitFor("!!document.querySelector('.leaflet-container')");
      await click('Sulge');
      await waitFor("!document.querySelector('.leaflet-container')");
      await nav('Kodu');
    });
    await t.test('mobile and desktop layout, keyboard navigation and light palette', async () => {
      for (const width of [320,390,768,1280]) {
        await send('Emulation.setDeviceMetricsOverride', {width,height:844,deviceScaleFactor:1,mobile:false});
        for (const label of ['Kodu','Kalender','Veel','Seaded','Buss']) {
          await nav(label);
          assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `${label} overflows ${width}px`);
          assert.doesNotMatch(await body(), /Majamajandus|\bMM\b/i, `${label} has stale visible branding`);
        }
      }
      await nav('Kodu');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-app-shell]')).backgroundColor"), 'rgb(244, 242, 238)');
      await evaluate("document.querySelector('nav button').focus()");
      await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Kalender');
      await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
      await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await waitFor("document.querySelector('nav [aria-current=page]').textContent.includes('Kalender')");
    });
    await t.test('accessible primary navigation names and GPS CTA survive the shared palette', async () => {
      await nav('Buss');
      const {nodes} = await send('Accessibility.getFullAXTree');
      const names = nodes.filter(n => !n.ignored && n.role?.value === 'button').map(n=>n.name?.value);
      for (const label of ['Kodu','Kalender','Buss','Veel','Seaded','Näita busse minu lähedal']) {
        assert.ok(names.some(name=>name?.includes(label)), `Missing accessible button: ${label}`);
      }
      const colors = await evaluate(`(() => {
        const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Näita busse minu lähedal'));
        const style=getComputedStyle(button); return [style.color, style.backgroundColor];
      })()`);
      const luminance = rgb => rgb.match(/\d+/g).slice(0,3).map(Number).map(v=>v/255)
        .map(v=>v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4)
        .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const values = colors.map(luminance).sort((a,b)=>b-a);
      assert.ok((values[0]+.05)/(values[1]+.05) >= 4.5, 'GPS label contrast must remain compliant');
    });
    // Sample real CSS animation endpoints instead of depending on wall-clock frames.
    const finishMotion = () => evaluate(`Promise.all(document.getAnimations()
      .filter(a=>Number.isFinite(a.effect.getTiming().iterations))
      .map(a=>a.finished.catch(()=>{}))).then(()=>true)`);
    const entrance = selector => evaluate(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)});
      const animation=el.getAnimations().find(a=>a.effect.target===el);
      if(!animation) return null;
      animation.pause(); animation.currentTime=0;
      const start={opacity:getComputedStyle(el).opacity,transform:getComputedStyle(el).transform};
      const timing=animation.effect.getTiming(); animation.currentTime=timing.delay+timing.duration;
      const end={opacity:getComputedStyle(el).opacity,transform:getComputedStyle(el).transform};
      animation.finish(); return {start,end,duration:timing.duration,iterations:timing.iterations};
    })()`);
    const assertEntrance = (motion, min, max) => {
      assert.ok(motion, 'a finite entrance animation must exist');
      assert.notEqual(motion.start.transform, motion.end.transform, 'entrance must move, not only fade');
      assert.ok(Number(motion.start.opacity) < Number(motion.end.opacity), 'entrance must fade in');
      assert.ok(motion.duration >= min && motion.duration <= max, 'entrance stays brief');
      assert.equal(motion.iterations, 1, 'entrance must not loop');
    };
    const assertPress = async selector => {
      await finishMotion();
      await send('DOM.enable'); await send('CSS.enable');
      const {root:domRoot}=await send('DOM.getDocument');
      const {nodeId}=await send('DOM.querySelector',{nodeId:domRoot.nodeId,selector});
      assert.ok(nodeId, `rendered control required: ${selector}`);
      const style = () => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});
        const s=getComputedStyle(el); return {transform:s.transform,properties:s.transitionProperty,
          duration:s.transitionDuration,scale:new DOMMatrixReadOnly(s.transform).a};})()`);
      assert.match((await style()).properties, /transform/, selector+' must transition its press state');
      try {
        await send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['active']});
        await finishMotion();
        const pressed=await style();
        assert.ok(pressed.scale >= .96 && pressed.scale < 1, selector+' must have subtle press feedback');
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled=true`);
        await finishMotion();
        assert.equal((await style()).transform,'none', 'disabled controls must not shrink');
      } finally {
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled=false`);
        await send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
      }
    };
    await t.test('native motion: page and Home entrances are brief, spatial and finite', async () => {
      await nav('Veel'); await nav('Kodu');
      assertEntrance(await entrance('.mm-main'),200,240);
      assertEntrance(await entrance('.mm-mark'),120,240);
      const delays=await evaluate("[...document.querySelectorAll('.mm-page > .mm-section')].map(e=>parseFloat(getComputedStyle(e).animationDelay)*1000)");
      assert.equal(delays.length,3);
      for(let i=1;i<delays.length;i++) assert.ok(delays[i]-delays[i-1]>=20 && delays[i]-delays[i-1]<=40);
      await finishMotion();
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-main')).transform"),'none',
        'finished entrance must not retain a containing block for fixed map overlays');
    });
    await t.test('native motion: selected navigation icon moves without moving labels', async () => {
      await nav('Kodu'); await finishMotion();
      const labelTop=await evaluate("document.querySelectorAll('nav button')[1].lastElementChild.getBoundingClientRect().top");
      await nav('Kalender'); await finishMotion();
      const selected=await evaluate(`(() => {const el=document.querySelector('nav [aria-current=page] .mm-nav-icon');
        const s=getComputedStyle(el),m=new DOMMatrixReadOnly(s.transform);
        return {scale:m.a,y:m.f,transition:s.transitionProperty,
          labelTop:el.nextElementSibling.getBoundingClientRect().top};})()`);
      assert.ok(selected.scale>=1.05 && selected.scale<=1.08, 'active icon has restrained emphasis');
      assert.ok(selected.y<0 && selected.y>=-2);
      assert.match(selected.transition,/transform/);
      assert.equal(selected.labelTop,labelTop);
    });
    await t.test('native motion: one pointer or touch activation navigates without moving the nav layout', async () => {
      try {
        for(const [width,height,touch] of [[375,812,true],[390,844,true],[1280,900,false]]) {
          await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:touch});
          await send('Emulation.setTouchEmulationEnabled',{enabled:touch});
          for(let repeat=0;repeat<2;repeat++) for(const label of ['Kodu','Kalender','Buss','Veel','Seaded','Kodu']) {
            await finishMotion();
            const point=await evaluate(`(() => {const r=[...document.querySelectorAll('nav button')]
              .find(e=>e.textContent.trim()===${JSON.stringify(label)}).getBoundingClientRect();
              return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
            if(touch) {
              await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
              await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
            } else {
              await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
              await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
              await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
            }
            await waitFor(`document.querySelector('nav [aria-current=page]').textContent.trim()===${JSON.stringify(label)}`);
            await finishMotion();
            assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth &&
              [...document.querySelectorAll('nav button')].every(e=>{const r=e.getBoundingClientRect();
                return r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1;})`));
          }
        }
      } finally { await send('Emulation.setTouchEmulationEnabled',{enabled:false}); }
    });
    await t.test('native motion: enabled controls press, disabled controls remain still', async () => {
      await nav('Kodu');
      for(const selector of ['.mm-quick-grid .mm-button','.mm-text-button','.mm-nav button']) await assertPress(selector);
      await nav('Kalender');
      for(const selector of ['.mm-month-heading button','.mm-day']) await assertPress(selector);
      await nav('Veel'); await assertPress('.mm-utility-row');
    });
    await t.test('native motion: calendar selection and dialog entrance preserve usable controls', async () => {
      await nav('Kalender'); await finishMotion();
      const scale=await evaluate("new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.mm-day[aria-pressed=true]')).transform).a");
      assert.ok(scale>1 && scale<=1.03, 'selected day has subtle emphasis');
      for(const width of [375,1280]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
        await click('Lisa sündmus');
        try {
          assertEntrance(await entrance('.mm-event-dialog'),200,240);
          assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.mm-event-dialog'),'::backdrop').animationName"),'none');
          await finishMotion();
          assert.ok(await evaluate(`(() => {const r=document.querySelector('.mm-save-event').getBoundingClientRect();
            return r.top>=0 && r.bottom<=innerHeight && document.documentElement.scrollWidth<=innerWidth;})()`));
        } finally { await click('Tühista'); }
      }
    });
    await t.test('native motion: utility arrow, disclosure and input focus expose state transitions', async () => {
      await nav('Veel');
      assert.match(await evaluate("getComputedStyle(document.querySelector('.mm-utility-row > svg:last-child')).transitionProperty"),/transform/);
      await nav('Seaded');
      assert.match(await evaluate("getComputedStyle(document.querySelector('.mm-settings-group summary'),'::after').transitionProperty"),/transform/);
      await nav('Kalender'); await click('Lisa sündmus');
      try {
        await evaluate("document.querySelector('#event-title').focus()");
        await finishMotion();
        assert.notEqual(await evaluate("getComputedStyle(document.querySelector('#event-title')).boxShadow"),'none');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#event-title')).outlineStyle"),'solid');
      } finally { await click('Tühista'); }
    });
    await t.test('native motion: no looping shell decoration and reduced motion keeps navigation/dialogs usable', async () => {
      const before=await storage();
      for(const label of ['Kodu','Kalender','Buss','Veel','Seaded']) {
        await nav(label);
        assert.deepEqual(await evaluate(`[...document.querySelectorAll('[class*="mm-"]')]
          .filter(e=>getComputedStyle(e).animationIterationCount.split(',').some(v=>v.trim()==='infinite'))
          .map(e=>e.className)`),[],label+' must not have looping shell motion');
      }
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      try {
        for(const label of ['Kodu','Kalender','Buss','Veel','Seaded']) {
          await nav(label);
          assert.equal(await evaluate("document.querySelector('nav [aria-current=page]').textContent.trim()"),label);
          assert.ok(await evaluate(`[...document.querySelectorAll('[data-app-shell] *')].every(e=>
            ['', '::before','::after'].every(p=>{const s=getComputedStyle(e,p||null);
              return s.animationName==='none' && s.transitionDuration.split(',').every(v=>parseFloat(v)===0);}))`));
        }
        await nav('Kalender'); await click('Lisa sündmus');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-event-dialog')).animationName"),'none');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.mm-event-dialog'),'::backdrop').animationName"),'none');
        await click('Tühista');
        assert.equal(await storage(),before);
      } finally { await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]}); }
    });
    const selectField = (selector,value) => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});
      el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const toggleAdvanced = () => evaluate("document.querySelector('.mm-event-dialog details > summary').click()");
    const withEvents = async (events,check) => {
      const before=await snapshotCalendar();
      try {
        await seedCalendar(events);
        await send('Page.reload');await waitFor("!!document.querySelector('nav')");await nav('Kalender');
        await check();
      } finally {
        await restoreCalendar(before);
        await send('Page.reload');await waitFor("!!document.querySelector('nav')");
      }
    };
    await t.test('Calendar UX V2: visible Lisa and grouped today control fit mobile and desktop',async()=>{
      await nav('Kalender');
      for(const [width,height] of [[375,812],[390,844],[1280,900]]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await finishMotion();
        const header=await evaluate(`(() => {const b=document.querySelector('.mm-calendar-header > button'),r=b.getBoundingClientRect();
          const span=b.querySelector('span'),s=span.getBoundingClientRect(),h=document.querySelector('.mm-calendar-header h1').getBoundingClientRect();
          return {text:span.textContent,name:b.getAttribute('aria-label'),visible:s.width>10 && s.height>10,
            icon:!!b.querySelector('svg'),fits:h.right<r.left && r.right<=innerWidth,height:r.height};})()`);
        assert.equal(header.text,'Lisa');assert.equal(header.name,'Lisa sündmus');
        assert.ok(header.visible && header.icon && header.fits && header.height>=44);
        assert.ok(await evaluate("[...document.querySelectorAll('.mm-month-heading button')].some(b=>b.textContent.trim()==='Täna')"),
          'Today belongs with the month controls');
      }
      await click('Järgmine kuu');await click('Täna');
      assert.equal(await evaluate("document.querySelector('.mm-day[aria-pressed=true]').dataset.date"),'2026-09-14');
      await click('Eelmine kuu');await click('Täna');
      assert.equal(await evaluate("document.querySelector('.mm-day[aria-pressed=true]').dataset.date"),'2026-09-14');
    });
    await t.test('Calendar UX V2: date result directly follows month before legend and agenda',async()=>{
      await nav('Kalender');await finishMotion();
      assert.equal(await evaluate("document.querySelector('.mm-month').nextElementSibling.id"),'selected-events');
      assert.ok(await evaluate("document.querySelector('#selected-events').nextElementSibling.classList.contains('mm-calendar-legend')"));
      assert.notEqual(await evaluate("getComputedStyle(document.querySelector('#selected-heading')).textTransform"),'uppercase');
      const scroll=await evaluate('scrollY');
      for(const day of ['2026-09-15','2026-09-18']) {
        await evaluate(`document.querySelector('[data-date="${day}"]').click()`);
        await waitFor(`document.querySelector('.mm-day[aria-pressed=true]').dataset.date==='${day}'`);
        assert.ok((await evaluate("document.querySelector('#selected-heading').textContent")).includes(String(Number(day.slice(8)))));
        assert.equal(await evaluate('scrollY'),scroll);assert.equal(await evaluate("!!document.querySelector('dialog[open]')"),false);
      }
    });
    await t.test('Calendar UX V2: essentials-only creation saves the selected date without opening advanced fields',async()=>{
      await withEvents([],async()=>{
        await evaluate("document.querySelector('[data-date=\"2026-09-18\"]').click()");
        await click('Lisa sündmus');await finishMotion();
        try {
          assert.equal(await evaluate("document.querySelector('#event-date').value"),'2026-09-18');
          assert.ok(await evaluate("!!document.querySelector('.mm-event-dialog details > summary')"),'advanced disclosure exists');
          assert.equal(await evaluate("document.querySelector('.mm-event-dialog details').open"),false);
          for(const id of ['title','category','date','time']) assert.ok(await evaluate(`document.querySelector('#event-${id}').checkVisibility()`));
          for(const id of ['repeat','reminder','notes']) assert.equal(await evaluate(`document.querySelector('#event-${id}').checkVisibility()`),false);
          await selectField('#event-category','waste');
          await waitFor("!!document.querySelector('#event-subtype')");
          assert.ok(await evaluate("document.querySelector('#event-subtype').checkVisibility()"),'waste subtype remains essential');
          await input('#event-title','UX quick event');await click('Salvesta sündmus');
          await waitFor("!document.querySelector('dialog[open]')");
          assert.match(await evaluate("document.querySelector('#selected-events').innerText"),/UX quick event/);
          const saved=(await readCalendarEvents())[0];
          assert.equal(saved.date,'2026-09-18');assert.equal(saved.recurrence.frequency,'none');assert.equal(saved.reminder.daysBefore,0);
          await evaluate("document.querySelector('#selected-events [data-occurrence]').click()");await click('Kustuta');await click('Kinnita kustutamine');
          assert.equal((await readCalendarEvents()).length,0);
        } finally { if(await evaluate("!!document.querySelector('dialog[open]')")) await click('Tühista'); }
      });
    });
    await t.test('Calendar UX V2: advanced creation preserves recurrence reminder and notes on edit',async()=>{
      await withEvents([],async()=>{
        await click('Lisa sündmus');
        assert.ok(await evaluate("!!document.querySelector('.mm-event-dialog details')"),'advanced disclosure exists');
        await toggleAdvanced();await waitFor("document.querySelector('.mm-event-dialog details').open");
        for(const id of ['repeat','reminder','notes']) assert.ok(await evaluate(`document.querySelector('#event-${id}').checkVisibility()`));
        await input('#event-title','UX advanced event');await selectField('#event-repeat','weekly');
        await waitFor("!!document.querySelector('#event-interval')");await input('#event-interval','2');await selectField('#event-reminder','3');
        await evaluate("(()=>{const e=document.querySelector('#event-notes');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Bring keys');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
        await toggleAdvanced();await click('Salvesta sündmus');await waitFor("!document.querySelector('dialog[open]')");
        await evaluate("document.querySelector('#selected-events [data-occurrence]').click()");await click('Muuda');await click('Kogu sari');
        assert.equal(await evaluate("document.querySelector('.mm-event-dialog details').open"),true);
        assert.deepEqual(await evaluate("['repeat','interval','reminder','notes'].map(id=>document.querySelector('#event-'+id).value)"),['weekly','2','3','Bring keys']);
        await input('#event-title','UX renamed');await click('Salvesta sündmus');await waitFor("!document.querySelector('dialog[open]')");
        assert.match(await evaluate("document.querySelector('#selected-events').innerText"),/UX renamed/);
        await evaluate("document.querySelector('#selected-events [data-occurrence]').click()");await click('Kustuta');await click('Kogu sari');await click('Kinnita kustutamine');
        assert.equal((await readCalendarEvents()).length,0);
      });
    });
    await t.test('Calendar UX V2: each existing advanced setting and imported edit is disclosed without weakening source fields',async()=>{
      for(const patch of [{},{notes:'Existing notes'},{reminder:{daysBefore:1}},{recurrence:{frequency:'weekly',interval:1}},{source:'imported'}]) {
        const event={...createEvent({title:'UX fixture',category:'general',date:'2026-09-14',...patch},'ux-fixture'),...patch};
        await withEvents([event],async()=>{
          await evaluate("document.querySelector('#selected-events [data-occurrence]').click()");await click('Muuda');
          if(event.recurrence.frequency!=='none') await click('Ainult see kord');
          assert.ok(await evaluate("!!document.querySelector('.mm-event-dialog details')"),'advanced disclosure exists when editing');
          assert.equal(await evaluate("document.querySelector('.mm-event-dialog details').open"),Object.keys(patch).length>0);
          if(event.source==='imported') {
            for(const id of ['title','category','date','time','repeat']) assert.ok(await evaluate(`document.querySelector('#event-${id}').matches(':disabled')`),id+' remains protected');
            for(const id of ['reminder','notes']) assert.ok(await evaluate(`!document.querySelector('#event-${id}').matches(':disabled') && document.querySelector('#event-${id}').checkVisibility()`));
            await selectField('#event-reminder','7');await click('Salvesta sündmus');
            await waitFor("!document.querySelector('dialog[open]')");
            const saved=(await readCalendarEvents())[0];
            assert.equal(saved.reminder.daysBefore,7);assert.equal(saved.title,event.title);assert.equal(saved.date,event.date);assert.equal(saved.source,'imported');
          } else await click('Tühista');
        });
      }
    });
    if (process.env.VISUAL_TESTS === '1') {
      await runVisualChecks({t,nav,click,input,evaluate,waitFor,body,send});
    }
    if (process.env.CALENDAR_TESTS === '1') {
      await runCalendarChecks({t,nav,click,input,evaluate,waitFor,body,send,...shared});
    }
    if (process.env.WASTE_TESTS === '1') {
      await runWasteChecks({t,nav,click,input,evaluate,waitFor,body,send,...shared});
    }
    if (process.env.REMINDER_TESTS === '1') {
      await runReminderChecks({t,nav,click,input,evaluate,waitFor,body,send,...shared});
    }
    if (process.env.NATIVE_NOTIFICATION_TEST === '1') {
      await t.test('MJM04 native Chromium service-worker notification acceptance and reload dedupe',async()=>{
        await evaluate("navigator.serviceWorker.register('/notification-test-sw.js').then(()=>navigator.serviceWorker.ready).then(()=>true)");
        await send('Browser.setPermission',{permission:{name:'notifications'},setting:'granted',origin:`http://127.0.0.1:${server.address().port}`});
        await nav('Kodu');await click('Lisa sündmus');await input('#event-title','Native API check');await input('#event-date','2026-09-15');await input('#event-time','06:00');
        await evaluate("(()=>{const el=document.querySelector('#event-reminder');el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}));})()");
        await click('Salvesta sündmus');await waitFor("!document.querySelector('dialog[open]')");
        await nav('Seaded');await click('Luba seadme teavitused');
        await waitFor("navigator.serviceWorker.getRegistration().then(r=>r.getNotifications()).then(items=>items.length===1)");
        assert.equal(await evaluate("navigator.serviceWorker.getRegistration().then(r=>r.getNotifications()).then(items=>items[0].title)"),'Native API check');
        const before=await evaluate("localStorage.getItem('majamajandus_reminder_delivery_v1')");
        await send('Page.reload');await waitFor("!!document.querySelector('nav')");await nav('Seaded');
        assert.equal(await evaluate("localStorage.getItem('majamajandus_reminder_delivery_v1')"),before);
        await evaluate("navigator.serviceWorker.getRegistration().then(r=>r.getNotifications()).then(items=>items.forEach(n=>n.close()))");
      });
    }

    if (process.env.CUTOVER_TESTS === '1' || OTHER_SUITE_FLAGS.every(flag => process.env[flag] !== '1')) {
      // ---- C6 cutover acceptance: real controller, real migration/switch, real repositories, real browser signals ----
      const appUrl = `http://127.0.0.1:${server.address().port}`;
      const memory = () => { const values = new Map(); return { getItem: key => (values.has(key) ? values.get(key) : null), setItem: (key, value) => { values.set(key, String(value)); } }; };
      const FIXTURE_ADDRESS = 'Fixture 1';
      let seedIds = 0;
      const legacyProfile = () => {
        const store = memory();
        const repository = createEventRepository(store, () => `seed-event-${++seedIds}`);
        repository.create({ title: 'Käsitsi hooldus', category: 'maintenance', date: '2026-09-16', time: '09:30', notes: 'Märge', reminder: { daysBefore: 1 } });
        repository.create({ title: 'Iganädalane kohtumine', category: 'general', date: '2026-09-14', recurrence: { frequency: 'weekly', interval: 1 } });
        repository.importWaste(normalizeWasteResult({ id: 'fixture', name: 'Controlled test source' }, FIXTURE_ADDRESS, { entries: [
          { externalId: 'w1', title: 'Seeme bio', subtype: 'bio', date: '2026-09-15' }, { externalId: 'w2', title: 'Seeme paber', subtype: 'paper', date: '2026-09-17' }] }), new Date(2026, 8, 14, 6));
        const places = [
          { name: 'Kodu', address: 'Tamme 1, Rakvere', lat: 59.34, lon: 26.35 }, { name: 'Kool', address: '', lat: null, lon: null },
          { name: 'Trenn', address: '', lat: null, lon: null }, { name: 'Pood', address: 'Keskväljak 2', lat: 59.35, lon: 26.36 }];
        const household = { version: 1, profile: { name: 'Meie kodu', address: FIXTURE_ADDRESS } };
        return { calendar: store.getItem('majamajandus_household_events_v1'), household: JSON.stringify(household), places: JSON.stringify(places), placesValue: places, householdValue: household.profile };
      };
      const legacyKeys = seed => ({ majamajandus_household_events_v1: seed.calendar, majamajandus_household_profile_v1: seed.household, sade_saved_places: seed.places });
      const legacyBytes = () => evaluate(`Object.fromEntries(${JSON.stringify(SHARED_KEYS)}.map(key=>[key,localStorage.getItem(key)]))`);
      const byId = events => [...events].sort((a, b) => (a.id < b.id ? -1 : 1));
      const snapshotCalendarRecords = () => evaluate("__idb.getAll('calendarEvents').then(records=>JSON.stringify(records))");
      // A fresh device: drop IndexedDB (the mounted connection closes on versionchange), reset the shared legacy keys and hint, then reload.
      const resetProfile = async ({ legacy = {}, flags = [], wait = true } = {}) => {
        await evaluate("new Promise(resolve=>{const r=indexedDB.deleteDatabase('majandus_local_v1');r.onsuccess=()=>resolve(true);r.onerror=()=>resolve(false);r.onblocked=()=>{};})");
        await evaluate(`${JSON.stringify([...SHARED_KEYS, HINT_KEY])}.forEach(key=>localStorage.removeItem(key))`);
        for (const [key, value] of Object.entries(legacy)) await evaluate(`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(value)})`);
        for (const key of ['c6HintFail', 'c6HintUnreadable', 'c6NoBroadcast', 'c6Blocked', 'c6HoldLock']) await evaluate(`sessionStorage.removeItem('${key}')`);
        for (const key of flags) await evaluate(`sessionStorage.setItem('${key}','1')`);
        await send('Page.reload');
        if (wait) await ready();
      };
      const stateOf = () => evaluate("document.querySelector('[data-storage-state]')?.dataset.storageState ?? null");
      const noSharedControls = () => evaluate(`!document.querySelector('[aria-label="Lisa sündmus"]') && !document.querySelector('#household-name')`);
      const attach = async () => {
        const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${appUrl}`, { method: 'PUT' })).json();
        const tabSocket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { tabSocket.addEventListener('open', resolve, { once: true }); tabSocket.addEventListener('error', reject, { once: true }); });
        let tabId = 0; const waiting = new Map();
        tabSocket.addEventListener('message', event => { const message = JSON.parse(event.data); const request = waiting.get(message.id);
          if (request) { waiting.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); } });
        const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++tabId; waiting.set(id, { resolve, reject }); tabSocket.send(JSON.stringify({ id, method, params })); });
        const run = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
          assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result.value; };
        const until = async expression => { for (let i = 0; i < 100; i++) { if (await run(expression)) return; await pause(30); } assert.fail('Second tab condition not met: ' + expression); };
        const press = async (text, within = 'document') => { await run(`[...${within}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)}).click()`); await pause(80); };
        const fill = async (selector, value) => { await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`); await pause(60); };
        await call('Runtime.enable'); await call('Page.enable');
        await until("!!document.querySelector('nav')");
        return { run, until, press, fill, close: async () => { tabSocket.close(); await fetch(`http://127.0.0.1:${cdpPort}/json/close/${target.id}`); } };
      };
      const addEventInTab = async (tab, title) => {
        await tab.press('Kalender', "document.querySelector('nav')");
        await tab.press('Lisa sündmus'); await tab.until("!!document.querySelector('#event-title')");
        await tab.fill('#event-title', title); await tab.press('Salvesta sündmus'); await tab.until("!document.querySelector('dialog[open]')");
      };
      const seeded = legacyProfile();
      const seededKeys = legacyKeys(seeded);
      const legacyModeSeed = { ...seededKeys, sade_saved_places: 'not json' };

      await t.test('C6 cutover: nothing shared is read or mounted while the controller is still BOOTING', async () => {
        await resetProfile({ legacy: mode === 'READY' ? seededKeys : legacyModeSeed, flags: ['c6HoldLock'], wait: false });
        await waitFor("!!document.querySelector('[data-storage-state=BOOTING]')");
        await pause(600);
        assert.equal(await evaluate('window.__sharedReads.length'), 0, 'no shared legacy key is read before the controller resolves');
        assert.equal(await evaluate('window.__idbOpens'), 0, 'IndexedDB is not opened before the controller boots');
        assert.equal(await evaluate("!!document.querySelector('nav') || !!document.querySelector('#event-title')"), false, 'only the minimal splash is shown');
        await evaluate('window.__releaseLock()');
        await ready();
        assert.ok(await evaluate('window.__sharedReads.length') > 0, 'the controller itself reads the legacy sources once it boots');
        await evaluate("sessionStorage.removeItem('c6HoldLock')");
      });

      if (mode === 'READY') {
        // Hold completion of a real transaction with queued requests, not a mocked mutation promise.
        const holdTransaction = (transactionMode, storeName) => evaluate(`(() => {
          const original = IDBDatabase.prototype.transaction;
          window.__held = false; window.__releaseTransaction = () => { window.__holding = false; };
          window.__holding = true;
          IDBDatabase.prototype.transaction = function(names, mode, ...rest) {
            const tx = original.call(this, names, mode, ...rest);
            if (mode === ${JSON.stringify(transactionMode)} && Array.from(tx.objectStoreNames).includes(${JSON.stringify(storeName)})) {
              IDBDatabase.prototype.transaction = original;
              window.__held = true;
              const store = tx.objectStore(${JSON.stringify(storeName)});
              const pump = () => { if (window.__holding) store.get('__keep_alive__').onsuccess = pump; };
              pump();
            }
            return tx;
          };
        })()`);
        for (const signal of ['broadcast', 'focus']) {
          await t.test('C6 corrective A: authority recheck precedes ' + signal + ' domain refresh', async () => {
            await resetProfile({ legacy: seededKeys, flags: signal === 'focus' ? ['c6NoBroadcast'] : [] });
            await waitFor("window.__runtime.getSnapshot().session?.stores.places.getSnapshot().data?.places.length > 0");
            const before = await evaluate("window.__runtime.getSnapshot().session.stores.places.getSnapshot().data");
            await evaluate(`(async () => {
              const a = await __idb.get('meta','storageAuthorityV1');
              await __idb.put('meta',{...a,switchId:'switch-B'});
              const p = (await __idb.getAll('sharedPlaces'))[0];
              await __idb.put('sharedPlaces',{...p,payload:{...p.payload,name:'AUTHORITY B ONLY'}});
            })()`);
            await holdTransaction('readonly', 'meta');
            try {
              await evaluate(signal === 'focus' ? "window.dispatchEvent(new Event('focus'))" : "(()=>{const c=new BroadcastChannel('majandus:replica');c.postMessage({type:'authority-changed'});c.postMessage({type:'committed',domain:'places'});c.close();})()");
              await waitFor('window.__held');
              await pause(200);
              assert.deepEqual(await evaluate("window.__runtime.getSnapshot().session.stores.places.getSnapshot().data"), before, 'pending authority check must not adopt B');
            } finally { await evaluate('window.__releaseTransaction()'); }
            await waitFor("!!document.querySelector('[data-storage-state=RELOAD_REQUIRED]')");
            assert.deepEqual(await evaluate("window.__runtime.getSnapshot().session.stores.places.getSnapshot().data"), before);
          });
        }
        await t.test('C6 corrective B: remote saved-place commit updates mounted Settings inputs', async () => {
          await resetProfile({ legacy: seededKeys }); await nav('Seaded');
          await waitFor("!!document.querySelector('.mm-place-name')");
          await evaluate("[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('Salvestatud kohad')).click()");
          const tab = await attach();
          try {
            await tab.press('Seaded', "document.querySelector('nav')");
            await tab.until("!!document.querySelector('.mm-place-name')");
            await tab.run("[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('Salvestatud kohad')).click()");
            await tab.fill('.mm-place-name', 'Remote home');
            await tab.fill('.mm-place-card input:not(.mm-place-name)', 'Remote address');
            await tab.press('Salvesta', "document.querySelector('.mm-place-card')");
            await tab.until("document.querySelector('.mm-place-card').innerText.includes('Salvestatud')");
            assert.equal((await readSavedPlaces())[0].name, 'Remote home');
            await waitFor("document.querySelector('.mm-place-name').value === 'Remote home'");
            assert.equal(await evaluate("document.querySelector('.mm-place-card input:not(.mm-place-name)').value"), 'Remote address');
            assert.equal(await stateOf(), null);

            await input('.mm-place-name', '  Remote home  ');
            // A committed reread with unchanged primitive props must not erase the local draft.
            await tab.run("window.__runtime.getSnapshot().session.stores.places.mutate(r=>r.update(0,{name:'Remote home'}),'Save failed')");
            await pause(150);
            assert.equal(await evaluate("document.querySelector('.mm-place-name').value"), '  Remote home  ');
            await click('Salvesta', "document.querySelector('.mm-place-card')");
            await waitFor("document.querySelector('.mm-place-card').innerText.includes('Salvestatud')");
            assert.equal(await evaluate("document.querySelector('.mm-place-name').value"), (await readSavedPlaces())[0].name, 'local success converges even when canonical props did not change');

            // Removal has no Settings control; use the mounted store's real repository mutation and broadcast.
            await tab.run("window.__runtime.getSnapshot().session.stores.places.mutate(r=>r.remove(0),'Save failed')");
            const shifted = await readSavedPlaces();
            await waitFor(`document.querySelectorAll('.mm-place-name').length === ${shifted.length} && document.querySelector('.mm-place-name').value === ${JSON.stringify(shifted[0].name)}`);
            assert.deepEqual(await evaluate("[...document.querySelectorAll('.mm-place-card')].map(e=>({name:e.querySelector('.mm-place-name').value,address:e.querySelector('input:not(.mm-place-name)').value}))"), shifted.map(({name,address})=>({name,address})));
          } finally { await tab.close(); }
        });
        for (const cancelPath of ['header', 'footer', 'escape', 'delete']) {
          await t.test('C6 corrective C: pending transaction blocks ' + cancelPath + ' cancel', async () => {
            await resetProfile({ legacy: seededKeys }); await nav('Kalender');
            // Native Escape cancellation requires real user activation when opening the dialog.
            const point = await evaluate("(()=>{const b=document.querySelector('button[aria-label=\"Lisa sündmus\"]');b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
            await send('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left', clickCount:1});
            await send('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'left', clickCount:1});
            await waitFor("!!document.querySelector('#event-title')");
            await input('#event-title', 'Held event');
            if (cancelPath === 'delete') {
              await click('Salvesta sündmus'); await waitFor("!document.querySelector('dialog[open]')");
              await evaluate("[...document.querySelectorAll('#selected-events [data-occurrence]')].find(e=>e.innerText.includes('Held event')).click()");
              await click('Kustuta');
            }
            await holdTransaction('readwrite', 'calendarEvents');
            try {
              await click(cancelPath === 'delete' ? 'Kinnita kustutamine' : 'Salvesta sündmus');
              await waitFor('window.__held');
              assert.equal(await evaluate("document.querySelector('.mm-save-event, .mm-delete-confirm').disabled"), true, 'duplicate mutation disabled');
              if (cancelPath === 'escape') {
                await evaluate("window.__escapeEvents=[];document.addEventListener('keydown',e=>setTimeout(()=>__escapeEvents.push({type:e.type,target:e.target.tagName,prevented:e.defaultPrevented}),0));document.querySelector('dialog').addEventListener('cancel',e=>setTimeout(()=>__escapeEvents.push({type:e.type,cancelable:e.cancelable,prevented:e.defaultPrevented}),0))");
                for (let press = 0; press < 2; press++) {
                  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
                  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
                }
              } else await evaluate(`document.querySelector('.mm-event-dialog ${cancelPath === 'footer' ? 'footer' : 'header'} button').click()`);
              await pause(80);
              assert.equal(await evaluate("!!document.querySelector('dialog[open]')"), true, 'pending dialog stays open: ' + JSON.stringify(await evaluate('window.__escapeEvents')));
            } finally { await evaluate('window.__releaseTransaction()'); }
            await waitFor("!document.querySelector('dialog[open]')");
            assert.equal((await readCalendarEvents()).some(e=>e.title==='Held event'), cancelPath !== 'delete');
          });
        }
        await t.test('C6 cutover: a real seeded legacy profile switches, mounts READY and shows semantically identical data', async () => {
          await resetProfile({ legacy: seededKeys });
          const authority = await evaluate("__idb.get('meta','storageAuthorityV1')");
          assert.equal(authority.status, 'active');
          assert.equal(JSON.parse(await evaluate(`localStorage.getItem('${HINT_KEY}')`)).switchId, authority.switchId);
          const expected = JSON.parse(seeded.calendar);
          assert.deepEqual(byId(await readCalendarEvents()), byId(expected.events), 'calendar events equal the legacy events as an id-keyed set');
          assert.deepEqual((await evaluate("__idb.get('wasteState','waste')")).payload.wasteImports, expected.wasteImports, 'waste imports carried over');
          assert.deepEqual(await readHouseholdProfile(), seeded.householdValue);
          assert.deepEqual(await readSavedPlaces(), seeded.placesValue);
          assert.deepEqual(await legacyBytes(), seededKeys, 'legacy shared bytes are unchanged by the switch');
          assert.equal(await stateOf(), null, 'no blocking or notice state in the normal READY state');
          await nav('Kalender');
          assert.match(await evaluate("document.querySelector('#selected-events').innerText"), /Iganädalane kohtumine/);
          await evaluate('document.querySelector(\'[data-date="2026-09-16"]\').click()');
          await waitFor("document.querySelector('#selected-events').innerText.includes('Käsitsi hooldus')");
          await nav('Seaded');
          assert.equal(await evaluate("document.querySelector('#household-name').value"), 'Meie kodu');
          assert.equal(await evaluate("document.querySelector('#household-address').value"), FIXTURE_ADDRESS);
          assert.deepEqual(await evaluate("[...document.querySelectorAll('.mm-place-name')].map(e=>e.value)"), seeded.placesValue.map(p => p.name));
          const wasteText = await evaluate("document.querySelector('#prugivedu').innerText");
          for (const subtype of ['bio', 'paper']) assert.ok(wasteText.includes(WASTE_SUBTYPES[subtype]), `imported subtype label ${subtype}`);
        });
        await t.test('C6 cutover: READY mutations persist across reload, and no shared legacy key is ever written', async () => {
          await nav('Kalender'); await click('Lisa sündmus'); await input('#event-title', 'Pärast lülitust'); await click('Salvesta sündmus');
          await waitFor("!document.querySelector('dialog[open]')");
          await nav('Seaded');
          await evaluate("document.querySelector('#household-profile').open=true");
          await input('#household-name', 'Uus kodu'); await click('Salvesta majapidamine'); await waitFor("document.body.innerText.includes('Majapidamine salvestatud')");
          const beforeReload = { events: byId(await readCalendarEvents()), household: await readHouseholdProfile() };
          assert.ok(beforeReload.events.some(e => e.title === 'Pärast lülitust'));
          assert.equal(beforeReload.household.name, 'Uus kodu');
          await send('Page.reload'); await ready();
          assert.deepEqual(byId(await readCalendarEvents()), beforeReload.events, 'the same IndexedDB state is visible after reload');
          await nav('Kalender'); assert.match(await evaluate("document.querySelector('#selected-events').innerText"), /Iganädalane kohtumine/);
          await nav('Seaded');
          assert.equal(await evaluate("document.querySelector('#household-name').value"), 'Uus kodu');
          assert.deepEqual(await legacyBytes(), seededKeys, 'READY never mirrors into a shared legacy key');
          assert.equal(await stateOf(), null, 'no re-adopt and no divergence notice after a normal READY session');
        });
        await t.test('C6 cutover: the committed message is broadcast only after the transaction completes, and another READY tab re-reads without a reload', async () => {
          await resetProfile({ legacy: seededKeys });
          await nav('Kalender');
          const tab = await attach();
          try {
            await tab.run('window.__bcLog.length=0;window.__rwStarted=0;window.__rwDone=0');
            await tab.run(`(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){
              const tx=original.apply(this,args);
              if(args[1]==='readwrite'&&Array.isArray(args[0])&&args[0].includes('calendarEvents')){
                const meta=tx.objectStore('meta'),end=performance.now()+400;
                const tick=()=>{if(performance.now()<end) meta.get('keepalive').onsuccess=tick;};tick();
              }
              return tx;};})()`);
            await addEventInTab(tab, 'Teisest aknast');
            await waitFor("document.querySelector('#selected-events').innerText.includes('Teisest aknast')");
            assert.equal(await stateOf(), null, 'a normal committed change is a domain re-read, never a reload banner');
            const log = await tab.run('window.__bcLog');
            const committed = log.filter(entry => entry.message.type === 'committed');
            assert.deepEqual(committed.map(entry => entry.message), [{ type: 'committed', domain: 'calendar' }]);
            assert.equal(committed[0].rwActive, 0, 'no readwrite transaction is still active when the commit is announced');
            assert.ok(committed[0].rwStarted >= 1 && committed[0].rwDone === committed[0].rwStarted, 'the write transaction had already started and completed when the commit was announced');
          } finally { await tab.close(); }
        });
        await t.test('C6 cutover: a failed READY mutation is never announced as committed', async () => {
          await nav('Kalender'); await evaluate('window.__bcLog.length=0');
          await click('Lisa sündmus'); await input('#event-title', 'Ei jõua kohale');
          await failWrites('calendar');
          try { await click('Salvesta sündmus'); await waitFor("document.body.innerText.includes('Salvestamine ebaõnnestus')"); }
          finally { await restoreWrites(); }
          assert.deepEqual(await evaluate("window.__bcLog.filter(e=>e.message.type==='committed')"), []);
          assert.equal(await evaluate("!!document.querySelector('dialog[open]')"), true, 'failed mutation keeps dialog open');
          assert.equal(await evaluate("[...document.querySelectorAll('.mm-event-dialog header button,.mm-event-dialog footer button')].every(b=>!b.disabled)"), true, 'failure enables cancel and save again');
          await click('Tühista');
          await waitFor("!document.querySelector('dialog[open]')");
        });
        await t.test('C6 cutover: without BroadcastChannel, focus and visibilitychange re-read the READY domain, with no polling', async () => {
          await resetProfile({ legacy: seededKeys, flags: ['c6NoBroadcast'] });
          await nav('Kalender');
          assert.equal(await evaluate('window.BroadcastChannel === undefined'), true);
          const tab = await attach();
          try {
            await addEventInTab(tab, 'Ilma kanalita');
            await pause(700);
            assert.doesNotMatch(await evaluate("document.querySelector('#selected-events').innerText"), /Ilma kanalita/, 'no polling: nothing changes without a signal');
            await evaluate("window.dispatchEvent(new Event('focus'))");
            await waitFor("document.querySelector('#selected-events').innerText.includes('Ilma kanalita')");
            await addEventInTab(tab, 'Nähtavus');
            await evaluate("Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'))");
            await waitFor("document.querySelector('#selected-events').innerText.includes('Nähtavus')");
            assert.equal(await stateOf(), null);
          } finally { await tab.close(); await evaluate("sessionStorage.removeItem('c6NoBroadcast')"); }
        });
        await t.test('C6 cutover: a real versionchange shows the reload banner and disables every shared-domain write control', async () => {
          await resetProfile({ legacy: seededKeys });
          await nav('Kalender'); await click('Lisa sündmus'); await input('#event-title', 'Jääb vormi');
          const result = await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('majandus_local_v1',2);let blocked=false;
            r.onblocked=()=>{blocked=true;};r.onupgradeneeded=()=>{};r.onsuccess=()=>{r.result.close();resolve({blocked});};r.onerror=()=>reject(r.error);})`);
          assert.equal(result.blocked, false, 'the mounted connection closes on versionchange, so the upgrade is not blocked');
          await waitFor("!!document.querySelector('[data-storage-state=RELOAD_REQUIRED]')");
          assert.match(await body(), /Majandus uuenes teises aknas\. Laadi leht uuesti\./);
          assert.equal(await evaluate("document.querySelector('.mm-save-event').disabled"), true, 'the open event form cannot save');
          assert.equal(await evaluate("document.querySelector('#event-title').value"), 'Jääb vormi');
          await click('Tühista');
          await nav('Kalender'); assert.equal(await evaluate('document.querySelector(\'[aria-label="Lisa sündmus"]\').disabled'), true);
          await nav('Seaded');
          assert.equal(await evaluate("[...document.querySelectorAll('.mm-household-form button')].every(b=>b.disabled)"), true);
          assert.equal(await evaluate("[...document.querySelectorAll('#prugivedu button')].filter(b=>['Lisa käsitsi graafik','Impordi kalendrisse','Värskenda graafikut','Leia prügipäevad'].includes(b.textContent.trim())).every(b=>b.disabled)"), true);
          assert.equal(await evaluate("[...document.querySelectorAll('.mm-place-card .mm-settings-save')].every(b=>b.disabled)"), true);
        });
        await t.test('C6 cutover: IndexedDB-only loss shows the dated STORAGE_LOST screen and confirmation restores the switch-time snapshot', async () => {
          const switchedAt = JSON.parse(await evaluate(`localStorage.getItem('${HINT_KEY}')`)).switchedAt;
          await evaluate("new Promise(resolve=>{const r=indexedDB.deleteDatabase('majandus_local_v1');r.onsuccess=()=>resolve(true);r.onerror=()=>resolve(false);})");
          await send('Page.reload'); await ready();
          assert.equal(await stateOf(), 'STORAGE_LOST');
          assert.ok((await body()).includes(`Kohalik andmebaas puudub. Taasta andmed seisuga ${switchedAt} varukoopiast?`), 'the dated recovery copy names the switch time');
          assert.equal(await noSharedControls(), true, 'nothing shared is mounted, and no automatic confirmation happens');
          await click('Taasta andmed'); await waitFor("!document.querySelector('[data-storage-state]')");
          assert.deepEqual(await readHouseholdProfile(), seeded.householdValue, 'data equals the frozen switch-time snapshot');
          assert.deepEqual(await legacyBytes(), seededKeys);
        });
        await t.test('C6 cutover: a failed hint write at boot shows AUTHORITY_HINT_PENDING with nothing shared mounted, and retry recovers', async () => {
          await resetProfile({ legacy: seededKeys, flags: ['c6HintFail'] });
          await waitFor("!!document.querySelector('[data-storage-state=AUTHORITY_HINT_PENDING]')");
          assert.match(await body(), /Seadme salvestusruum ei võtnud muudatust vastu\. Proovi uuesti\./);
          await nav('Kalender'); assert.equal(await noSharedControls(), true);
          assert.deepEqual(await legacyBytes(), seededKeys, 'never a LEGACY fallback and never a legacy write');
          assert.equal((await evaluate("__idb.get('meta','storageAuthorityV1')")).status, 'active', 'IndexedDB stays authoritative');
          await evaluate("sessionStorage.removeItem('c6HintFail')");
          await click('Proovi uuesti'); await waitFor("!document.querySelector('[data-storage-state]')");
          assert.equal(await evaluate(`!!localStorage.getItem('${HINT_KEY}')`), true);
          await nav('Kalender'); assert.equal(await evaluate('document.querySelector(\'[aria-label="Lisa sündmus"]\').disabled'), false);
        });
        await t.test('C6 cutover: AUTHORITY_HINT_PENDING retries automatically on focus', async () => {
          await resetProfile({ legacy: seededKeys, flags: ['c6HintFail'] });
          await waitFor("!!document.querySelector('[data-storage-state=AUTHORITY_HINT_PENDING]')");
          await evaluate("window.dispatchEvent(new Event('focus'))");
          await pause(300);
          assert.equal(await stateOf(), 'AUTHORITY_HINT_PENDING', 'a focus retry that still fails stays on the pending screen');
          await evaluate("sessionStorage.removeItem('c6HintFail')");
          await evaluate("window.dispatchEvent(new Event('focus'))");
          await waitFor("!document.querySelector('[data-storage-state]')");
          assert.equal(await evaluate(`!!localStorage.getItem('${HINT_KEY}')`), true);
        });
        await t.test('C6 cutover: a blocked open shows BLOCKED with Buss usable, never LEGACY, and retries automatically on focus', async () => {
          await resetProfile({ legacy: seededKeys, flags: ['c6Blocked'] });
          await waitFor("!!document.querySelector('[data-storage-state=BLOCKED]')");
          assert.match(await body(), /Sulge Majanduse teised aknad ja proovi uuesti./);
          assert.equal(await evaluate("!!document.querySelector('[data-storage-state=BLOCKED] button')"), true, 'a retry button is offered');
          await nav('Kalender'); assert.equal(await noSharedControls(), true, 'no shared domain is mounted, and never LEGACY');
          await nav('Buss'); await waitFor("!!document.querySelector('#buss-destination')");
          assert.deepEqual(await legacyBytes(), seededKeys);
          await evaluate("sessionStorage.removeItem('c6Blocked')");
          await evaluate("window.dispatchEvent(new Event('focus'))");
          await waitFor("!document.querySelector('[data-storage-state]')");
          await nav('Kalender'); assert.equal(await evaluate('document.querySelector(\'[aria-label="Lisa sündmus"]\').disabled'), false);
        });
        await t.test('C6 cutover: a malformed authority record shows STORAGE_UNAVAILABLE, never LEGACY, and offers no repair', async () => {
          await resetProfile({ legacy: seededKeys });
          const authority = await evaluate("__idb.get('meta','storageAuthorityV1')");
          await evaluate(`__idb.put('meta',${JSON.stringify({ ...authority, extra: true })})`);
          await send('Page.reload'); await ready();
          assert.equal(await stateOf(), 'STORAGE_UNAVAILABLE');
          await nav('Kalender'); assert.equal(await noSharedControls(), true);
          assert.equal(await evaluate("!!document.querySelector('[data-storage-state] button')"), false, 'authority-malformed offers no retry or repair action');
          assert.deepEqual(await legacyBytes(), seededKeys);
          await evaluate(`__idb.put('meta',${JSON.stringify(authority)})`);
          await send('Page.reload'); await ready();
          assert.equal(await stateOf(), null);
        });
        await t.test('C6 cutover: post-switch legacy divergence shows the non-blocking notice, stays usable and writes nothing', async () => {
          await resetProfile({ legacy: seededKeys });
          const before = { calendar: await snapshotCalendarRecords(), household: await householdRaw(), places: await placesRaw() };
          const edited = JSON.stringify({ version: 1, events: [] });
          await evaluate(`localStorage.setItem('majamajandus_household_events_v1',${JSON.stringify(edited)})`);
          await evaluate("window.dispatchEvent(new StorageEvent('storage',{key:'majamajandus_household_events_v1'}))");
          await waitFor("!!document.querySelector('[data-storage-state=LEGACY_DIVERGED]')");
          assert.match(await body(), /Vana kohalik salvestus on muutunud/);
          assert.equal(await evaluate("!!document.querySelector('[data-storage-state=RELOAD_REQUIRED]')"), false, 'divergence is not a reload');
          await nav('Kalender');
          assert.equal(await evaluate('document.querySelector(\'[aria-label="Lisa sündmus"]\').disabled'), false, 'READY stays writable');
          assert.match(await evaluate("document.querySelector('#selected-events').innerText"), /Iganädalane kohtumine/, 'the IndexedDB data is still shown, never the diverged legacy bytes');
          assert.deepEqual({ calendar: await snapshotCalendarRecords(), household: await householdRaw(), places: await placesRaw() }, before, 'no IndexedDB record changed');
          assert.equal(await evaluate("localStorage.getItem('majamajandus_household_events_v1')"), edited, 'the diverged legacy bytes are neither adopted nor rewritten');
        });
        await t.test('C6 cutover: an authority-changed broadcast keeps a READY tab whose authority is unchanged, and requires a reload once it changed', async () => {
          await resetProfile({ legacy: seededKeys });
          await evaluate("new BroadcastChannel('majandus:replica').postMessage({type:'authority-changed'})");
          await pause(400);
          assert.equal(await stateOf(), null, 'an unchanged authority does not require a reload');
          const authority = await evaluate("__idb.get('meta','storageAuthorityV1')");
          await evaluate(`__idb.put('meta',${JSON.stringify({ ...authority, switchId: 'another-switch' })})`);
          await evaluate("new BroadcastChannel('majandus:replica').postMessage({type:'authority-changed'})");
          await waitFor("!!document.querySelector('[data-storage-state=RELOAD_REQUIRED]')");
          await nav('Kalender'); assert.equal(await evaluate('document.querySelector(\'[aria-label="Lisa sündmus"]\').disabled'), true);
        });
        await t.test('C6 cutover: one invalid domain is non-writable while the other domains stay usable, with no repair', async () => {
          await resetProfile({ legacy: seededKeys });
          const places = await evaluate("__idb.getAll('sharedPlaces')");
          const invalid = { ...places[0], payload: { ...places[0].payload, lat: '59.3' } };
          await evaluate(`__idb.put('sharedPlaces',${JSON.stringify(invalid)})`);
          const before = await placesRaw();
          await send('Page.reload'); await ready();
          await nav('Seaded');
          await evaluate("[...document.querySelectorAll('summary')].find(s=>s.textContent==='Salvestatud kohad').click()");
          assert.match(await body(), /Salvestatud kohti ei saanud lugeda/);
          assert.equal(await evaluate("[...document.querySelectorAll('.mm-place-card .mm-settings-save')].every(b=>b.disabled)"), true);
          assert.equal(await evaluate("document.querySelector('.mm-household-form button').disabled"), false, 'household stays writable');
          await nav('Kalender'); assert.equal(await evaluate('document.querySelector(\'[aria-label="Lisa sündmus"]\').disabled'), false, 'calendar stays writable');
          assert.equal(await placesRaw(), before, 'the invalid domain is never repaired');
          assert.equal(await stateOf(), null, 'overall state stays READY');
        });
      }

      if (mode === 'LEGACY') {
        for (const variant of ['valid', 'malformed', 'unreadable']) {
          await t.test(`C6 cutover: a LEGACY tab refuses a shared save when the hint is ${variant}, writes nothing and requires a reload`, async () => {
            await resetProfile({ legacy: { sade_saved_places: 'not json' } });
            await nav('Kalender'); await click('Lisa sündmus'); await input('#event-title', 'Ei tohi salvestuda');
            const before = await calendarRaw();
            if (variant === 'valid') await evaluate(`localStorage.setItem('${HINT_KEY}',JSON.stringify({version:1,switchId:'other',legacyDigestAtSwitch:'${'a'.repeat(64)}',switchedAt:'${STAMP}'}))`);
            if (variant === 'malformed') await evaluate(`localStorage.setItem('${HINT_KEY}','garbage')`);
            if (variant === 'unreadable') await evaluate("sessionStorage.setItem('c6HintUnreadable','1')");
            await click('Salvesta sündmus');
            await waitFor("!!document.querySelector('[data-storage-state=RELOAD_REQUIRED]')");
            assert.equal(await calendarRaw(), before, 'the shared legacy key is not written');
            assert.match(await body(), /Majandus uuenes teises aknas\. Laadi leht uuesti\./);
            assert.equal(await evaluate("document.querySelector('.mm-save-event').disabled"), true);
            await evaluate("sessionStorage.removeItem('c6HintUnreadable')");
            await click('Tühista');
          });
        }
        await t.test('C6 cutover: an authority-changed broadcast requires a reload in a LEGACY tab', async () => {
          await resetProfile({ legacy: legacyModeSeed });
          assert.equal(await stateOf(), null);
          await evaluate("new BroadcastChannel('majandus:replica').postMessage({type:'authority-changed'})");
          await waitFor("!!document.querySelector('[data-storage-state=RELOAD_REQUIRED]')");
          await nav('Kalender'); assert.equal(await evaluate('document.querySelector(\'[aria-label="Lisa sündmus"]\').disabled'), true);
        });
        await t.test('C6 cutover: LEGACY shows the accepted legacy profile unchanged and never switches authority', async () => {
          await resetProfile({ legacy: legacyModeSeed });
          assert.equal(await stateOf(), null);
          assert.equal(await evaluate("__idb.get('meta','storageAuthorityV1')"), undefined, 'LEGACY never switches authority in this session');
          assert.equal(await evaluate(`localStorage.getItem('${HINT_KEY}')`), null);
          await nav('Kalender');
          assert.match(await body(), /Iganädalane kohtumine/, 'LEGACY shows the accepted legacy calendar unchanged');
        });
      }

      await t.test('C6 cutover: failed household and saved-place saves show the error, claim no success and keep draft and previous state', async () => {
        await resetProfile({ legacy: mode === 'READY' ? seededKeys : legacyModeSeed });
        await nav('Seaded');
        await evaluate("document.querySelector('#household-profile').open=true");
        await input('#household-name', 'Ei salvestu');
        const householdBefore = await householdRaw();
        await failWrites('household');
        try {
          await click('Salvesta majapidamine');
          await waitFor("!!document.querySelector('.mm-household-form [role=alert]')");
          assert.match(await evaluate("document.querySelector('.mm-household-form').innerText"), /Salvestamine ebaõnnestus/);
          assert.doesNotMatch(await body(), /Majapidamine salvestatud/);
          assert.equal(await evaluate("document.querySelector('#household-name').value"), 'Ei salvestu', 'the draft stays');
        } finally { await restoreWrites(); }
        assert.equal(await householdRaw(), householdBefore, 'the previous persisted household is untouched');

        await evaluate("[...document.querySelectorAll('summary')].find(s=>s.textContent==='Salvestatud kohad').click()");
        await input('.mm-place-name', 'Muudetud koht');
        const placesBefore = await placesRaw();
        await failWrites('places');
        try {
          await evaluate("document.querySelector('.mm-place-card .mm-settings-save').click()");
          await waitFor("!!document.querySelector('.mm-place-card [role=alert]')");
          assert.match(await evaluate("document.querySelector('.mm-place-card').innerText"), /Salvestamine ebaõnnestus/);
          assert.doesNotMatch(await evaluate("document.querySelector('.mm-place-card').innerText"), /✓ Salvestatud/, 'no success before the commit');
          assert.equal(await evaluate("document.querySelector('.mm-place-name').value"), 'Muudetud koht', 'the edited value stays');
        } finally { await restoreWrites(); }
        assert.equal(await placesRaw(), placesBefore, 'the previous persisted places are untouched');
        await evaluate("document.querySelector('.mm-place-card .mm-settings-save').click()");
        await waitFor("document.querySelector('.mm-place-card').innerText.includes('✓ Salvestatud')");
        assert.equal((await readSavedPlaces())[0].name, 'Muudetud koht', 'a successful save persists in the active runtime');
      });
    }
    if (process.env.MJM_SCREENSHOTS) {
      await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false});
      for (const label of ['Kodu','Kalender','Veel','Seaded','Buss']) {
        await nav(label);
        await pause(350);
        const shot = await send('Page.captureScreenshot', {format:'png'});
        writeFileSync(join(process.env.MJM_SCREENSHOTS, `${label}.png`), Buffer.from(shot.data,'base64'));
      }
    }
    assert.deepEqual(errors, [], 'No runtime exceptions or React warnings');
  } finally {
    if (send) await send('Browser.close').catch(() => child.kill());
    else child.kill();
    for (let i=0; child.exitCode === null && i<50; i++) await pause(100);
    socket?.close();
    await new Promise(resolve => server.close(resolve));
    assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
    assert.ok(profile.includes('majamajandus-shell-'));
    rmSync(profile, {recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
});

test('StorageStatus renders the accepted copy and actions for every storage state', { timeout: 60000 }, async () => {
  const bundle = await build({ absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic',
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import {renderToStaticMarkup} from 'react-dom/server';
      import {StorageStatus, StorageNotice} from './src/components/StorageStatus.jsx';
      export const status=(state,result)=>renderToStaticMarkup(<StorageStatus state={state} result={result} actions={{retry(){},confirmStorageLost(){},confirmRevertStorageLost(){},reload(){}}} />);
      export const notice=(state,result)=>renderToStaticMarkup(<StorageNotice state={state} result={result} actions={{reload(){}}} />);
    ` } });
  const loaded = { exports: {} };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, createRequire(import.meta.url));
  const { status, notice } = loaded.exports;
  const text = html => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
  const buttons = html => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(match => match[1]);
  const cases = [
    ['AUTHORITY_HINT_PENDING', {}, 'Seadme salvestusruum ei võtnud muudatust vastu. Proovi uuesti.', ['Proovi uuesti']],
    ['BLOCKED', {}, 'Sulge Majanduse teised aknad ja proovi uuesti.', ['Proovi uuesti']],
    ['STORAGE_LOST', { variant: 'dated', switchedAt: '2026-09-16T10:00:00.000Z' }, 'Kohalik andmebaas puudub. Taasta andmed seisuga 2026-09-16T10:00:00.000Z varukoopiast?', ['Taasta andmed']],
    ['STORAGE_LOST', { variant: 'undated' }, 'Taasta andmed seadme varukoopiast?', ['Taasta andmed']],
    ['RELOAD_REQUIRED', {}, 'Majandus uuenes teises aknas. Laadi leht uuesti.', ['Laadi uuesti']],
    ['REVERT_STORAGE_LOST', { variant: 'dated', switchedAt: '2026-09-16T10:00:00.000Z' }, 'Kohalik andmebaas puudub. Kas kasutada vana salvestust seisuga 2026-09-16T10:00:00.000Z? Hilisemad muudatused võivad puududa.', ['Kasuta vana salvestust']],
    ['REVERT_STORAGE_LOST', { variant: 'undated' }, 'Kohalik andmebaas puudub. Kas kasutada seadme vana salvestust? Hilisemad muudatused võivad puududa.', ['Kasuta vana salvestust']],
    ['REVERT_FAILED', { reason: 'revert-backups-lost' }, 'Taastamine vanale salvestusele ebaõnnestus. Andmed on alles. Proovi uuesti.', ['Proovi uuesti']],
    ['STORAGE_UNAVAILABLE', { reason: 'open-or-read-failed' }, 'Seadme salvestusruumi ei saanud lugeda. Proovi uuesti.', ['Proovi uuesti']],
    ['STORAGE_UNAVAILABLE', { reason: 'authority-malformed' }, 'Seadme salvestuse andmeid ei saanud lugeda. Andmeid ei muudeta.', []],
  ];
  for (const [state, result, copy, actions] of cases) {
    const html = status(state, result);
    if (copy) assert.ok(text(html).includes(copy), `${state} ${result.variant ?? result.reason ?? ''}: exact copy`);
    assert.deepEqual(buttons(html), actions, `${state} ${result.variant ?? result.reason ?? ''}: exactly these actions`);
  }
  for (const state of ['BOOTING', 'REVERTING']) assert.ok(!buttons(status(state, {})).length && text(status(state, {})).includes('Laen andmeid'), `${state} is a minimal splash`);
  assert.equal(notice('READY', {}), '', 'no notice in the normal READY state');
  assert.ok(text(notice('READY', { divergence: 'LEGACY_DIVERGED' })).includes('Vana kohalik salvestus on muutunud'), 'LEGACY_DIVERGED is a non-blocking notice');
  assert.deepEqual(buttons(notice('READY', { divergence: 'LEGACY_DIVERGED' })), [], 'the divergence notice offers no repair, merge or reset action');
  assert.ok(text(notice('RELOAD_REQUIRED', {})).includes('Majandus uuenes teises aknas. Laadi leht uuesti.'));
});

test('PWA and HTML identity use Majamajandus without downloaded fonts', () => {
  const read = path => readFileSync(join(root,path),'utf8');
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.name,'Majandus');
  assert.equal(manifest.short_name,'Majandus');
  assert.equal(manifest.theme_color,'#1A5B69');
  assert.equal(manifest.background_color,'#F4F2EE');
  assert.match(read('index.html'), /<title>Majandus<\/title>/);
  assert.match(read('index.html'), /name="apple-mobile-web-app-title" content="Majandus"/);
  assert.doesNotMatch(read('index.html'), /fonts.googleapis|Fraunces|AnniVibe/);
  assert.match(read('vite.config.js'), /\bname: 'Majandus'/);
  assert.match(read('vite.config.js'), /\bshort_name: 'Majandus'/);
  assert.match(read('public/favicon.svg'), /aria-label="Majandus"/);
  for (const [path,size] of [['public/icons/icon-192.png',192],['public/icons/icon-512.png',512],['public/apple-touch-icon.png',180]]) {
    const png = readFileSync(join(root,path));
    assert.equal(png.readUInt32BE(16),size);
    assert.equal(png.readUInt32BE(20),size);
  }
});
