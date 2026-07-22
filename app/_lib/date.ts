/** Formats a Date as 'YYYY-MM-DD' using local date parts — never UTC, which
 *  can shift the date by a day depending on the user's timezone. */
export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parses a 'YYYY-MM-DD' string as a local-midnight Date. */
export function fromISODate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** Formats a Unix epoch-seconds timestamp as a short local date + time, for activity feeds. */
export function formatTimestamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
