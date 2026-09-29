import { validateDeviceAuthRecord, validateOutboxRecord } from '../storage/localReplica.js';

// This planner runs synchronously inside the existing calendar readwrite transaction.
// A mutation's contents never change after an attempt; retries retain the same mutationId.
export function planCalendarOutbox(snapshot, plan, { newId, clock }) {
  if (!snapshot.auth) return plan;
  validateDeviceAuthRecord(snapshot.auth);
  const stamp = clock();
  const before = new Map(snapshot.calendarEvents.map(record => [record.id, record]));
  const queued = snapshot.outbox.filter(item => item.entityType === 'calendar_event');
  let sequence = snapshot.sequence;
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('Invalid outbox sequence');
  const puts = [];
  const enqueue = (operation, record, patch) => {
    const previous = queued.filter(item => item.entityId === record.id);
    const baseRevision = operation === 'CREATE' ? 0 : record.revision + previous.length;
    const item = { mutationId: newId(), entityType: 'calendar_event', entityId: record.id,
      operation, baseRevision, patch, createdAt: stamp, attemptCount: 0,
      lastAttemptAt: null, sequence: ++sequence };
    if (!Number.isSafeInteger(sequence)) throw new RangeError('Outbox sequence cannot advance');
    validateOutboxRecord(item);
    queued.push(item);
    puts.push({ store: 'outbox', record: item });
  };
  for (const put of plan.puts) {
    if (put.store !== 'calendarEvents') { puts.push(put); continue; }
    const existing = before.get(put.record.id);
    if (existing?.deletedAt) throw new Error('A calendar tombstone cannot be reused');
    const record = { ...put.record, revision: existing?.revision ?? 0,
      syncStatus: existing?.syncStatus === 'conflict' ? 'conflict' : 'pending' };
    puts.push({ ...put, record });
    if (!existing) enqueue('CREATE', record, record.payload);
    else {
      const patch = Object.fromEntries(Object.entries(record.payload).filter(([key, value]) =>
        !['id', 'householdId', 'source'].includes(key) && JSON.stringify(value) !== JSON.stringify(existing.payload[key])));
      enqueue('UPDATE', record, patch);
    }
  }
  const deletes = [];
  for (const removal of plan.deletes) {
    if (removal.store !== 'calendarEvents') { deletes.push(removal); continue; }
    const existing = before.get(removal.key);
    if (!existing || existing.deletedAt !== null) continue;
    const tombstone = { ...existing, deletedAt: stamp, updatedAt: stamp,
      syncStatus: existing.syncStatus === 'conflict' ? 'conflict' : 'pending' };
    puts.push({ store: 'calendarEvents', record: tombstone });
    enqueue('DELETE', tombstone, {});
  }
  if (sequence !== snapshot.sequence) puts.push({ store: 'meta', record: { key: 'outboxSequence', value: sequence } });
  return { ...plan, puts, deletes };
}
