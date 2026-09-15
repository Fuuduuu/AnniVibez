import { DB_NAME, DB_VERSION, upgradeSchema } from './schema.js';

function blockedError() {
  return new DOMException('Opening Majandus local storage was blocked', 'IndexedDbBlockedError');
}

export function openMajandusDb(indexedDb = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    let wasBlocked = false;
    let request;
    try {
      request = indexedDb.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = event => {
      upgradeSchema(request.result, event.oldVersion, request.transaction);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      wasBlocked = true;
      reject(blockedError());
    };
    request.onsuccess = () => {
      const db = request.result;
      if (wasBlocked) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

export function closeDb(db) {
  db?.close?.();
}

export function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new DOMException('IndexedDB request failed', 'UnknownError'));
  });
}

export function runTransaction(db, storeNames, mode, body) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(storeNames, mode);
    } catch (error) {
      reject(error);
      return;
    }

    let bodyError;
    let bodyResult;
    let settled = false;
    const rejectTransaction = () => {
      if (settled) return;
      settled = true;
      reject(transaction.error ?? bodyError ?? new DOMException('Transaction aborted', 'AbortError'));
    };
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(bodyResult);
    };
    transaction.onerror = rejectTransaction;
    transaction.onabort = rejectTransaction;

    let bodyPromise;
    try {
      const stores = Object.fromEntries(
        (Array.isArray(storeNames) ? storeNames : [storeNames]).map(name => [name, transaction.objectStore(name)]),
      );
      bodyPromise = body({ transaction, stores });
    } catch (error) {
      bodyPromise = Promise.reject(error);
    }
    Promise.resolve(bodyPromise).then(result => {
      bodyResult = result;
    }, error => {
      bodyError = error;
      try {
        transaction.abort();
      } catch {
        // A completed transaction cannot be aborted; its terminal handler owns the result.
      }
    });
  });
}
