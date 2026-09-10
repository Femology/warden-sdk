/**
 * Converts a decimal string amount (e.g. "150.00") into the on-chain i128
 * representation, given the reference asset's number of decimals. Pure
 * fixed-point string arithmetic -- this never routes through parseFloat or
 * Number, so it cannot lose precision the way float-based money math would.
 */
export function decimalToI128(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;

  if (!/^\d+(\.\d+)?$/.test(unsigned)) {
    throw new Error(`Invalid decimal amount: "${amount}"`);
  }

  const [wholePart, fractionalPart = ''] = unsigned.split('.');

  if (fractionalPart.length > decimals) {
    throw new Error(
      `Amount "${amount}" has more fractional digits than the configured ${decimals} decimals.`,
    );
  }

  const digits = `${wholePart}${fractionalPart.padEnd(decimals, '0')}`;
  const value = BigInt(digits);

  return negative ? -value : value;
}

/**
 * The inverse of decimalToI128: on-chain i128 -> decimal string, trimming
 * trailing zeros in the fractional part but never introducing a float.
 */
export function i128ToDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const unsigned = negative ? -value : value;

  const digits = unsigned.toString().padStart(decimals + 1, '0');
  const wholePart = digits.slice(0, digits.length - decimals);
  const fractionalPart = digits.slice(digits.length - decimals).replace(/0+$/, '');

  const result = fractionalPart.length > 0 ? `${wholePart}.${fractionalPart}` : wholePart;
  return negative ? `-${result}` : result;
}
