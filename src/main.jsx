import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { createStorageRuntime } from './App';
import { createStorageAuthorityController } from './storage/storageAuthority.js';

// Runtime wiring boundary (runtime cutover C6): the only place browser capabilities are read. The storage
// modules receive them by injection; the controller owns every authority decision.
const attempt = read => { try { return read(); } catch { return undefined; } };

// An inaccessible localStorage must never look like "no hint": every read throws, which the controller
// classifies as unknown authority (never LEGACY).
const blockedStorage = { getItem() { throw new Error('localStorage is unavailable'); }, setItem() { throw new Error('localStorage is unavailable'); }, removeItem() { throw new Error('localStorage is unavailable'); } };

function createBrowserRuntime() {
  const storage = attempt(() => window.localStorage) ?? blockedStorage;
  const channel = attempt(() => (typeof BroadcastChannel === 'function' ? new BroadcastChannel('majandus:replica') : null)) ?? null;
  const newId = () => crypto.randomUUID();
  const clock = () => new Date().toISOString();
  const persistApi = attempt(() => navigator.storage);
  const controller = createStorageAuthorityController({
    indexedDb: attempt(() => window.indexedDB),
    storage,
    locks: attempt(() => navigator.locks),
    broadcast: channel,
    persist: typeof persistApi?.persist === 'function' ? () => persistApi.persist() : undefined,
    cryptoApi: crypto,
    clock,
    newId,
    // Forward is the default; only an explicit revert build selects the revert flow.
    mode: import.meta.env.VITE_STORAGE_AUTHORITY_MODE === 'revert' ? 'revert' : 'forward',
  });
  return createStorageRuntime({
    controller, storage, windowTarget: window, documentTarget: document, channel, newId, clock,
    reload: () => window.location.reload(),
  });
}

// One page-lifetime runtime: created, wired and booted once, outside the React tree, so StrictMode's
// repeated renders and effects never create a second controller, boot or channel.
const runtime = createBrowserRuntime();
runtime.start();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App runtime={runtime} />
  </React.StrictMode>
);
