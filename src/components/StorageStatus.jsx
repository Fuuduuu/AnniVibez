// Runtime cutover C6: the single place that turns a storage-controller state into UI copy and actions.
// It renders what the C4 controller reports; it never decides authority, switches or repairs anything.

export const RELOAD_COPY = 'Majandus uuenes teises aknas. Laadi leht uuesti.';
export const LEGACY_DIVERGED_COPY = 'Vana kohalik salvestus on muutunud. Kasutusel on selle seadme andmebaas; vanu andmeid ei ühendata ega muudeta.';

const HINT_PENDING_COPY = 'Seadme salvestusruum ei võtnud muudatust vastu. Proovi uuesti.';
const BLOCKED_COPY = 'Sulge Majanduse teised aknad ja proovi uuesti.';
const UNAVAILABLE_COPY = 'Seadme salvestusruumi ei saanud lugeda. Proovi uuesti.';
const MALFORMED_COPY = 'Seadme salvestuse andmeid ei saanud lugeda. Andmeid ei muudeta.';
const REVERT_FAILED_COPY = 'Taastamine vanale salvestusele ebaõnnestus. Andmed on alles. Proovi uuesti.';

const lostCopy = result => (result?.variant === 'dated' && result.switchedAt
  ? `Kohalik andmebaas puudub. Taasta andmed seisuga ${result.switchedAt} varukoopiast?`
  : 'Taasta andmed seadme varukoopiast?');
const revertLostCopy = result => (result?.variant === 'dated' && result.switchedAt
  ? `Kohalik andmebaas puudub. Kas kasutada vana salvestust seisuga ${result.switchedAt}? Hilisemad muudatused võivad puududa.`
  : 'Kohalik andmebaas puudub. Kas kasutada seadme vana salvestust? Hilisemad muudatused võivad puududa.');

// The exact user-visible copy of the blocking states (Section 3); null for states that have no screen.
export function storageStateCopy(state, result) {
  switch (state) {
    case 'AUTHORITY_HINT_PENDING': return HINT_PENDING_COPY;
    case 'BLOCKED': return BLOCKED_COPY;
    case 'STORAGE_UNAVAILABLE': return result?.reason === 'authority-malformed' ? MALFORMED_COPY : UNAVAILABLE_COPY;
    case 'STORAGE_LOST': return lostCopy(result);
    case 'RELOAD_REQUIRED': return RELOAD_COPY;
    case 'REVERT_STORAGE_LOST': return revertLostCopy(result);
    case 'REVERT_FAILED': return REVERT_FAILED_COPY;
    default: return null;
  }
}

export function StorageSplash() {
  return <div className="mm-storage-splash" role="status" aria-busy="true" data-storage-state="BOOTING">
    <p>Laen andmeid…</p>
  </div>;
}

// Blocking screen for the shared domains. `actions` = { retry, confirmStorageLost, confirmRevertStorageLost, reload }.
export function StorageStatus({ state, result, actions }) {
  if (state === 'BOOTING' || state === 'REVERTING') return <StorageSplash />;
  const copy = storageStateCopy(state, result);
  if (!copy) return null;
  const canRetry = ['AUTHORITY_HINT_PENDING', 'BLOCKED', 'REVERT_FAILED'].includes(state)
    || (state === 'STORAGE_UNAVAILABLE' && result?.reason !== 'authority-malformed');
  return <section className="mm-card mm-storage-status" role="alert" data-storage-state={state}>
    <p>{copy}</p>
    {canRetry && <button type="button" className="mm-button mm-button-primary" onClick={actions.retry}>Proovi uuesti</button>}
    {state === 'STORAGE_LOST' && <button type="button" className="mm-button mm-button-primary" onClick={actions.confirmStorageLost}>Taasta andmed</button>}
    {state === 'REVERT_STORAGE_LOST' && <button type="button" className="mm-button mm-button-primary" onClick={actions.confirmRevertStorageLost}>Kasuta vana salvestust</button>}
    {state === 'RELOAD_REQUIRED' && <button type="button" className="mm-button mm-button-primary" onClick={actions.reload}>Laadi uuesti</button>}
  </section>;
}

// Banner above an already mounted shared session: the reload banner (writes are disabled elsewhere)
// and the non-blocking LEGACY_DIVERGED notice. Nothing here repairs, merges or writes.
export function StorageNotice({ state, result, actions }) {
  if (state === 'RELOAD_REQUIRED') {
    return <div className="mm-storage-banner" role="alert" data-storage-state="RELOAD_REQUIRED">
      <p>{RELOAD_COPY}</p>
      <button type="button" className="mm-button mm-button-primary" onClick={actions.reload}>Laadi uuesti</button>
    </div>;
  }
  if (state === 'READY' && result?.divergence === 'LEGACY_DIVERGED') {
    return <div className="mm-notice mm-storage-notice" role="status" data-storage-state="LEGACY_DIVERGED">{LEGACY_DIVERGED_COPY}</div>;
  }
  return null;
}
