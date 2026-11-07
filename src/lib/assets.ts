/**
 * Asset display data for amounts in console objects (executions, reconciliation totals), which carry
 * base units + `asset_id` but no decimals. The console has no asset registry route among
 * `OPS_ROUTES` (spec change request: `listOpsAssets`, or `decimals` on `Execution` /
 * `ReconciliationTotals`), so it knows the v1 settlement assets below and shows any other asset as
 * exact base units with its id — never a guessed decimal point (INV-5).
 */
import { formatMoney } from "@nearpay-internal/ui";

export interface AssetDisplay {
  readonly symbol: string;
  readonly decimals: number;
  readonly network: string;
}

const KNOWN: Readonly<Record<string, AssetDisplay>> = {
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": {
    symbol: "USDC",
    decimals: 6,
    network: "NEAR",
  },
  "nep141:usdt.tether-token.near": { symbol: "USDT", decimals: 6, network: "NEAR" },
  "nep141:wrap.near": { symbol: "wNEAR", decimals: 24, network: "NEAR" },
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near": { symbol: "USDC", decimals: 6, network: "Base" },
  "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near": {
    symbol: "USDC",
    decimals: 6,
    network: "Ethereum",
  },
  "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near": {
    symbol: "USDC",
    decimals: 6,
    network: "Arbitrum",
  },
  "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near": { symbol: "USDC", decimals: 6, network: "Solana" },
  "nep141:eth.omft.near": { symbol: "ETH", decimals: 18, network: "Ethereum" },
  "nep141:base.omft.near": { symbol: "ETH", decimals: 18, network: "Base" },
};

export function assetDisplay(assetId: string): AssetDisplay | undefined {
  return KNOWN[assetId];
}

/** Short asset label: "USDC · Base", or the asset id's last segment for unknown assets. */
export function assetLabel(assetId: string): string {
  const a = KNOWN[assetId];
  if (a) return `${a.symbol} · ${a.network}`;
  const tail = assetId.replace(/^nep(141|245):/, "");
  return tail.length > 28 ? `${tail.slice(0, 12)}…${tail.slice(-10)}` : tail;
}

/**
 * "249.00 USDC" for known assets (exact, at least 2 fraction digits); "249000000 base units" for
 * unknown ones. Negative values (differences) keep their sign.
 */
export function formatAssetAmount(amount: bigint | string, assetId: string): string {
  const a = KNOWN[assetId];
  if (!a) return `${amount.toString()} base units`;
  return formatMoney({ amount, decimals: a.decimals, symbol: a.symbol, minFraction: 2 });
}
