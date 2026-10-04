import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForBrowserEndpoint } from '../bus/browser-lifecycle.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function withShoppingBrowser(run) {
  const executable = [process.env.BUS_TEST_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
  assert.ok(executable, 'Chromium is required; shopping UI tests never silently skip');
  const bundle = await build({ absWorkingDir: root, bundle: true, write: false, outfile: 'shopping-ui.js',
    jsx: 'automatic', loader: { '.png': 'dataurl' }, define: { 'import.meta.env': '{}' },
    entryPoints: ['scripts/shopping/ui-fixture.jsx'] });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const server = createServer((request, response) => {
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = mkdtempSync(join(tmpdir(), 'shopping-ui-'));
  const captureDir = process.env.SHOPPING_UI_SCREENSHOTS === '1' ? mkdtempSync(join(tmpdir(), 'shopping-ui-captures-')) : null;
  const child = spawn(executable, ['--headless=new', '--no-first-run', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let socket;
  let send;
  const pending = new Map();
  try {
    const port = new URL(await waitForBrowserEndpoint(child)).port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let id = 0;
    const errors = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
        errors.push(message.params.args.map(argument => argument.value ?? argument.description).join(' '));
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result);
    });
    send = (method, params = {}) => new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(Error(`${method} timed out`)); }, 10000);
      pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let attempt = 0; attempt < 100; attempt += 1) { if (await evaluate(expression)) return; await pause(30); }
      assert.fail(`Condition not met: ${expression}`);
    };
    const click = async (label, within = 'document') => {
      await evaluate(`(() => { const button=[...${within}.querySelectorAll('button')].find(button => button.textContent.trim()===${JSON.stringify(label)} || button.getAttribute('aria-label')===${JSON.stringify(label)}); if(!button) throw Error('Button missing: '+${JSON.stringify(label)}); if(button.disabled) throw Error('Button disabled: '+${JSON.stringify(label)}); button.click(); })()`);
      await pause(60);
    };
    const input = async (selector, value) => {
      await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)});
        const prototype=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,${JSON.stringify(value)});
        element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true})); })()`);
      await pause(30);
    };
    const shot = async name => {
      if (!captureDir) return;
      assert.match(name, /^[a-z0-9-]+$/);
      await pause(650);
      const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const path = join(captureDir, `${name}.png`);
      writeFileSync(path, Buffer.from(capture.data, 'base64'));
      console.log(`Shopping UI screenshot: ${path}`);
    };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*://*.tile.openstreetmap.org/*', '*://fonts.googleapis.com/*'] });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await waitFor("!!document.querySelector('#shopping-quick-name')");
    await run({ send, evaluate, waitFor, click, input, body: () => evaluate('document.body.innerText'), pause, shot });
    assert.deepEqual(errors, [], 'Production shopping UI must not emit browser errors');
  } finally {
    const stopped = child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    if (send && socket?.readyState === WebSocket.OPEN && child.exitCode === null) {
      await Promise.race([send('Browser.close').catch(() => undefined), pause(2000)]);
      await Promise.race([stopped, pause(2000)]);
    }
    if (socket) socket.close();
    if (child.exitCode === null) { child.kill(); await Promise.race([stopped, pause(3000)]); }
    for (const request of pending.values()) clearTimeout(request.timer);
    await new Promise(resolve => server.close(resolve));
    assert.equal(dirname(resolve(profile)), resolve(tmpdir()), 'Chromium cleanup remains inside the temporary directory');
    assert.ok(basename(profile).startsWith('shopping-ui-'), 'Chromium cleanup targets this fixture profile');
    rmSync(profile, { recursive: true, force: true, maxRetries: 15, retryDelay: 150 });
  }
}
