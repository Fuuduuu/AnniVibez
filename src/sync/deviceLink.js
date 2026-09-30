const TOKEN = /^m1l_[A-Za-z0-9_-]{43}$/;
const ORIGIN = 'https://annivibe.pages.dev';

// Only a code or our canonical copyable link is accepted. Tokens stay ephemeral in the setup flow.
export function readDeviceLink(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (TOKEN.test(text)) return text;
  try {
    const url = new URL(text);
    const token = url.searchParams.get('deviceLink');
    return url.origin === ORIGIN && url.pathname === '/' && !url.username && !url.password && !url.hash
      && [...url.searchParams.keys()].length === 1 && TOKEN.test(token ?? '') ? token : null;
  } catch { return null; }
}

export function deviceLinkUrl(token) {
  if (!TOKEN.test(token)) throw new TypeError('Invalid device link');
  return `${ORIGIN}/?deviceLink=${encodeURIComponent(token)}`;
}
