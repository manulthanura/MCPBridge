import { describe, expect, it } from 'vitest';
import { errorResponse, formatCell, markdownTable } from '../presentation/formatting.js';
import { extractSql } from '../../search/infrastructure/SamplingSqlGenerator.js';

describe('markdownTable', () => {
  it('renders rows with NULLs, dates and pipes safely', () => {
    const table = markdownTable(
      ['name', 'total', 'note'],
      [{ name: 'a|b', total: 12.5, note: null }],
    );
    expect(table).toContain('a\\|b');
    expect(table).toContain('12.50');
    expect(table).toContain('NULL');
  });

  it('handles empty result sets', () => {
    expect(markdownTable(['a'], [])).toBe('_(no rows)_');
  });

  it('handles multilingual data without mangling', () => {
    const table = markdownTable(['v'], [{ v: 'සිංහල 中文 🎉' }]);
    expect(table).toContain('සිංහල 中文 🎉');
  });
});

describe('errorResponse', () => {
  it('produces machine-readable JSON with isError set', () => {
    const response = errorResponse({
      code: 'query_blocked',
      reason: 'DROP statements are not allowed',
      hint: 'Use write_db',
    });
    expect(response.isError).toBe(true);
    const payload = JSON.parse(response.content[0]!.text);
    expect(payload.error).toBe('query_blocked');
    expect(payload.hint).toBe('Use write_db');
  });
});

describe('extractSql', () => {
  it('unwraps fenced SQL', () => {
    expect(extractSql('Here you go:\n```sql\nSELECT 1;\n```')).toBe('SELECT 1;');
  });

  it('drops prose before the first SQL keyword', () => {
    expect(extractSql('The query is: SELECT count(*) FROM orders')).toBe(
      'SELECT count(*) FROM orders',
    );
  });

  it('returns empty string when there is no SQL', () => {
    expect(extractSql('I cannot answer that')).toBe('');
  });
});
