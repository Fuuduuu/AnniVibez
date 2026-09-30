import { claimDeviceLink } from '../../_lib/deviceLinks.js';
import { apiError, json, readJsonObject, requireMethod } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.DB) return apiError(500, 'INTERNAL_ERROR', 'Internal server error.');
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return apiError(400, 'INVALID_REQUEST', 'Invalid request.');
    const result = await claimDeviceLink({ db: env.DB, input: parsed.value, clock: () => new Date().toISOString() });
    if (result.code === 'INVALID_REQUEST') return apiError(400, 'INVALID_REQUEST', 'Invalid request.');
    if (!result.ok) return apiError(400, 'INVALID_DEVICE_LINK', 'Device link is invalid or expired.');
    return json(201, { account: result.account, household: result.household, deviceSession: result.deviceSession });
  } catch { return apiError(500, 'INTERNAL_ERROR', 'Internal server error.'); }
}

export function onRequest({ request }) {
  return requireMethod(request, 'POST');
}
