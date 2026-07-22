import { describe, expect, it } from 'vitest';
import { convertCentsWithRate, microsToRate, rateToMicros } from '../money';

describe('rateToMicros', () => {
  it('parses a typical exchange rate into micros', () => {
    expect(rateToMicros('1.0842')).toBe(1_084_200);
  });

  it('returns null for empty, zero, negative, or non-numeric input', () => {
    expect(rateToMicros('')).toBeNull();
    expect(rateToMicros('0')).toBeNull();
    expect(rateToMicros('-1')).toBeNull();
    expect(rateToMicros('abc')).toBeNull();
  });
});

describe('microsToRate', () => {
  it('round-trips back to a plain decimal string', () => {
    expect(microsToRate(1_084_200)).toBe('1.0842');
  });
});

describe('convertCentsWithRate', () => {
  it('converts a foreign-currency amount into the group currency', () => {
    // €100.00 at a rate of 1.0842 USD per EUR -> $108.42
    expect(convertCentsWithRate(10000, 1_084_200)).toBe(10842);
  });

  it('rounds to the nearest cent', () => {
    expect(convertCentsWithRate(333, 1_500_000)).toBe(500); // 3.33 * 1.5 = 4.995 -> 500
  });
});
