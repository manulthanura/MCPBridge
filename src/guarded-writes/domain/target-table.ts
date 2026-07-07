/**
 * Writes context: extracts the table a write statement targets, for impact
 * previews and audit entries. Works on the raw SQL (identifiers may be
 * quoted) but only ever reads the token following the statement keyword.
 */
import { WriteKind } from '../../querying/domain/Query.js';

const IDENTIFIER = String.raw`((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))?)`;

const PATTERNS: Record<WriteKind, RegExp> = {
  insert: new RegExp(String.raw`\binsert\s+into\s+${IDENTIFIER}`, 'i'),
  update: new RegExp(String.raw`\bupdate\s+(?:only\s+)?${IDENTIFIER}`, 'i'),
  delete: new RegExp(String.raw`\bdelete\s+from\s+(?:only\s+)?${IDENTIFIER}`, 'i'),
};

export function extractTargetTable(sql: string, kind: WriteKind): string {
  const match = PATTERNS[kind].exec(sql);
  return match?.[1] ?? '(unknown)';
}
