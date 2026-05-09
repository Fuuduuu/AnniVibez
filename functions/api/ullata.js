const IDEA_KEYS = [
  'idea_title',
  'what_to_do',
  'why_it_fits',
  'easy_start_tip',
  'new_tip_or_trick',
  'make_it_yours',
  'easier_version',
];
const PROVIDER_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 12 * 1024;
const MAX_PROMPT_CHARS = 1200;
const MAX_SYSTEM_PROMPT_CHARS = 2400;
const MAX_WITH_CHARS = 40;
const MAX_MATERIAL_ITEMS = 8;
const MAX_MATERIAL_ITEM_CHARS = 80;
const MAX_MOOD_ITEMS = 3;
const MAX_MOOD_ITEM_CHARS = 40;
const MAX_EXTRA_TEXT_FIELDS = 6;
const MAX_EXTRA_TEXT_FIELD_CHARS = 240;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
// Isolate-local memory guard: lightweight abuse reduction, not a global distributed limiter.
const RATE_LIMIT_BUCKETS = new Map();

const DEFAULT_SYSTEM_PROMPT =
  'Sa oled soe ja loov ideekaaslane 10-13-aastasele tüdrukule. Anna üks selge ja teostatav idee tooniga "üks kasulik nipp, siis tee oma versioon". Vasta AINULT JSON-ina ilma markdown-ita:{"idea_title":"max 6 sõna","what_to_do":"2-3 lauset konkreetselt","why_it_fits":"1 lause","easy_start_tip":"1 lause kohe alustamiseks","new_tip_or_trick":"1 lause uuest oskusest","make_it_yours":"1 lause oma stiilis","easier_version":"1 lause lihtsam variant"}';

const WITH_LABELS = {
  endale: 'Endale',
  issi: 'Issiga koos',
  emme: 'Emmega koos',
  vanaema: 'Vanaemaga koos',
  loomadele: 'Koerale või kassile',
};

const TIME_LABELS = {
  10: '10 min',
  20: '20 min',
  30: '30 min',
  60: 'kauem',
};

const MOOD_STARTERS = {
  joonista: 'Tee 60-sekundiline visand',
  meisterda: 'Vali üks lihtne vorm ja hakka ehitama',
  armas: 'Lisa üks pehme detail',
  naljakas: 'Pane sisse üks naljakas pööre',
  rahulik: 'Tee aeglases tempos, ilma kiirustamata',
  maagiline: 'Lisa sära või salajane detail',
  kasulik: 'Tee asi, mida saad päriselt kasutada',
  üllatav: 'Lõppu lisa väike üllatus',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function badRequest(message) {
  return json(
    {
      error: 'invalid_request',
      message: message || 'Päring ei ole korrektne.',
    },
    400
  );
}

function tooManyRequests(retryAfterSeconds) {
  const waitSeconds = Math.max(1, Number.parseInt(String(retryAfterSeconds), 10) || 1);
  return new Response(
    JSON.stringify({
      error: 'rate_limited',
      message: 'Proovi hetke pärast uuesti.',
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': String(waitSeconds),
      },
    }
  );
}

function getClientKey(request) {
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp && cfIp.trim()) return cfIp.trim();

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor && forwardedFor.trim()) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }

  return 'unknown';
}

function applyRateLimit(clientKey) {
  const now = Date.now();
  const safeKey = String(clientKey || 'unknown').slice(0, 120);
  const current = RATE_LIMIT_BUCKETS.get(safeKey);

  if (!current || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
    RATE_LIMIT_BUCKETS.set(safeKey, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  current.count += 1;
  const remainingMs = Math.max(0, RATE_LIMIT_WINDOW_MS - (now - current.windowStart));
  const retryAfterSeconds = Math.ceil(remainingMs / 1000);

  if (current.count > RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfterSeconds };
  }

  if (RATE_LIMIT_BUCKETS.size > 2000) {
    for (const [key, bucket] of RATE_LIMIT_BUCKETS) {
      if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
        RATE_LIMIT_BUCKETS.delete(key);
      }
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

function validateStringLength(value, maxLen) {
  if (typeof value !== 'string') return false;
  return value.length <= maxLen;
}

async function readRequestJsonWithLimit(request) {
  const contentLengthHeader = request.headers.get('content-length');
  const declaredLength = Number.parseInt(String(contentLengthHeader || ''), 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { error: 'Päringu sisu on liiga suur.' };
  }

  let text = '';
  try {
    text = await request.text();
  } catch {
    return { error: 'Päringu sisu lugemine ebaõnnestus.' };
  }

  const bodyBytes = new TextEncoder().encode(text).length;
  if (bodyBytes > MAX_BODY_BYTES) {
    return { error: 'Päringu sisu on liiga suur.' };
  }

  if (!text.trim()) {
    return { value: {} };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'Päringu JSON on vigane.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'Päringu JSON peab olema objekt.' };
  }

  return { value: parsed };
}

function validateRequestBody(body) {
  const allowedTopLevel = new Set(['with', 'materials', 'time', 'mood', 'variationNonce', 'prompt', 'systemPrompt']);

  if ('prompt' in body) {
    if (typeof body.prompt !== 'string') return 'prompt peab olema tekst.';
    if (!validateStringLength(body.prompt, MAX_PROMPT_CHARS)) return 'prompt on liiga pikk.';
  }

  if ('systemPrompt' in body) {
    if (typeof body.systemPrompt !== 'string') return 'systemPrompt peab olema tekst.';
    if (!validateStringLength(body.systemPrompt, MAX_SYSTEM_PROMPT_CHARS)) return 'systemPrompt on liiga pikk.';
  }

  if ('with' in body) {
    if (typeof body.with !== 'string') return 'with peab olema tekst.';
    if (!validateStringLength(body.with, MAX_WITH_CHARS)) return 'with on liiga pikk.';
  }

  if ('materials' in body) {
    if (!Array.isArray(body.materials)) return 'materials peab olema massiiv.';
    if (body.materials.length > MAX_MATERIAL_ITEMS) return 'materials sisaldab liiga palju väärtusi.';
    for (const item of body.materials) {
      if (typeof item !== 'string') return 'materials väärtused peavad olema tekstid.';
      if (!validateStringLength(item, MAX_MATERIAL_ITEM_CHARS)) return 'materials väärtus on liiga pikk.';
    }
  }

  if ('mood' in body) {
    if (!Array.isArray(body.mood)) return 'mood peab olema massiiv.';
    if (body.mood.length > MAX_MOOD_ITEMS) return 'mood sisaldab liiga palju väärtusi.';
    for (const item of body.mood) {
      if (typeof item !== 'string') return 'mood väärtused peavad olema tekstid.';
      if (!validateStringLength(item, MAX_MOOD_ITEM_CHARS)) return 'mood väärtus on liiga pikk.';
    }
  }

  let extraTextFieldCount = 0;
  for (const [key, value] of Object.entries(body)) {
    if (allowedTopLevel.has(key)) continue;
    if (typeof value === 'string' && value.trim()) {
      extraTextFieldCount += 1;
      if (extraTextFieldCount > MAX_EXTRA_TEXT_FIELDS) {
        return 'Liiga palju lisateksti välju.';
      }
      if (!validateStringLength(value, MAX_EXTRA_TEXT_FIELD_CHARS)) {
        return `Väli ${key} on liiga pikk.`;
      }
    }
  }

  return '';
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePayload(input) {
  const withId = typeof input?.with === 'string' ? input.with : 'endale';
  const materials = asStringArray(input?.materials).slice(0, MAX_MATERIAL_ITEMS);
  const mood = asStringArray(input?.mood).slice(0, MAX_MOOD_ITEMS);
  const time = toInt(input?.time, 20);
  const variationNonce = Math.max(0, toInt(input?.variationNonce, 0));
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  const systemPrompt = typeof input?.systemPrompt === 'string' ? input.systemPrompt.trim() : DEFAULT_SYSTEM_PROMPT;

  return {
    with: withId,
    materials,
    mood,
    time,
    variationNonce,
    prompt,
    systemPrompt,
  };
}

function hashSeed(value) {
  const text = String(value ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pick(arr, idx) {
  return arr[Math.abs(idx) % arr.length];
}

function buildPrompt(payload) {
  const materialsText = payload.materials.length > 0 ? payload.materials.join(', ') : 'mis käepärast';
  const moodText = payload.mood.length > 0 ? payload.mood.join(', ') : 'maagiline';
  return `Kellega: ${payload.with}
Materjalid: ${materialsText}
Aega: ${payload.time} min
Mood: ${moodText}`;
}

function buildLocalIdea(payload) {
  const withLabel = WITH_LABELS[payload.with] || 'Endale';
  const firstMood = payload.mood[0] || 'maagiline';
  const firstMaterial = payload.materials[0] || 'paber ja pliiatsid';
  const timeLabel = TIME_LABELS[payload.time] || '20 min';
  const seed = hashSeed(`${payload.with}|${payload.time}|${payload.mood.join(',')}|${firstMaterial}|${payload.variationNonce}`);

  const titles = ['Väike loov hetk', 'Tee see oma moodi', 'Armas mini-projekt', 'Maagiline väike idee', 'Loome midagi koos'];

  return {
    idea_title: pick(titles, seed),
    what_to_do: `Tee ${timeLabel} jooksul väike projekt ${withLabel.toLowerCase()} koos, kasutades ${firstMaterial}. Alusta ühest lihtsast kujust või ideest, lisa 2-3 detaili ja lõpeta värviga, mis teeb tuju heaks.`,
    why_it_fits: `See sobib sulle, sest valisid "${firstMood}" meeleolu ja see mahub mõnusalt sinu valitud aega.`,
    easy_start_tip: `${MOOD_STARTERS[firstMood] || MOOD_STARTERS.maagiline}. Esimene samm võiks kesta ainult 2 minutit.`,
    new_tip_or_trick: 'Kasuta üht paksumat joont või üht varjutooni, siis jääb töö kohe selgem.',
    make_it_yours: 'Lisa oma märk: süda, täht, muster või värvipaar, mis on just sinu moodi.',
    easier_version: 'Kui aega jääb väheks, tee sama idee mini-versioonina ainult ühe põhidetailiga.',
  };
}

function extractTextFromResponse(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }

  const outputs = Array.isArray(data?.output) ? data.output : [];
  for (const output of outputs) {
    if (output?.type !== 'message' || !Array.isArray(output?.content)) continue;
    for (const item of output.content) {
      if (typeof item?.text === 'string' && item.text.trim()) {
        return item.text;
      }
    }
  }
  return '';
}

function normalizeIdea(rawIdea, fallbackIdea) {
  const source = rawIdea && typeof rawIdea === 'object' ? rawIdea : {};
  const normalized = {};
  for (const key of IDEA_KEYS) {
    const value = typeof source[key] === 'string' ? source[key].trim() : '';
    normalized[key] = value || fallbackIdea[key];
  }
  return normalized;
}

function tryParseIdea(text) {
  if (!text) return null;
  const clean = text.replace(/```json|```/g, '').trim();
  if (!clean) return null;
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractTextFromGemini(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        return part.text;
      }
    }
  }
  return '';
}

async function generateWithGemini(payload, env) {
  const apiKey = env?.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  const userPrompt = payload.prompt || buildPrompt(payload);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const reqBody = {
    systemInstruction: {
      parts: [{ text: payload.systemPrompt || DEFAULT_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.8,
      maxOutputTokens: 500,
    },
  };

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(reqBody),
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  const ideaText = extractTextFromGemini(data);
  return tryParseIdea(ideaText);
}

async function generateWithOpenAI(payload, env) {
  const apiKey = env?.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  const userPrompt = payload.prompt || buildPrompt(payload);
  const reqBody = {
    model,
    input: [
      { role: 'system', content: payload.systemPrompt || DEFAULT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    text: {
      format: { type: 'json_object' },
    },
    max_output_tokens: 500,
  };

  const res = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(reqBody),
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  const ideaText = extractTextFromResponse(data);
  return tryParseIdea(ideaText);
}

export async function onRequestPost({ request, env }) {
  const clientKey = getClientKey(request);
  const rateLimit = applyRateLimit(clientKey);
  if (!rateLimit.allowed) {
    return tooManyRequests(rateLimit.retryAfterSeconds);
  }

  const bodyResult = await readRequestJsonWithLimit(request);
  if (bodyResult.error) {
    return badRequest(bodyResult.error);
  }

  const body = bodyResult.value || {};
  const bodyValidationError = validateRequestBody(body);
  if (bodyValidationError) {
    return badRequest(bodyValidationError);
  }

  const payload = normalizePayload(body);
  const fallbackIdea = buildLocalIdea(payload);

  if (env?.GEMINI_API_KEY) {
    try {
      const geminiIdea = await generateWithGemini(payload, env);
      if (geminiIdea) {
        return json({ idea: normalizeIdea(geminiIdea, fallbackIdea), source: 'gemini' });
      }
    } catch {
      // Ignore provider errors and continue to OpenAI fallback if available.
    }
  }

  if (env?.OPENAI_API_KEY) {
    try {
      const openaiIdea = await generateWithOpenAI(payload, env);
      if (openaiIdea) {
        return json({ idea: normalizeIdea(openaiIdea, fallbackIdea), source: 'openai' });
      }
    } catch {
      // Ignore provider errors and continue with deterministic fallback.
    }
  }

  return json({ idea: fallbackIdea, source: 'local' });
}
