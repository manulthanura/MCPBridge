/**
 * Querying context: lexical helpers for SQL analysis.
 *
 * We never try to fully parse SQL in the domain layer — PostgreSQL is the
 * authority on syntax. What we need for safety decisions is a version of the
 * text with comments and string literals blanked out, so keyword scans can't
 * be fooled by `SELECT '...DROP TABLE...'` or trailing comments, and so an
 * attacker can't hide a second statement inside a literal.
 */

/**
 * Replaces the contents of comments, single-quoted strings and dollar-quoted
 * strings with spaces, preserving length and position of everything else.
 * Double-quoted identifiers are also blanked (an identifier named "delete"
 * must not trip the keyword scan).
 */
export function stripCommentsAndStrings(sql: string): string {
  const out: string[] = [];
  let i = 0;
  const n = sql.length;

  const blank = (count: number) => {
    for (let k = 0; k < count; k++) out.push(' ');
    i += count;
  };

  while (i < n) {
    const ch = sql[i]!;
    const next = i + 1 < n ? sql[i + 1] : '';

    // Line comment: -- to end of line
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') blank(1);
      continue;
    }

    // Block comment: /* ... */ (PostgreSQL allows nesting)
    if (ch === '/' && next === '*') {
      let depth = 0;
      do {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          blank(2);
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          blank(2);
        } else {
          blank(1);
        }
      } while (i < n && depth > 0);
      continue;
    }

    // Single-quoted string, with '' as escaped quote
    if (ch === "'") {
      out.push("'");
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          blank(2);
        } else if (sql[i] === "'") {
          out.push("'");
          i++;
          break;
        } else {
          blank(1);
        }
      }
      continue;
    }

    // Double-quoted identifier, with "" as escaped quote
    if (ch === '"') {
      out.push('"');
      i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          blank(2);
        } else if (sql[i] === '"') {
          out.push('"');
          i++;
          break;
        } else {
          blank(1);
        }
      }
      continue;
    }

    // Dollar-quoted string: $tag$ ... $tag$
    if (ch === '$') {
      const tagMatch = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        blank(end - i);
        continue;
      }
    }

    out.push(ch);
    i++;
  }

  return out.join('');
}

/**
 * Splits stripped SQL on semicolons and returns the non-empty statement
 * texts. Used to reject multi-statement payloads (classic injection vector).
 */
export function countStatements(strippedSql: string): number {
  return strippedSql
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
}

/** True if the stripped SQL contains the keyword as a standalone word. */
export function containsKeyword(strippedSql: string, keyword: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_])${keyword}([^A-Za-z0-9_]|$)`, 'i').test(strippedSql);
}

/** First keyword of the (stripped) statement, lowercased. */
export function firstKeyword(strippedSql: string): string {
  const match = /[A-Za-z_]+/.exec(strippedSql.replace(/^[\s(]+/, ''));
  return match ? match[0].toLowerCase() : '';
}

/** Removes a single trailing semicolon (and surrounding whitespace). */
export function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/, '').trim();
}
