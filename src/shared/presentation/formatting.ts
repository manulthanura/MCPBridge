/**
 * Interface layer: presentation helpers. Results are rendered as GitHub-
 * flavoured markdown tables — readable in every MCP client without further
 * processing (usability spec U-03).
 */
import { UseCaseError } from '../application/result.js';

const MAX_CELL_LENGTH = 200;

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && !Number.isInteger(value)) {
    // Monetary-looking floats read best with 2 decimals; full precision is
    // available via JSON if the caller needs it.
    return value.toFixed(2);
  }
  let text: string;
  if (typeof value === 'object') {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  } else {
    text = String(value);
  }
  text = text.replaceAll('|', '\\|').replaceAll('\n', ' ');
  return text.length > MAX_CELL_LENGTH ? `${text.slice(0, MAX_CELL_LENGTH)}…` : text;
}

export function markdownTable(fields: string[], rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '_(no rows)_';
  const columns = fields.length > 0 ? fields : Object.keys(rows[0]!);
  const header = `| ${columns.join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((c) => formatCell(row[c])).join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ [key: string]: unknown; type: 'text'; text: string }>;
  isError?: boolean;
}

export function textResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }] };
}

/** Errors are structured JSON so assistants can react programmatically. */
export function errorResponse(error: UseCaseError): ToolResponse {
  const payload: Record<string, unknown> = {
    error: error.code,
    reason: error.reason,
  };
  if (error.hint) payload.hint = error.hint;
  if (error.details) Object.assign(payload, error.details);
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}
