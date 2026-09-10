import { describe, expect, it } from 'vitest';
import { decimalToI128, i128ToDecimal } from '../src/codec.js';

describe('decimalToI128', () => {
  it('converts a whole number amount', () => {
    expect(decimalToI128('150', 7)).toBe(1_500_000_000n);
  });

  it('converts a fractional amount padded to the configured decimals', () => {
    expect(decimalToI128('150.5', 7)).toBe(1_505_000_000n);
  });

  it('converts an amount with the exact number of decimals', () => {
    expect(decimalToI128('0.0000001', 7)).toBe(1n);
  });

  it('converts zero', () => {
    expect(decimalToI128('0', 7)).toBe(0n);
  });

  it('converts a negative amount', () => {
    expect(decimalToI128('-150.25', 7)).toBe(-1_502_500_000n);
  });

  it('rejects an amount with more fractional digits than configured decimals', () => {
    expect(() => decimalToI128('1.12345678', 7)).toThrow();
  });

  it('rejects a non-numeric string', () => {
    expect(() => decimalToI128('abc', 7)).toThrow();
  });

  it('handles zero configured decimals', () => {
    expect(decimalToI128('42', 0)).toBe(42n);
  });
});

describe('i128ToDecimal', () => {
  it('converts a whole-number on-chain value back to a decimal string', () => {
    expect(i128ToDecimal(1_500_000_000n, 7)).toBe('150');
  });

  it('converts a fractional value, trimming trailing zeros', () => {
    expect(i128ToDecimal(1_505_000_000n, 7)).toBe('150.5');
  });

  it('converts zero', () => {
    expect(i128ToDecimal(0n, 7)).toBe('0');
  });

  it('converts a negative value', () => {
    expect(i128ToDecimal(-1_502_500_000n, 7)).toBe('-150.25');
  });

  it('handles zero configured decimals', () => {
    expect(i128ToDecimal(42n, 0)).toBe('42');
  });
});

describe('round trip', () => {
  it('preserves the value through decimalToI128 then i128ToDecimal', () => {
    const amounts = ['0', '1', '150.5', '0.0000001', '999999999.9999999'];
    for (const amount of amounts) {
      expect(i128ToDecimal(decimalToI128(amount, 7), 7)).toBe(amount);
    }
  });
});
