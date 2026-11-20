import { apiError, json } from "./http.js";

const HEADER = "X-Annivibe-Sync-Capabilities";
const MERGE_EVIDENCE = "merge-evidence-v1";
const UPGRADE_REQUIRED = "CLIENT_UPGRADE_REQUIRED";

export const clientUpgradeRequired = () => ({ status: "RETRYABLE", code: UPGRADE_REQUIRED });

export function mutationJournalJson({ digest, result }, entityType) {
  // Keep the domain discriminator inside the durable journal, outside the wire result.
  return JSON.stringify(result.merge ? { digest, result, mergeEntityType: entityType } : { digest, result });
}

export async function requiresMergeEvidence(db, householdId, mutation, status, supportsMergeEvidence) {
  if (supportsMergeEvidence) return false;
  if (status === "MERGED") return true;
  if (status !== "APPLIED" || mutation.operation === "CREATE") return false;

  // A capable tab can rebase a safe dependent in shared IndexedDB. An older cached
  // tab must not acknowledge that dependent and discard its carried merge evidence.
  // A mutation based before a merge cannot have inherited that merge's rebase.
  const marker = await db.prepare(`SELECT 1 AS found FROM applied_mutations
    WHERE household_id = ?
      AND json_extract(result_json, '$.mergeEntityType') = ?
      AND json_extract(result_json, '$.result.merge.record.id') = ?
      AND json_extract(result_json, '$.result.revision') <= ?
    LIMIT 1`).bind(householdId, mutation.entityType, mutation.entityId, mutation.baseRevision).first();
  return marker !== null;
}

export async function pushMutations(request, mutations, apply) {
  const capabilities = request.headers.get(HEADER)?.split(",").map(value => value.trim()) ?? [];
  const supportsMergeEvidence = capabilities.includes(MERGE_EVIDENCE);
  const results = [];
  let blocked = false;
  for (const mutation of mutations) {
    const mutationId = typeof mutation?.mutationId === "string" ? mutation.mutationId : null;
    const result = blocked ? clientUpgradeRequired() : await apply(mutation, supportsMergeEvidence);
    if (result.code === UPGRADE_REQUIRED) {
      if (mutations.length === 1) return apiError(409, UPGRADE_REQUIRED, "Update the app to continue synchronization.");
      // The already written prefix remains durable. A later dependent can match the
      // current revision only because its predecessor was withheld, so stop here.
      blocked = true;
    }
    results.push({ mutationId, ...result });
  }
  return json(200, { results });
}
