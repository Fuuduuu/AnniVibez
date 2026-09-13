// Test-only instrumentation. Exceptions are reported and rethrown, never suppressed.
export function installFrameTrace() {
  window.__leafletTrace = [];
  const request = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => {
    const scheduledAt = new Error('Animation frame scheduled').stack;
    return request(timestamp => {
      try { return callback(timestamp); }
      catch (error) {
        window.__debug01Report?.(JSON.stringify({ scheduledAt, stack: error.stack, trace: window.__leafletTrace }));
        throw error;
      }
    });
  };
}

export function installLeafletTrace(L) {
  const record = (renderer, method) => {
    window.__leafletTrace.push({ method, id: renderer._leaflet_id,
      context: !!renderer._ctx, map: !!renderer._map, request: renderer._redrawRequest,
      stack: new Error(method).stack });
    if (window.__leafletTrace.length > 25) window.__leafletTrace.shift();
  };
  for (const method of ['_destroyContainer', '_redraw', '_requestRedraw']) {
    const original = L.Canvas.prototype[method];
    L.Canvas.prototype[method] = function (...args) {
      if (method !== '_requestRedraw' || (this._map && !this._redrawRequest)) record(this, method);
      return original.apply(this, args);
    };
  }
  const remove = L.Map.prototype.remove;
  L.Map.prototype.remove = function (...args) {
    record(this, 'map.remove');
    return remove.apply(this, args);
  };
}
// Hold frames at the redraw/unmount boundary; release through the real browser
// scheduler. Cancellation still works before and after a held frame is released.
export function installFrameGate() {
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  const pending = new Map();
  let nextId = -1;
  window.frameGate = {
    held: false,
    pending: () => pending.size,
    release() {
      this.held = false;
      for (const [id, frame] of pending) {
        if (frame.nativeId !== null) continue;
        frame.nativeId = request(timestamp => {
          pending.delete(id);
          frame.callback(timestamp);
        });
      }
      return new Promise(resolve => request(() => request(resolve)));
    },
  };
  window.requestAnimationFrame = callback => {
    if (!window.frameGate.held) return request(callback);
    const id = nextId--;
    pending.set(id, { callback, nativeId: null });
    return id;
  };
  window.cancelAnimationFrame = id => {
    const frame = pending.get(id);
    if (!frame) { cancel(id); return; }
    if (frame.nativeId !== null) cancel(frame.nativeId);
    pending.delete(id);
  };
}
export function waitForBrowserEndpoint(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const finish = (error, endpoint) => {
      clearTimeout(timer);
      child.stderr.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(endpoint);
    };
    const onData = chunk => {
      output = (output + chunk.toString()).slice(-8192);
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(null, match[1]);
    };
    const onError = error => finish(error);
    const onExit = code => finish(new Error(`Chromium exited before its debugging endpoint: ${code}`));
    const timer = setTimeout(() => finish(new Error('Chromium debugging endpoint timeout')), 10000);
    child.stderr.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}
