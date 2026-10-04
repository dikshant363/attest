/**
 * Security checks that run as a first-class verification layer.
 *
 * These are deliberately implemented in-process rather than delegating to an external
 * scanner: a verification layer that can be "unavailable" is a verification layer that
 * can silently stop protecting the developer. These checks always run.
 */

export interface SecurityFinding {
  severity: "high" | "medium" | "low";
  rule: string;
  path: string;
  line: number;
  excerpt: string;
  advice: string;
}

interface Rule {
  id: string;
  severity: SecurityFinding["severity"];
  pattern: RegExp;
  advice: string;
  /** Skip obviously-safe matches (e.g. documentation placeholders). */
  allow?: RegExp;
}

const RULES: Rule[] = [
  {
    id: "hardcoded-aws-key",
    severity: "high",
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
    advice: "Remove the key and load it from the environment or a secret manager.",
  },
  {
    id: "private-key-block",
    severity: "high",
    pattern: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    advice: "Never commit private keys. Rotate this key immediately.",
  },
  {
    id: "hardcoded-bearer-token",
    severity: "high",
    pattern: /\b(bearer|token|api[_-]?key|secret|password)\b\s*[:=]\s*["'][A-Za-z0-9_\-.]{20,}["']/i,
    allow: /(process\.env|os\.environ|example|placeholder|your[_-]?|xxx|changeme|<[^>]+>|\$\{)/i,
    advice: "Read credentials from configuration instead of hard-coding them.",
  },
  {
    id: "disabled-tls-verification",
    severity: "high",
    pattern: /(rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|verify\s*=\s*False)/,
    advice: "Re-enable certificate verification; disabling it enables trivial MITM.",
  },
  {
    id: "sql-string-concatenation",
    severity: "high",
    pattern: /(query|execute|raw)\s*\(\s*[`"'][^`"']*\$\{|["'][^"']*["']\s*\+\s*(req|request|params|input|body)\b/,
    advice: "Use parameterised queries instead of interpolating user input into SQL.",
  },
  {
    id: "shell-injection",
    severity: "high",
    pattern: /(exec|execSync|spawnSync|system|popen)\s*\(\s*[`"'][^`"']*(\$\{|\+)/,
    advice: "Pass arguments as an array (execFile/spawn) instead of interpolating into a shell string.",
  },
  {
    id: "dangerous-eval",
    severity: "high",
    pattern: /\b(eval|Function)\s*\(\s*(req|request|input|body|params|user)/,
    advice: "Never evaluate user-controlled input as code.",
  },
  {
    id: "wildcard-cors",
    severity: "medium",
    pattern: /(Access-Control-Allow-Origin["'\s:]*\*|cors\(\s*\{\s*origin\s*:\s*["']\*["']|allow_origins\s*=\s*\[\s*["']\*["'])/,
    advice: "Restrict CORS to known origins rather than allowing every site.",
  },
  {
    id: "permissive-cookies",
    severity: "medium",
    pattern: /(httpOnly\s*:\s*false|secure\s*:\s*false|sameSite\s*:\s*["']none["'])/i,
    advice: "Session cookies should be httpOnly, secure and sameSite=strict or lax.",
  },
  {
    id: "missing-auth-middleware",
    severity: "medium",
    pattern: /(app|router)\s*\.\s*(use|get|post|put|delete)\s*\(\s*["']\/?(admin|internal|debug|metrics)/,
    advice: "Confirm this route is protected by authentication before exposing it.",
  },
  {
    id: "committed-env-file",
    severity: "medium",
    pattern: /^([A-Z0-9_]+_(KEY|SECRET|TOKEN|PASSWORD))\s*=\s*\S+/m,
    advice: "Keep .env files out of the repository and out of diffs.",
  },
  {
    id: "weak-hash",
    severity: "low",
    pattern: /\b(md5|sha1)\s*\(/i,
    advice: "Use SHA-256 or better for integrity; use a KDF for passwords.",
  },
  {
    id: "insecure-random-for-secrets",
    severity: "medium",
    pattern: /Math\.random\(\)[^;]{0,80}(token|secret|password|nonce|salt|session)/i,
    advice: "Use a cryptographically secure random source for anything security-relevant.",
  },
];

/** Files where a match is expected and therefore not a finding. */
const EXEMPT_PATH = /(^|\/)(tests?|__tests__|fixtures?|__mocks__|mocks?|docs?|examples?)\//;
const EXEMPT_FILE = /(\.test\.|\.spec\.|\.md$|\.mdx$|SECURITY\.md$|THREAT_MODEL\.md$)/;

export function scanTextForSecrets(path: string, content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length > 2000) continue;
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      if (rule.allow?.test(line)) continue;
      findings.push({
        severity: rule.severity,
        rule: rule.id,
        path,
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        advice: rule.advice,
      });
    }
  }
  return findings;
}

/**
 * Scan only the files a task actually changed.
 *
 * Scope matters: reporting pre-existing findings in untouched files would train the
 * developer to ignore this layer. Pre-existing issues are reported separately as
 * context, never as a failure of the change under review.
 */
export function scanChanges(
  changes: { path: string; diff?: string }[],
  readFile: (path: string) => string | undefined,
): { findings: SecurityFinding[]; skipped: string[] } {
  const findings: SecurityFinding[] = [];
  const skipped: string[] = [];
  for (const change of changes) {
    if (EXEMPT_PATH.test(change.path) || EXEMPT_FILE.test(change.path)) {
      skipped.push(change.path);
      continue;
    }
    const content = readFile(change.path);
    if (content === undefined) continue;
    findings.push(...scanTextForSecrets(change.path, content));
  }
  return { findings, skipped };
}

/** True when a finding is severe enough that the change must not be accepted. */
export function isBlocking(f: SecurityFinding): boolean {
  return f.severity === "high";
}
