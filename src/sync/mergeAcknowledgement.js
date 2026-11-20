function validateEvidenceRecord(value, mutation, readRecord) {
  try {
    const record = readRecord(value);
    if (record.id !== mutation.entityId || record.deletedAt !== null ||
        !Number.isSafeInteger(record.revision) || record.revision < 1) return null;
    return record;
  } catch {
    return null;
  }
}

function readMerge(value, mutation, revision, fields, readRecord) {
  if (!value || !Array.isArray(value.fields) || value.fields.some(field => !fields.includes(field))) return null;
  const record = validateEvidenceRecord(value.record, mutation, readRecord);
  return record?.revision === revision && revision > mutation.baseRevision + 1
    ? { fields: value.fields, record }
    : null;
}

function readCarriedMerge(value, mutation, fields, readRecord) {
  if (!value || !Number.isSafeInteger(value.throughSequence) || value.throughSequence < mutation.sequence
      || !Array.isArray(value.fieldWindows) || value.fieldWindows.some(entry => !Array.isArray(entry)
        || entry.length !== 2 || !fields.includes(entry[0]) || !Number.isSafeInteger(entry[1])
        || entry[1] < mutation.sequence || entry[1] > value.throughSequence)) return null;
  const record = validateEvidenceRecord(value.record, mutation, readRecord);
  return record && record.revision <= mutation.baseRevision ? { ...value, record } : null;
}

// Carry only server-verified history forward, including through a later ordinary APPLIED result.
// Each field affects only edits already queued when that server value was learned.
export function reconcileMergeAcknowledgement({
  merge, mutation, revision, dependents, local, fields, group, readRecord, validatePayload,
}) {
  const confirmed = readMerge(merge, mutation, revision, fields, readRecord);
  const carried = readCarriedMerge(mutation.mergeEvidence, mutation, fields, readRecord);
  const uncertain = (merge !== undefined && !confirmed) || (mutation.mergeEvidence !== undefined && !carried);
  const latestMergeThrough = confirmed ? dependents.at(-1)?.sequence ?? 0 : 0;
  const throughSequence = Math.max(latestMergeThrough, carried?.throughSequence ?? 0);
  const fieldWindows = new Map(carried?.fieldWindows);
  for (const field of confirmed?.fields ?? []) fieldWindows.set(field, latestMergeThrough);
  const remoteRecord = confirmed?.record ?? carried?.record;
  const next = dependents[0];
  let payload = local.payload;
  let invalidCombination = false;
  if (confirmed && !uncertain && local.syncStatus !== 'conflict') {
    if (!next) payload = confirmed.record.payload;
    else {
      const pendingGroups = new Set(dependents.flatMap(item => Object.keys(item.patch).map(group)));
      const candidate = { ...payload };
      for (const field of confirmed.fields) {
        if (pendingGroups.has(group(field))) continue;
        if (Object.hasOwn(confirmed.record.payload, field)) candidate[field] = confirmed.record.payload[field];
        else delete candidate[field];
      }
      try {
        validatePayload(candidate);
        payload = candidate;
      } catch {
        invalidCombination = true;
      }
    }
  }

  const plan = {
    payload,
    revision: uncertain ? local.revision : Math.max(local.revision, revision),
    refreshSnapshot: uncertain,
  };
  if (!next || local.syncStatus === 'conflict') return plan;
  const withinMerge = next.sequence <= throughSequence;
  const applicableFields = [...fieldWindows].filter(([, until]) => next.sequence <= until);
  if (uncertain || withinMerge) {
    const remoteGroups = new Set(applicableFields.map(([field]) => group(field)));
    const overlap = Object.keys(next.patch).some(field => remoteGroups.has(group(field)));
    const code = uncertain || invalidCombination || next.attemptCount !== 0 ? 'MERGE_UNCERTAIN'
      : next.operation === 'DELETE' ? 'STALE_DELETE'
      : overlap || next.operation !== 'UPDATE' ? 'FIELD_OVERLAP'
      : null;
    if (code) return { ...plan, blocked: { mutation: next, remoteRecord, result: { status: 'CONFLICT', code } } };
  }
  if (next.attemptCount === 0 && next.operation !== 'CREATE') {
    const nextMutation = { ...next, baseRevision: revision };
    if (withinMerge) nextMutation.mergeEvidence = { fieldWindows: applicableFields, throughSequence, record: remoteRecord };
    return { ...plan, nextMutation };
  }
  return plan;
}
