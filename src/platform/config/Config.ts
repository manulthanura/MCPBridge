/**
 * Infrastructure: configuration, validated with zod. Everything is
 * environment-driven so the server drops into any MCP client config with
 * plain `env` entries — no config file required (usability spec U-04).
 */
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  PGHOST: z.string().optional(),
  PGPORT: z.coerce.number().int().positive().optional(),
  PGDATABASE: z.string().optional(),
  PGUSER: z.string().optional(),
  PGPASSWORD: z.string().optional(),

  /** read-only (default) disables write_db entirely. */
  MCPBRIDGE_MODE: z.enum(['read-only', 'read-write']).default('read-only'),
  MCPBRIDGE_DEFAULT_SCHEMA: z.string().default('public'),
  MCPBRIDGE_MAX_ROWS: z.coerce.number().int().positive().max(10_000).default(100),
  MCPBRIDGE_RATE_LIMIT: z.coerce.number().int().positive().default(100),
  MCPBRIDGE_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  MCPBRIDGE_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MCPBRIDGE_CONFIRMATION_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  MCPBRIDGE_SCHEMA_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  MCPBRIDGE_HIGH_RISK_ROW_THRESHOLD: z.coerce.number().int().positive().default(100),
  MCPBRIDGE_MAX_CONNECTIONS: z.coerce.number().int().positive().max(50).default(10),
  MCPBRIDGE_AUDIT_LOG: z.string().default('mcpbridge-audit.jsonl'),
  /** Comma-separated extra table names to block, beyond system catalogs. */
  MCPBRIDGE_BLOCKED_TABLES: z.string().default(''),
  /** Transport: stdio (default) or http (Streamable HTTP). */
  MCPBRIDGE_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCPBRIDGE_HTTP_PORT: z.coerce.number().int().positive().default(3920),
});

export interface AppConfig {
  connectionString: string;
  readOnlyMode: boolean;
  defaultSchema: string;
  maxRows: number;
  rateLimit: number;
  rateWindowMs: number;
  queryTimeoutMs: number;
  confirmationTtlMs: number;
  schemaCacheTtlMs: number;
  highRiskRowThreshold: number;
  maxConnections: number;
  auditLogPath: string;
  blockedTables: string[];
  transport: 'stdio' | 'http';
  httpPort: number;
  /** Secret values that must never appear in errors or logs. */
  secrets: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid MCPBridge configuration:\n${issues}`);
  }
  const e = parsed.data;

  let connectionString: string;
  if (e.DATABASE_URL) {
    connectionString = e.DATABASE_URL;
  } else if (e.PGHOST && e.PGDATABASE && e.PGUSER) {
    const auth = e.PGPASSWORD
      ? `${encodeURIComponent(e.PGUSER)}:${encodeURIComponent(e.PGPASSWORD)}`
      : encodeURIComponent(e.PGUSER);
    connectionString = `postgresql://${auth}@${e.PGHOST}:${e.PGPORT ?? 5432}/${e.PGDATABASE}`;
  } else {
    throw new Error(
      'Database connection not configured. Set DATABASE_URL, or PGHOST + PGDATABASE + PGUSER (+ PGPASSWORD, PGPORT).',
    );
  }

  const secrets: string[] = [];
  if (e.PGPASSWORD) secrets.push(e.PGPASSWORD);
  const urlPassword = extractUrlPassword(connectionString);
  if (urlPassword) secrets.push(urlPassword);

  return {
    connectionString,
    readOnlyMode: e.MCPBRIDGE_MODE === 'read-only',
    defaultSchema: e.MCPBRIDGE_DEFAULT_SCHEMA,
    maxRows: e.MCPBRIDGE_MAX_ROWS,
    rateLimit: e.MCPBRIDGE_RATE_LIMIT,
    rateWindowMs: e.MCPBRIDGE_RATE_WINDOW_SECONDS * 1000,
    queryTimeoutMs: e.MCPBRIDGE_QUERY_TIMEOUT_MS,
    confirmationTtlMs: e.MCPBRIDGE_CONFIRMATION_TTL_SECONDS * 1000,
    schemaCacheTtlMs: e.MCPBRIDGE_SCHEMA_CACHE_TTL_SECONDS * 1000,
    highRiskRowThreshold: e.MCPBRIDGE_HIGH_RISK_ROW_THRESHOLD,
    maxConnections: e.MCPBRIDGE_MAX_CONNECTIONS,
    auditLogPath: e.MCPBRIDGE_AUDIT_LOG,
    blockedTables: e.MCPBRIDGE_BLOCKED_TABLES.split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0),
    transport: e.MCPBRIDGE_TRANSPORT,
    httpPort: e.MCPBRIDGE_HTTP_PORT,
    secrets,
  };
}

function extractUrlPassword(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    return url.password ? decodeURIComponent(url.password) : null;
  } catch {
    return null;
  }
}

/** Replaces every known secret in a message with a placeholder (spec S-02). */
export function redactSecrets(message: string, secrets: string[]): string {
  let redacted = message;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  // Belt and braces: redact anything that looks like a connection-string password.
  redacted = redacted.replace(/(postgres(?:ql)?:\/\/[^:@\s/]+):[^@\s/]+@/gi, '$1:[REDACTED]@');
  redacted = redacted.replace(/(password\s*[=:]\s*)\S+/gi, '$1[REDACTED]');
  return redacted;
}
