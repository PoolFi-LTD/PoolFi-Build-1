import type { Usdc } from "./types";

/** Rate for turning Naira figures from the design into USDC: ₦1,400 = 1 USDC. */
export const NGN_PER_USDC = Number(process.env.NEXT_PUBLIC_NGN_PER_USDC ?? 1400);

/** A Naira figure from the design, in USDC rounded to the cent. */
export function fromNaira(naira: number): Usdc {
  return roundUsdc(naira / NGN_PER_USDC);
}

export function roundUsdc(value: number): Usdc {
  return Math.round(value * 100) / 100;
}

/** "1,234.50" */
export function formatAmount(value: Usdc): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1,234.50 USDC", "+1.43 USDC" with `sign`. */
export function formatUsdc(value: Usdc, options: { sign?: boolean } = {}): string {
  const sign = options.sign ? (value >= 0 ? "+" : "−") : value < 0 ? "−" : "";
  return `${sign}${formatAmount(Math.abs(value))} USDC`;
}

/** What each diver pays so the lifeguard still receives `amount` after the fee. */
export function grossShare(amount: Usdc, feeBps: number, covered: boolean): Usdc {
  if (!covered || feeBps <= 0) return roundUsdc(amount);
  // In whole cents, as the server works it out, so 1.90 at 5% is 2.00 and not 2.01.
  return Math.ceil((Math.round(amount * 100) * 10_000) / (10_000 - feeBps)) / 100;
}

/** The platform fee on `gross` as the contract takes it: rounded down to USDC's 7th decimal. */
export function feeOf(gross: Usdc, feeBps: number): Usdc {
  return Math.floor((Math.round(gross * 1e7) * feeBps) / 10_000) / 1e7;
}

/** A total only the lifeguard (and approvers) are sent; a dash for everyone else. */
export function amountOrDash(value: Usdc | null): string {
  return value === null ? "—" : formatUsdc(value);
}
