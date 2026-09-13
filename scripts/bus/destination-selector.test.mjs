import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFrameGate, installFrameTrace, waitForBrowserEndpoint } from './browser-lifecycle.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = process.env.BUS_TEST_SOURCE_ROOT || root;
const traceLifecycle = process.env.DEBUG01_TRACE === '1';
let phase = {};
const browser = [process.env.BUS_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(path => path && existsSync(path));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const OIE = ['Haigla', 'Keskuse', 'Lai', 'Lilleoru', 'Pauluse kalmistu', 'Saueaugu',
  'Tammiku', 'Tarva', 'Tulika', 'Tõrma kalmistu', 'Vallimäe', 'Viru', 'Ööbiku'];

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  const actions = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push({ phase: { ...phase }, actions: [...actions], ...message.params.exceptionDetails });
    if (message.method === 'Runtime.bindingCalled' && message.params.name === '__debug01Report') {
      process.stdout.write('DEBUG01_ERROR ' + JSON.stringify({ phase, actions, evidence: JSON.parse(message.params.payload) }) + '\n');
    }
    if (message.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(message.params.type)) {
      errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  return {
    socket, errors,
    send(method, params = {}) {
      if (method === 'Runtime.evaluate' || method.startsWith('Input.') || method === 'Page.navigate' || method === 'Browser.close') {
        actions.push({ method, expression: params.expression || params.type || params.url || '' });
        if (actions.length > 6) actions.shift();
      }
      return new Promise((resolve, reject) => {
        const key = ++id;
        const timer = setTimeout(() => {
          pending.delete(key);
          reject(new Error(`CDP timeout: ${method}`));
        }, 15000);
        pending.set(key, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: key, method, params }));
      });
    },
  };
}

test('BussTab reachable destination integration in Chromium', {
  skip: browser ? false : 'Set BUS_TEST_BROWSER to a Chromium executable to run UI integration',
  timeout: 120000,
}, async t => {
  const subtest = t.test.bind(t);
  t.test = (name, body) => subtest(name, async context => {
    phase = { test: name, stage: 'actions/assertions running' };
    await body(context);
    phase = { test: name, stage: 'assertions passed' };
  });
  // React, routing and Leaflet are real; DEBUG01 also controls the frame boundary.
  const bundle = await build({
    absWorkingDir: root, bundle: true, write: false, outfile: 'ui01.js',
    nodePaths: [join(root, 'node_modules')],
    jsx: 'automatic', loader: { '.png': 'dataurl' },
    stdin: { resolveDir: root, contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {BussTab} from ${JSON.stringify(join(sourceRoot, 'src/components/BussTab.jsx'))};
      import {GTFS_STOP_COORDS_BY_ID} from ${JSON.stringify(join(sourceRoot, 'src/data/gtfsStopCoords.js'))};
      ${traceLifecycle ? `import L from 'leaflet'; import {installLeafletTrace} from './scripts/bus/browser-lifecycle.mjs'; installLeafletTrace(L);` : ''}
      window.stopCoords = GTFS_STOP_COORDS_BY_ID;
      const root = createRoot(document.getElementById('root'));
      window.unmountBussTab = () => root.unmount();
      root.render(React.createElement(BussTab));
    ` },
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const server = createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<style>${css}</style><div id="root"></div><script>
      ${traceLifecycle ? `(${installFrameTrace.toString()})();` : ''}
      (${installFrameGate.toString()})();
      const NativeDate = Date;
      const day = new URLSearchParams(location.search).get('day') || '14';
      const hour = new URLSearchParams(location.search).get('hour') || '6';
      window.testNow = new NativeDate(2026, 8, Number(day), Number(hour), 0, 0).getTime();
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [window.testNow])); }
        static now() { return new Date().getTime(); }
      };
      const nativeInterval = window.setInterval;
      window.setInterval = (callback, delay, ...args) => {
        if (delay === 60000) window.nearbyTick = callback;
        return nativeInterval(callback, delay, ...args);
      };
      Object.defineProperty(navigator, 'geolocation', {value: {
        getCurrentPosition(success, error) { window.gpsSuccess = success; window.gpsDenied = error; }
      }});
    </script><script src="/app.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = mkdtempSync(join(tmpdir(), 'annivibe-ui01-'));
  const child = spawn(browser, ['--headless=new', '--no-first-run', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let cdp;
  try {
    const port = new URL(await waitForBrowserEndpoint(child)).port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    cdp = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    if (traceLifecycle) await cdp.send('Runtime.addBinding', {name: '__debug01Report'});
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*://*.tile.openstreetmap.org/*'] });
    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(expression)) return;
        await pause(30);
      }
      assert.fail(`UI condition not met: ${expression}`);
    };
    const open = async (day = '14', hour = '6') => {
      await cdp.send('Page.navigate', { url: `${base}/?day=${day}&hour=${hour}` });
      await waitFor(`location.search === '?day=${day}&hour=${hour}' && !!document.querySelector('#buss-destination')`);
    };
    const click = async label => {
      await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(label)})).click()`);
      await pause(60);
    };
    const select = async (selector, value) => {
      await evaluate(`(() => {const s = document.querySelector(${JSON.stringify(selector)});
        s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', {bubbles:true}));})()`);
      await pause(60);
    };
    const options = () => evaluate(`[...document.querySelector('#buss-destination').options].filter(o => o.value).map(o => o.text)`);
    const origin = async name => {
      if (!await evaluate(`!!document.querySelector('select:not(#buss-destination)')`)) await click('Muuda lähtekoht');
      await select('select:not(#buss-destination)', name);
    };
    const rows = () => evaluate(`[...document.querySelectorAll('div')].filter(e => e.children.length === 0 && e.textContent.startsWith('Välju peatuses:')).map(e => e.textContent)`);
    // Inspect committed React props as well as DOM text: stop IDs need not be visible UI copy.
    const cards = () => evaluate(`[...document.querySelectorAll('div')]
      .filter(e => !e.children.length && e.textContent.startsWith('Välju peatuses:')).map(e => {
        let fiber = e[Object.keys(e).find(key => key.startsWith('__reactFiber$'))];
        while (fiber && !fiber.memoizedProps?.d) fiber = fiber.return;
        return {model:fiber?.memoizedProps.d, text:fiber?.child.stateNode.textContent};
      })`);

    await t.test('DEBUG01 pending canvas redraw is cancelled on map confirmation/unmount', async () => {
      await open('14', '7');
      await click('Näita busse minu lähedal');
      await evaluate(`(() => {const s = window.stopCoords['5901010-1']; window.gpsSuccess({coords:{latitude:s.lat,longitude:s.lon}});})()`);
      await waitFor(`document.querySelector('[aria-live]').textContent.includes('Sinu lähim peatus')`);
      await click('Vali sihtkoht kaardilt');
      await waitFor(`!!document.querySelector('.leaflet-container')`);
      await evaluate('window.frameGate.held = true');
      const point = await evaluate(`(() => {const r = document.querySelector('.leaflet-container').getBoundingClientRect();
        return {x:r.x+r.width/2, y:r.y+r.height/2};})()`);
      await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left', clickCount:1});
      await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'left', clickCount:1});
      await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Kasuta seda sihtkohta') && !b.disabled)`);
      assert.ok(await evaluate('window.frameGate.pending() > 0'), 'Exercise pending animation work, not an already idle map');
      await click('Kasuta seda sihtkohta');
      await waitFor(`!document.querySelector('.leaflet-container')`);
      await evaluate('window.frameGate.release()');
      assert.deepEqual(cdp.errors, [], 'No queued canvas redraw may run against a destroyed context');
      assert.equal(await evaluate('window.frameGate.pending()'), 0);
      assert.ok((await rows()).length > 0, 'Map confirmation still produces routes');
    });

    for (const [name, board, departure, alight, arrival] of [
      ['Haigla', '5901010-1', '07:22', '5900078-1', '07:35'],
      ['Tammiku', '5901011-1', '07:05', '5900777-1', '07:08'],
      ['Tõrma kalmistu', '5901011-1', '07:05', '5900822-1', '07:11'],
    ]) {
      await t.test(`UI02 Oie to ${name}: exact boarding/alighting IDs, departure and arrival`, async () => {
        await open('14', '7');
        await origin('Õie');
        await select('#buss-destination', name);
        const result = await cards();
        assert.ok(result.length > 0 && result.length <= 3);
        const {model, text} = result[0];
        assert.deepEqual([model.boardStopId, model.departure, model.alightStopId, model.arrival, model.destinationName],
          [board, departure, alight, arrival, name]);
        assert.ok(text.includes('Mine peatusesse: Õie'));
        assert.ok(text.includes('Väljub: ' + departure));
        assert.ok(text.includes('Välju peatuses: ' + name));
        assert.ok(text.includes('Kohal: ' + arrival));
        assert.deepEqual(result.map(r => r.model.arrival), result.map(r => r.model.arrival).sort());
        if (name === 'Tõrma kalmistu') {
          assert.deepEqual([result[1].model.departure, result[1].model.arrival], ['07:22', '07:43']);
        }
        assert.deepEqual(await options(), OIE);
      });
    }
    await t.test('UI02 line 2 return card uses exact Piira identity and arrival', async () => {
      await open('14', '7');
      await origin('Lihakombinaat');
      await select('#buss-destination', 'Piira');
      const result = await cards();
      assert.deepEqual([result[0].model.line, result[0].model.boardStopId, result[0].model.departure,
        result[0].model.alightStopId, result[0].model.arrival], ['2', '5900659-1', '07:20', '5900565-1', '07:40']);
      assert.ok(result[0].text.includes('Kohal: 07:40'));
    });
    await t.test('UI02 fresh query time after idle excludes expired trips and keeps truthful empty state', async () => {
      await open('14', '7');
      await origin('Õie');
      await evaluate('window.testNow += 23 * 60000');
      await select('#buss-destination', 'Haigla');
      assert.equal((await cards())[0].model.departure, '08:18');
      await evaluate('window.testNow += (16 * 60 + 36) * 60000');
      await select('#buss-destination', 'Tammiku');
      assert.deepEqual(await rows(), []);
      assert.ok(await evaluate(`document.body.textContent.includes('Täna enam busse pole')`));
    });
    await t.test('UI02 G1: map-selected Oie label cannot override the reachable alight stop', async () => {
      await open('14', '7');
      await click('Näita busse minu lähedal');
      await evaluate(`(() => {const s = window.stopCoords['5901010-1']; window.gpsSuccess({coords:{latitude:s.lat,longitude:s.lon}});})()`);
      await waitFor(`document.querySelector('[aria-live]').textContent.includes('Sinu lähim peatus')`);
      const nearby = await evaluate(`document.querySelector('[aria-live]').textContent`);
      await click('Vali sihtkoht kaardilt');
      await waitFor(`!!document.querySelector('.leaflet-container')`);
      await pause(100);
      const point = await evaluate(`(() => {const r = document.querySelector('.leaflet-container').getBoundingClientRect();
        return {x:r.x+r.width/2, y:r.y+r.height/2};})()`);
      await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left', clickCount:1});
      await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'left', clickCount:1});
      await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Kasuta seda sihtkohta') && !b.disabled)`);
      await click('Kasuta seda sihtkohta');
      assert.ok(await evaluate(`document.body.textContent.includes('Valitud sihtkoht: Õie')`));
      const result = await cards();
      assert.ok(result.length > 0);
      assert.ok(result.every(r => r.model.destinationName !== 'Õie'));
      for (const {model, text} of result) {
        const actualName = await evaluate(`window.stopCoords[${JSON.stringify(model.alightStopId)}].stopName`);
        assert.equal(model.destinationName, actualName);
        assert.ok(text.includes('Välju peatuses: ' + actualName));
        assert.ok(text.includes('Kohal: ' + model.arrival));
      }
      assert.equal(await evaluate(`document.querySelector('[aria-live]').textContent`), nearby);
    });
    await t.test('UI02 map target with no structural route keeps the direct-connection empty state', async () => {
      await open('20', '7');
      await origin('Lihakombinaat');
      await click('Vali sihtkoht kaardilt');
      await waitFor(`!!document.querySelector('.leaflet-container')`);
      await pause(100);
      const point = await evaluate(`(() => {const r = document.querySelector('.leaflet-container').getBoundingClientRect();
        return {x:r.x+r.width/2, y:r.y+r.height/2};})()`);
      await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left', clickCount:1});
      await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'left', clickCount:1});
      await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Kasuta seda sihtkohta') && !b.disabled)`);
      await click('Kasuta seda sihtkohta');
      assert.deepEqual(await rows(), []);
      assert.ok(await evaluate(`document.body.textContent.includes('Valitud suunal ei leitud praegu sobivat otseliini.')`));
    });
    await t.test('UI02 existing nearby timer refresh cannot retain expired route rows', async () => {
      await open('14', '7');
      await click('Näita busse minu lähedal');
      await evaluate(`(() => {const s = window.stopCoords['5901010-1']; window.gpsSuccess({coords:{latitude:s.lat,longitude:s.lon}});})()`);
      await waitFor(`typeof window.nearbyTick === 'function'`);
      await select('#buss-destination', 'Haigla');
      assert.equal((await cards())[0].model.departure, '07:22');
      await evaluate(`window.expiredSeen = false;
        window.expiryObserver = new MutationObserver(() => {
          if ([...document.querySelectorAll('div')].some(e => !e.children.length && e.textContent === 'Väljub: 07:22')) window.expiredSeen = true;
        });
        window.expiryObserver.observe(document.getElementById('root'), {childList:true, subtree:true, characterData:true});
        window.testNow += 23 * 60000; window.nearbyTick();`);
      await waitFor(`[...document.querySelectorAll('div')].some(e => !e.children.length && e.textContent === 'Väljub: 08:18')`);
      assert.equal((await cards())[0].model.departure, '08:18');
      assert.equal(await evaluate('window.expiredSeen'), false);
      await evaluate('window.expiryObserver.disconnect()');
    });

    for (const [service, day] of [['E-R', '14'], ['L', '19'], ['P', '20']]) {
      await t.test(`Õie ${service}: exactly 13 alphabetic destinations, not nearby groups`, async () => {
        await open(day);
        await origin('Õie');
        assert.deepEqual(await options(), OIE);
      });
    }
    await t.test('Kivi includes both concrete boarding sides, without duplicate names', async () => {
      await open();
      await origin('Kivi');
      const names = await options();
      assert.equal(names.length, 13);
      assert.ok(names.includes('Rägavere tee'));
      assert.ok(names.includes('Põhjakeskus'));
      assert.equal(new Set(names).size, names.length);
      assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'et')));
    });
    await t.test('Line 2 has no destination options on L/P', async () => {
      for (const day of ['19', '20']) {
        await open(day);
        await origin('Lihakombinaat');
        assert.deepEqual(await options(), []);
      }
    });
    await t.test('Origin changes clear unreachable selections and rows; no-origin fallback remains', async () => {
      await open();
      assert.equal((await options()).length, 49);
      await origin('Kivi');
      await select('#buss-destination', 'Põhjakeskus');
      assert.ok((await rows()).length > 0, 'real route rows must exist before invalidation');
      await evaluate(`window.routeMutations = []; window.routeObserver = new MutationObserver(() => {
        window.routeMutations.push([...document.querySelectorAll('div')]
          .filter(e => !e.children.length && e.textContent.startsWith('Välju peatuses:')).map(e => e.textContent));
      }); window.routeObserver.observe(document.getElementById('root'), {childList:true, subtree:true, characterData:true});`);
      await origin('Õie');
      assert.deepEqual(await options(), OIE);
      assert.equal(await evaluate(`document.querySelector('#buss-destination').value`), '');
      assert.deepEqual(await rows(), []);
      assert.ok(await evaluate(`window.routeMutations.length > 0 && window.routeMutations.every(rows => rows.length === 0)`),
        'No old destination row may be published during origin-change DOM mutations');
      await evaluate('window.routeObserver.disconnect()');
      await select('#buss-destination', 'Vallimäe');
      assert.ok((await rows()).every(row => row === 'Välju peatuses: Vallimäe'));
      assert.ok((await rows()).length > 0);
      await origin('');
      assert.equal((await options()).length, 49);
      assert.deepEqual(await rows(), []);
      await origin('Kivi');
      assert.equal(await evaluate(`document.querySelector('#buss-destination').value`), '');
    });
    await t.test('A still-reachable selection survives origin changes with fresh route rows', async () => {
      await open();
      await origin('Õie');
      await select('#buss-destination', 'Vallimäe');
      assert.ok((await rows()).length > 0);
      await origin('Tulika');
      assert.equal(await evaluate(`document.querySelector('#buss-destination').value`), 'Vallimäe');
      assert.ok((await rows()).length > 0);
      assert.ok(await evaluate(`[...document.querySelectorAll('div')].filter(e => !e.children.length && e.textContent.startsWith('Mine peatusesse:')).every(e => e.textContent === 'Mine peatusesse: Tulika')`));
      for (const next of ['Kivi', 'Õie', 'Kivi', 'Õie']) {
        await origin(next);
        assert.equal(await evaluate(`document.querySelector('#buss-destination').value`), '');
        assert.deepEqual(await rows(), []);
      }
    });
    await t.test('Map confirmation still routes, then dropdown selection replaces map destination', async () => {
      await open();
      await origin('Kivi');
      await click('Vali sihtkoht kaardilt');
      await waitFor(`!!document.querySelector('.leaflet-container')`);
      await pause(100);
      const point = await evaluate(`(() => {const r = document.querySelector('.leaflet-container').getBoundingClientRect();
        return {x:r.x+r.width/2, y:r.y+r.height/2};})()`);
      await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left', clickCount:1});
      await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'left', clickCount:1});
      await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Kasuta seda sihtkohta') && !b.disabled)`);
      await click('Kasuta seda sihtkohta');
      assert.equal(await evaluate(`!!document.querySelector('[role=dialog]')`), false);
      assert.ok((await rows()).length > 0, 'confirmed map destination reaches the real route engine');
      await select('#buss-destination', 'Põhjakeskus');
      assert.ok((await rows()).length > 0);
      assert.ok((await rows()).every(row => row === 'Välju peatuses: Põhjakeskus'));
      await select('#buss-destination', '');
      assert.deepEqual(await rows(), []);
    });
    await t.test('Denied GPS retains the no-origin fallback', async () => {
      await open();
      await click('Näita busse minu lähedal');
      await evaluate('window.gpsDenied()');
      await waitFor(`document.querySelector('[aria-live]').textContent.includes('Asukohta ei saanud kasutada')`);
      assert.equal((await options()).length, 49);
      assert.deepEqual(await rows(), []);
    });
    await t.test('GPS siblings filter correctly; manual origin does not alter nearby departures; map opens', async () => {
      await open();
      await click('Näita busse minu lähedal');
      await evaluate(`(() => {const s = window.stopCoords['5901010-1']; window.gpsSuccess({coords:{latitude:s.lat,longitude:s.lon}});})()`);
      await waitFor(`document.querySelector('[aria-live]').textContent.includes('Sinu lähim peatus')`);
      assert.deepEqual(await options(), OIE);
      const nearby = await evaluate(`document.querySelector('[aria-live]').textContent`);
      await origin('Kivi');
      assert.equal(await evaluate(`document.querySelector('[aria-live]').textContent`), nearby);
      await click('Vali sihtkoht kaardilt');
      await waitFor(`!!document.querySelector('.leaflet-container')`);
      assert.ok(await evaluate(`!!document.querySelector('[role=dialog]')`));
    });
    await t.test('DEBUG01 map close/reopen, origin change, route canvas and navigation cleanup', async () => {
      await open('14', '7');
      await origin('Õie');
      const openMap = async () => {
        await click('Vali sihtkoht kaardilt');
        await waitFor(`!!document.querySelector('.leaflet-container canvas')`);
        await evaluate('window.frameGate.release()');
      };
      const pickMap = async () => {
        const point = await evaluate(`(() => {const r = document.querySelector('.leaflet-container').getBoundingClientRect();
          return {x:r.x+r.width/2, y:r.y+r.height/2};})()`);
        await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left', clickCount:1});
        await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'left', clickCount:1});
        await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Kasuta seda sihtkohta') && !b.disabled)`);
      };
      await openMap();
      await evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Sulge').click()`);
      await waitFor(`!document.querySelector('.leaflet-container')`);
      await evaluate('window.frameGate.release()');
      assert.deepEqual(cdp.errors, [], 'Closing without selection must complete map cleanup');
      await openMap();
      await pickMap();
      await click('Kasuta seda sihtkohta');
      await waitFor(`!document.querySelector('.leaflet-container')`);
      assert.ok((await rows()).length > 0);
      await origin('Kivi');
      await openMap();
      await evaluate(`document.querySelector('[aria-label=Liinifilter] button:nth-child(2)').click()`);
      await waitFor(`!!document.querySelector('.leaflet-routeShape-pane canvas')`);
      await evaluate('window.frameGate.release()');
      assert.ok(await evaluate(`[...document.querySelectorAll('.leaflet-container canvas')].every(canvas =>
        canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0))`),
      'Both stop and route canvases must still draw, not merely avoid exceptions');
      await evaluate('window.frameGate.held = true');
      await pickMap();
      assert.ok(await evaluate('window.frameGate.pending() > 0'));
      await evaluate('window.unmountBussTab()');
      await waitFor(`document.getElementById('root').children.length === 0`);
      await evaluate('window.frameGate.release()');
      assert.equal(await evaluate('window.frameGate.pending()'), 0);
      assert.deepEqual(cdp.errors, [], 'Full React unmount must cancel pending map work before navigation');
      await cdp.send('Page.navigate', {url: 'about:blank'});
      await waitFor(`location.href === 'about:blank'`);
      assert.deepEqual(cdp.errors, [], 'Navigation must not publish a delayed map exception');
    });
    assert.deepEqual(cdp.errors, [], 'No React duplicate-key warnings or runtime exceptions');
  } finally {
    phase = { ...phase, stage: 'browser/test cleanup' };
    if (cdp) await cdp.send('Browser.close').catch(() => child.kill());
    else child.kill();
    for (let attempt = 0; child.exitCode === null && attempt < 50; attempt++) await pause(100);
    cdp?.socket.close();
    await new Promise(resolve => server.close(resolve));
    await pause(300);
    // Delete only the unique profile created by this test under the OS temp directory.
    assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
    assert.ok(profile.includes('annivibe-ui01-'));
    rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
