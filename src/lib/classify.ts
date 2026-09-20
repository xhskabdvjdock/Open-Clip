import type { ContentType } from "../types";

const URL_RE =
  /^(https?:\/\/|www\.)[^\s/$.?#].[^\s]*$/i;
const URL_ANYWHERE_RE =
  /https?:\/\/[^\s/$.?#].[^\s]*/i;
const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NUMBER_RE =
  /^[+-]?(\d[\d\s.,_]*(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;
const IP_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** Heuristic code detection — deliberately conservative. */
function looksLikeCode(s: string): boolean {
  const t = s.trim();
  if (t.length < 3) return false;
  const indicators = [
    /^(npm|yarn|pnpm|npx|bun|pip|cargo|go|git|docker|kubectl|brew|apt|sudo)\s+/m,
    /^(import|export|from|const|let|var|function|class|def|fn|func|public|private|if|for|while)\s/m,
    /[{}\[\]();=>]{2,}/,
    /#include\b/,
    /<\/?[a-z][^>]*>/i,
    /&&|\|\||=>|->|::/,
    /;\s*$/,
    /`{1,3}[^`]+`{1,3}/,
    /^\s*(\$|>|#)\s+\S+/m,
    /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)\b/i,
  ];
  let score = 0;
  for (const re of indicators) if (re.test(t)) score++;
  // multi-line with braces/semicolons is strong signal
  if (t.includes("\n") && /[{};=]/.test(t)) score++;
  return score >= 1 && (t.includes("\n") || score >= 2 || /^(npm|npx|git|docker|pip|cargo)/.test(t));
}

export function classifyContent(content: string): ContentType {
  const t = content.trim();
  if (!t) return "text";
  if (t.length <= 2000 && (URL_RE.test(t) || (t.split(/\s+/).length === 1 && URL_ANYWHERE_RE.test(t)))) {
    return "url";
  }
  if (t.length <= 500 && EMAIL_RE.test(t)) return "email";
  if (t.length <= 100 && (NUMBER_RE.test(t.replace(/[\s,]/g, "")) || IP_RE.test(t))) return "number";
  if (looksLikeCode(t)) return "code";
  return "text";
}

// ---- Sensitive detection (local only) ----

const SENSITIVE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, label: "private-key" },
  { re: /sk-(live|test)-[A-Za-z0-9]{8,}/, label: "api-key" },
  { re: /sk_live_[A-Za-z0-9]{8,}/, label: "api-key" },
  { re: /xox[bap]-?[A-Za-z0-9-]{8,}/, label: "token" },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/, label: "github-token" },
  { re: /AIza[0-9A-Za-z_-]{20,}/, label: "google-api-key" },
  { re: /(AKIA|ASIA)[0-9A-Z]{16}/, label: "aws-key" },
  { re: /aws_secret_access_key\s*[:=]\s*[A-Za-z0-9/+=]{20,}/i, label: "aws-secret" },
  { re: /["']?password["']?\s*[:=]\s*["']?\S{4,}["']?/i, label: "password" },
  { re: /["']?(passwd|pwd|secret|token|api[_-]?key|auth[_-]?token|access[_-]?token)["']?\s*[:=]\s*\S{4,}/i, label: "secret" },
  { re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, label: "card-like" }, // 16-digit card-like
  { re: /\b(?:\d[ -]*?){13,19}\b/, label: "card-like-loose" },
  { re: /\b\d{3}-\d{2}-\d{4}\b/, label: "ssn-like" },
  { re: /(?:otp|one[-_ ]?time|verification|2fa)[^\d]{0,20}(\d{4,8})/i, label: "otp-context" },
];

function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let e = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

export function isSensitive(content: string): { sensitive: boolean; reason?: string } {
  const t = content.trim();
  if (!t) return { sensitive: false };
  // Very short numeric OTP (4-8 digits) on its own is suspicious
  if (/^\d{4,8}$/.test(t)) return { sensitive: true, reason: "otp-code" };
  for (const p of SENSITIVE_PATTERNS) {
    if (p.re.test(t)) {
      // card-like needs Luhn-ish sanity to reduce false positives: at least entropy/length check
      return { sensitive: true, reason: p.label };
    }
  }
  // High-entropy long token-like single string (e.g. JWT / bearer)
  const nospace = t.replace(/\s+/g, "");
  if (nospace.length >= 32 && nospace.length <= 4096 && /^[A-Za-z0-9\-_+/=.]+$/.test(nospace)) {
    const e = shannonEntropy(nospace.slice(0, 256));
    if (e > 4.5) return { sensitive: true, reason: "high-entropy-token" };
    if (/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(nospace))
      return { sensitive: true, reason: "jwt" };
    if (/^(Bearer\s+)?[A-Za-z0-9\-_]{32,}$/.test(t) && e > 4.2)
      return { sensitive: true, reason: "bearer-like" };
  }
  return { sensitive: false };
}

/** FNV-1a / SHA-like short hash for UI fallback (Rust uses SHA-256). */
export function hashContent(s: string): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = s.length - 1; i >= 0; i--) {
    h2 ^= s.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
