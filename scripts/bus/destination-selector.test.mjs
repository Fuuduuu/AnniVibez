import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
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
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
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
  // Only the clock and device location are controlled; React, routing and map are real.
  const bundle = await build({
    absWorkingDir: root, bundle: true, write: false, outfile: 'ui01.js',
    jsx: 'automatic', loader: { '.png': 'dataurl' },
    stdin: { resolveDir: root, contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {BussTab} from './src/components/BussTab.jsx';
      import {GTFS_STOP_COORDS_BY_ID} from './src/data/gtfsStopCoords.js';
      window.stopCoords = GTFS_STOP_COORDS_BY_ID;
      createRoot(document.getElementById('root')).render(React.createElement(BussTab));
    ` },
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const server = createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<style>${css}</style><div id="root"></div><script>
      const NativeDate = Date;
      const day = new URLSearchParams(location.search).get('day') || '14';
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [2026, 8, Number(day), 6, 0, 0])); }
        static now() { return new Date().getTime(); }
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
  { stdio: 'ignore', windowsHide: true });
  let cdp;
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let attempt = 0; !existsSync(portFile) && attempt < 100; attempt++) await pause(100);
    assert.ok(existsSync(portFile), 'Chromium must start its debugging endpoint');
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    cdp = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
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
    const open = async (day = '14') => {
      await cdp.send('Page.navigate', { url: `${base}/?day=${day}` });
      await waitFor(`location.search === '?day=${day}' && !!document.querySelector('#buss-destination')`);
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
    assert.deepEqual(cdp.errors, [], 'No React duplicate-key warnings or runtime exceptions');
  } finally {
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
