/** Parse ALLOWED_URL_PREFIXES; each entry is an http(s) origin plus optional path prefix. */
export function parsePrefixes(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new URL(s).href);
}

export function globalPrefixes(): string[] {
  return parsePrefixes(process.env.ALLOWED_URL_PREFIXES || "http://localhost:3000/demo/");
}

/**
 * True only for http(s) URLs without credentials whose origin matches a prefix and whose
 * normalized path starts with the prefix path. `new URL` resolves `..`, so traversal can't escape.
 */
export function isUrlAllowed(url: string, prefixes: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  return prefixes.some((p) => {
    const allowed = new URL(p);
    return u.origin === allowed.origin && u.pathname.startsWith(allowed.pathname);
  });
}

// shortcut: label-based detection only, misses icon-only or mislabeled buttons; upgrade to a per-site action policy before automating real sites.
const DESTRUCTIVE = /\b(delete|remove|send|email|e-mail|pay|purchase|buy|checkout|submit|publish|post|transfer|place ?order|cancel|archive|unsubscribe|sign ?out|log ?out|approve|reject)\b/i;

export function isDestructiveLabel(label: string): boolean {
  return DESTRUCTIVE.test(label);
}

/** Basic redaction for logs and model-visible text. */
export function redact(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
    .replace(/\b(password|passwd|secret|token|api[_-]?key|cookie|authorization)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1$2[redacted]");
}
