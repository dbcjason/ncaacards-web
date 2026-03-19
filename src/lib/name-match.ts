const SUFFIXES = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
]);

function normalizeToken(t: string): string {
  return t
    .toLowerCase()
    .replace(/[.'`-]/g, "")
    .trim();
}

export function normalizePersonName(name: string): string {
  const tokens = String(name)
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length > 0 && !SUFFIXES.has(t));
  return tokens.join(" ");
}

export function resolveClosestName(input: string, candidates: string[]): string {
  const raw = String(input).trim();
  if (!raw || candidates.length === 0) return raw;

  if (candidates.includes(raw)) return raw;

  const normInput = normalizePersonName(raw);
  if (!normInput) return raw;

  for (const c of candidates) {
    if (normalizePersonName(c) === normInput) return c;
  }

  // fallback: match first+last token with suffix-insensitive normalization
  const parts = normInput.split(" ").filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  if (first && last) {
    for (const c of candidates) {
      const cp = normalizePersonName(c).split(" ").filter(Boolean);
      if (!cp.length) continue;
      if ((cp[0] ?? "") === first && (cp[cp.length - 1] ?? "") === last) return c;
    }
  }

  // fallback: input contained in candidate normalization
  for (const c of candidates) {
    const nc = normalizePersonName(c);
    if (nc.includes(normInput) || normInput.includes(nc)) return c;
  }

  return raw;
}

