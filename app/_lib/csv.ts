/**
 * Minimal CSV formatting (RFC 4180-ish) — no external dependency needed for
 * a handful of known-shape rows. Escapes a field only when it needs it
 * (contains a comma, quote, or newline), quoting and doubling internal
 * quotes; otherwise returned as-is.
 */
export function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Joins rows (each an array of raw field values) into a CRLF-terminated CSV string. */
export function buildCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n') + '\r\n';
}
