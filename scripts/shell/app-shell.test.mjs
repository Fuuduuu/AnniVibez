import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForBrowserEndpoint } from '../bus/browser-lifecycle.mjs';
import { runCalendarChecks } from '../calendar/browser-cases.mjs';
import { runWasteChecks } from '../waste/browser-cases.mjs';
import { runReminderChecks } from '../reminders/browser-cases.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const browser = [process.env.BUS_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(path => path && existsSync(path));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('Majamajandus shell in Chromium', { timeout: 120000 }, async t => {
  assert.ok(browser, 'Chromium is required; shell checks must not silently skip');
  const bundle = await build({
    absWorkingDir: root, bundle: true, write: false, outfile: 'shell.js', metafile: true,
    jsx: 'automatic', loader: { '.png': 'dataurl' },
    define: { 'import.meta.env': '{}' },
    stdin: { resolveDir: root, contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import App from './src/App.jsx';
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
      createRoot(document.getElementById('root')).render(<React.StrictMode><App wasteLookup={wasteLookup} notificationService={notificationService} /></React.StrictMode>);
    `, loader: 'jsx' },
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
        sessionStorage.seeded = 'yes';
      }
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
      await evaluate(`[...${within}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
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
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setBlockedURLs', {urls:['*://*.tile.openstreetmap.org/*','*://fonts.googleapis.com/*']});
    await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate', {url:`http://127.0.0.1:${server.address().port}`});
    await waitFor("!!document.querySelector('nav')");
    const initialStorage = await storage();

    await t.test('five primary destinations, identity and truthful Home hierarchy', async () => {
      assert.deepEqual(await evaluate("[...document.querySelectorAll('nav button')].map(b=>b.textContent.trim())"),
        ['Kodu','Kalender','Buss','Veel','Seaded']);
      const text = await body();
      for (const label of ['Majamajandus','Tulemas','Buss praegu','Kiirtoimingud']) assert.ok(text.toLocaleLowerCase('et').includes(label.toLocaleLowerCase('et')), label);
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
    if (process.env.CALENDAR_TESTS === '1') {
      await runCalendarChecks({t,nav,click,input,evaluate,waitFor,body,send});
    }
    if (process.env.WASTE_TESTS === '1') {
      await runWasteChecks({t,nav,click,input,evaluate,waitFor,body,send});
    }
    if (process.env.REMINDER_TESTS === '1') {
      await runReminderChecks({t,nav,click,input,evaluate,waitFor,body,send});
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

test('PWA and HTML identity use Majamajandus without downloaded fonts', () => {
  const read = path => readFileSync(join(root,path),'utf8');
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.name,'Majamajandus');
  assert.equal(manifest.theme_color,'#1A5B69');
  assert.equal(manifest.background_color,'#F4F2EE');
  assert.match(read('index.html'), /<title>Majamajandus<\/title>/);
  assert.doesNotMatch(read('index.html'), /fonts.googleapis|Fraunces|AnniVibe/);
  assert.match(read('vite.config.js'), /name: 'Majamajandus'/);
  assert.match(read('public/favicon.svg'), /aria-label="Majamajandus"/);
  for (const [path,size] of [['public/icons/icon-192.png',192],['public/icons/icon-512.png',512],['public/apple-touch-icon.png',180]]) {
    const png = readFileSync(join(root,path));
    assert.equal(png.readUInt32BE(16),size);
    assert.equal(png.readUInt32BE(20),size);
  }
});
