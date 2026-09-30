import { requireAuthenticated } from '../../_lib/auth.js';
import { createDeviceLink } from '../../_lib/deviceLinks.js';
import { apiError, json, requireMethod } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.DB) return apiError(500, 'INTERNAL_ERROR', 'Internal server error.');
    const auth = await requireAuthenticated(request, env.DB);
    if (!auth.ok) return auth.response;
    const result = await createDeviceLink({ db: env.DB, context: auth.context, clock: () => new Date().toISOString() });
    if (!result.ok) return apiError(401, 'UNAUTHORIZED', 'Authentication required.', { 'WWW-Authenticate': 'Bearer' });
    return json(201, { linkToken: result.linkToken, expiresAt: result.expiresAt });
  } catch { return apiError(500, 'INTERNAL_ERROR', 'Internal server error.'); }
}

export function onRequest({ request }) {
  return requireMethod(request, 'POST');
}
