export const MERGE_EVIDENCE_HEADERS = { 'X-Annivibe-Sync-Capabilities': 'merge-evidence-v1' };

export function isClientUpgradeRequired(error) {
  return error.status === 409 && error.code === 'CLIENT_UPGRADE_REQUIRED';
}
