/**
 * Querying context: the safety gate every piece of SQL passes through before
 * it is allowed anywhere near the database.
 *
 * Design stance: this is a *policy* layer, not a SQL parser. PostgreSQL
 * remains the authority on syntax; our job is to classify the statement,
 * reject anything outside the allowed envelope, and fail closed on anything
 * we cannot confidently classify.
 */
import {
  ClassifiedQuery,
  READ_ONLY_KINDS,
  StatementKind,
  WRITE_KINDS,
} from './Query.js';
import {
  containsKeyword,
  countStatements,
  firstKeyword,
  stripCommentsAndStrings,
  stripTrailingSemicolon,
} from './sql-text.js';

export type ValidationOutcome =
  | { ok: true; query: ClassifiedQuery }
  | { ok: false; error: 'query_blocked' | 'syntax_error'; reason: string; hint?: string };

/** Statements that structurally change or endanger the database. */
const FORBIDDEN_KEYWORDS = [
  'drop',
  'truncate',
  'alter',
  'create',
  'grant',
  'revoke',
  'vacuum',
  'reindex',
  'cluster',
  'copy',
  'do',
  'call',
  'reset',
  'listen',
  'notify',
  'prepare',
  'execute',
  'deallocate',
  'discard',
  'lock',
  'comment',
  'security',
  'reassign',
  'refresh',
  'import',
] as const;

/** System catalogs that expose credentials or auth configuration. */
const BLOCKED_SYSTEM_TABLES = [
  'pg_shadow',
  'pg_authid',
  'pg_user_mapping',
  'pg_auth_members',
] as const;

const KIND_BY_KEYWORD: Record<string, StatementKind> = {
  select: 'select',
  values: 'select',
  table: 'select',
  with: 'select', // refined below: a CTE may wrap a write
  explain: 'explain',
  show: 'show',
  insert: 'insert',
  update: 'update',
  delete: 'delete',
  merge: 'update',
};

export interface QueryValidatorOptions {
  /** Extra table names to block beyond the built-in system catalogs. */
  blockedTables?: readonly string[];
}

export class QueryValidator {
  private readonly blockedTables: readonly string[];

  constructor(options: QueryValidatorOptions = {}) {
    this.blockedTables = [...BLOCKED_SYSTEM_TABLES, ...(options.blockedTables ?? [])];
  }

  /**
   * Validates SQL for the read path (query_db, explain_query, search_data).
   * Only read-only statements survive.
   */
  validateRead(rawSql: string): ValidationOutcome {
    const base = this.classify(rawSql);
    if (!base.ok) return base;

    const { query } = base;
    if (!query.isReadOnly) {
      const verb = query.kind.toUpperCase();
      return blocked(
        `${verb} statements are not allowed through the read-only query tool`,
        'Use the write_db tool, which requires explicit confirmation, for data modifications',
      );
    }
    return base;
  }

  /**
   * Validates SQL for the write path (write_db). Only plain INSERT / UPDATE /
   * DELETE statements are accepted — DDL is never available through MCP.
   */
  validateWrite(rawSql: string): ValidationOutcome {
    const base = this.classify(rawSql);
    if (!base.ok) return base;

    const { query } = base;
    if (!WRITE_KINDS.has(query.kind)) {
      if (query.isReadOnly) {
        return blocked(
          'write_db only accepts INSERT, UPDATE or DELETE statements',
          'Use query_db for read-only queries',
        );
      }
      return blocked(
        `${query.kind === 'ddl' ? 'DDL' : query.kind.toUpperCase()} statements are not allowed through MCPBridge`,
        'Schema changes must be made through your normal migration workflow',
      );
    }
    return base;
  }

  /** Shared classification + envelope checks used by both paths. */
  private classify(rawSql: string): ValidationOutcome {
    const sql = rawSql.trim();
    if (sql.length === 0) {
      return {
        ok: false,
        error: 'syntax_error',
        reason: 'Empty SQL statement',
        hint: 'Provide a SQL statement in the "sql" parameter',
      };
    }

    const stripped = stripCommentsAndStrings(sql);

    if (countStatements(stripped) > 1) {
      return blocked(
        'Multiple SQL statements in one request are not allowed',
        'Send each statement as a separate tool call',
      );
    }

    const keyword = firstKeyword(stripped);
    if (keyword.length === 0) {
      return {
        ok: false,
        error: 'syntax_error',
        reason: 'Could not find a SQL keyword at the start of the statement',
      };
    }

    for (const forbidden of FORBIDDEN_KEYWORDS) {
      if (containsKeyword(stripped, forbidden)) {
        return blocked(
          `${forbidden.toUpperCase()} statements are not allowed`,
          forbidden === 'drop' || forbidden === 'truncate' || forbidden === 'alter'
            ? 'Destructive schema operations are never available through MCPBridge'
            : undefined,
        );
      }
    }

    for (const table of this.blockedTables) {
      if (containsKeyword(stripped, table)) {
        return blocked(
          `Access to "${table}" is blocked`,
          'System catalogs containing credentials or auth configuration are not queryable',
        );
      }
    }

    let kind: StatementKind = KIND_BY_KEYWORD[keyword] ?? 'unknown';

    // A CTE (`WITH ... INSERT/UPDATE/DELETE`) can smuggle a write into what
    // looks like a read. If any write keyword appears anywhere in the
    // stripped text of a WITH statement, classify by that keyword instead.
    if (keyword === 'with') {
      for (const writeKeyword of ['delete', 'update', 'insert', 'merge'] as const) {
        if (containsKeyword(stripped, writeKeyword)) {
          kind = writeKeyword === 'merge' ? 'update' : writeKeyword;
          break;
        }
      }
    }

    // EXPLAIN wraps another statement; classify by the wrapped statement so
    // `EXPLAIN DELETE ...` is treated as a write (EXPLAIN ANALYZE executes it).
    if (kind === 'explain') {
      for (const writeKeyword of ['delete', 'update', 'insert', 'merge'] as const) {
        if (containsKeyword(stripped, writeKeyword)) {
          return blocked(
            'EXPLAIN of a write statement is not allowed (EXPLAIN ANALYZE would execute it)',
            'Use write_db to preview the impact of a write operation',
          );
        }
      }
    }

    if (kind === 'unknown') {
      return blocked(
        `Statement type "${keyword.toUpperCase()}" is not supported`,
        'Supported: SELECT / VALUES / WITH / EXPLAIN / SHOW (reads) and INSERT / UPDATE / DELETE (writes via write_db)',
      );
    }

    // Reads must not carry write keywords at all (e.g. `SELECT ... INTO`,
    // stray subselect tricks). Fail closed.
    if (READ_ONLY_KINDS.has(kind)) {
      for (const writeKeyword of ['insert', 'update', 'delete', 'merge', 'into'] as const) {
        if (containsKeyword(stripped, writeKeyword)) {
          return blocked(
            `Read-only statements must not contain "${writeKeyword.toUpperCase()}"`,
            'Use write_db for data modifications',
          );
        }
      }
    }

    return {
      ok: true,
      query: {
        sql: stripTrailingSemicolon(sql),
        stripped,
        kind,
        isReadOnly: READ_ONLY_KINDS.has(kind),
      },
    };
  }
}

function blocked(reason: string, hint?: string): ValidationOutcome {
  return { ok: false, error: 'query_blocked', reason, hint };
}
