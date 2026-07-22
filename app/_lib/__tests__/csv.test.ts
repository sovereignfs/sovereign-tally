import { describe, expect, it } from 'vitest';
import { buildCsv, escapeCsvField } from '../csv';

describe('escapeCsvField', () => {
  it('returns plain values unchanged', () => {
    expect(escapeCsvField('Groceries')).toBe('Groceries');
  });

  it('quotes and escapes a value containing a comma', () => {
    expect(escapeCsvField('Jamie, Sam')).toBe('"Jamie, Sam"');
  });

  it('quotes and doubles internal quotes', () => {
    expect(escapeCsvField('Say "hi"')).toBe('"Say ""hi"""');
  });

  it('quotes a value containing a newline', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('buildCsv', () => {
  it('joins rows with commas and CRLF, escaping as needed', () => {
    const csv = buildCsv([
      ['Type', 'Description', 'Amount'],
      ['Expense', 'Dinner, drinks', '42.50'],
    ]);
    expect(csv).toBe('Type,Description,Amount\r\n' + 'Expense,"Dinner, drinks",42.50\r\n');
  });

  it('returns an empty-but-terminated string for no rows', () => {
    expect(buildCsv([])).toBe('\r\n');
  });
});
