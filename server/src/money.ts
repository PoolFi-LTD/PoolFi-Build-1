/** USDC on Stellar has 7 decimals: 1 USDC = 10,000,000 base units. */
export const USDC_DECIMALS = 7;
const SCALE = 10n ** BigInt(USDC_DECIMALS);
const I128_MAX = 2n ** 127n - 1n;
const DECIMAL = /^\d+(\.\d{1,7})?$/;

/** Parses a USDC amount such as "20" or "20.5" into base units. */
export function parseUsdc(value: string): bigint {
  if (!DECIMAL.test(value)) {
    throw new RangeError(`"${value}" is not a USDC amount with at most ${USDC_DECIMALS} decimals`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  if (units > I128_MAX) {
    throw new RangeError(`"${value}" is too large`);
  }
  return units;
}

/** Formats base units as a USDC amount without trailing zeros, e.g. 205000000n → "20.5". */
export function formatUsdc(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const abs = units < 0n ? -units : units;
  const fraction = (abs % SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${sign}${abs / SCALE}${fraction ? `.${fraction}` : ""}`;
}

export function isUsdcAmount(value: string): boolean {
  return DECIMAL.test(value);
}
