const ALLOWED_PREFIXES = new Set(["hld", "usr", "ses"]);

export function newId(prefix) {
  if (!ALLOWED_PREFIXES.has(prefix)) throw new RangeError("Unsupported ID prefix");
  return `${prefix}_${crypto.randomUUID()}`;
}
