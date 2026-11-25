/**
 * The qualifying paid call for the Blockchain IQ x402 Build Bounties round.
 *
 * Makes ONE paid call — GET /api/x402/v1/brief ($0.01 USDC on Base) —
 * through the LangChain get_market_brief tool, prints the brief and the
 * on-chain payment transaction hash, and writes paid-call-receipt.json
 * (the proof the claim email needs).
 *
 * SAFETY: this script refuses to run unless ALL of these hold:
 *  1. It is invoked with --confirm-paid (without the flag it only prints
 *     what it would do and exits).
 *  2. The live catalogue still prices /brief at $0.01 and still lists the
 *     same Base payTo address this integration was built against.
 *  3. The wallet holds at least $0.01 USDC on Base (read-only balance
 *     check via a public RPC; no transaction is sent by this script — the
 *     x402 facilitator settles the signed EIP-3009 authorization).
 * The payment itself is additionally capped by the guard in
 * ./blockchainIq.ts (Base USDC only, catalogue payTo only, max $2.00).
 *
 * Usage (after the user's go-ahead, wallet funded with >= $0.01 USDC on Base):
 *   BIQ_KEYPAIR_PATH=/path/to/keypair.json npm run paid-brief -- --confirm-paid
 */

import { readFileSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import {
  BASE_URL,
  BRIEF_PRICE_BASE_UNITS,
  BRIEF_PRICE_USD,
  CATALOG_PATH,
  PAY_TO,
  USDC_BASE,
} from "./blockchainIq.js";
import { createBlockchainIqTools } from "./tools.js";

const DRY_RUN = !process.argv.includes("--confirm-paid");

const keypairPath = process.env.BIQ_KEYPAIR_PATH;
if (!keypairPath) {
  console.error("Set BIQ_KEYPAIR_PATH to a JSON file with { address, privateKey }.");
  process.exit(1);
}
const keypair = JSON.parse(readFileSync(keypairPath, "utf8")) as {
  address: string;
  privateKey: `0x${string}`;
};
const account = privateKeyToAccount(keypair.privateKey);
console.log(`Wallet: ${account.address} (Base)`);
console.log(`Plan: ONE paid call, GET /api/x402/v1/brief, $${BRIEF_PRICE_USD} USDC -> ${PAY_TO}`);

if (DRY_RUN) {
  console.log(
    "\nDry run (no --confirm-paid): nothing was called and nothing was paid.\n" +
      "To make the real call after the user's go-ahead, run:\n" +
      "  npm run paid-brief -- --confirm-paid",
  );
  process.exit(0);
}

// --- Pre-check 1: the live catalogue must still agree with this build -----
const catalog = (await (
  await fetch(`${BASE_URL}${CATALOG_PATH}`)
).json()) as {
  paymentRails?: { networkName?: string; payTo?: string }[];
  data?: { id?: string; price?: string }[];
};
const baseRail = (catalog.paymentRails ?? []).find((r) => r.networkName === "base");
if ((baseRail?.payTo ?? "").toLowerCase() !== PAY_TO.toLowerCase()) {
  throw new Error(`catalogue payTo changed (${baseRail?.payTo}); aborting`);
}
const brief = (catalog.data ?? []).find((r) => r.id === "brief");
if (brief?.price !== `$${BRIEF_PRICE_USD}`) {
  throw new Error(`catalogue brief price changed (${brief?.price}); aborting`);
}
console.log("Pre-check 1 ok: catalogue still lists /brief at $0.01, same payTo.");

// --- Pre-check 2: the wallet must hold at least $0.01 USDC on Base --------
const publicClient = createPublicClient({ chain: base, transport: http() });
const usdcBalance = (await publicClient.readContract({
  address: USDC_BASE as `0x${string}`,
  abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
  functionName: "balanceOf",
  args: [account.address],
})) as bigint;
console.log(`Pre-check 2: USDC balance ${usdcBalance} base units ($${Number(usdcBalance) / 1e6})`);
if (usdcBalance < BRIEF_PRICE_BASE_UNITS) {
  console.log(
    `\nWallet unfunded for the $0.01 call (needs ${BRIEF_PRICE_BASE_UNITS} base units). ` +
      "Nothing was called and nothing was paid. Fund the wallet first.",
  );
  process.exit(0);
}

// --- The paid call, through the LangChain tool ------------------------------
const [briefTool] = createBlockchainIqTools(account);
const resultJson = (await briefTool.invoke({})) as string;
const result = JSON.parse(resultJson) as {
  paymentTxHash?: string | null;
  data?: unknown;
};
console.log("\nPaid call succeeded. Brief data:");
console.log(JSON.stringify(result.data, null, 2).slice(0, 2000));
console.log("\nPayment transaction hash:", result.paymentTxHash ?? "(none returned)");

const receipt = {
  resource: `${BASE_URL}/api/x402/v1/brief`,
  priceUsd: BRIEF_PRICE_USD,
  priceBaseUnits: BRIEF_PRICE_BASE_UNITS.toString(),
  network: "eip155:8453",
  asset: "USDC",
  payTo: PAY_TO,
  payer: account.address,
  paymentTxHash: result.paymentTxHash ?? null,
  timestamp: new Date().toISOString(),
};
writeFileSync(
  new URL("../paid-call-receipt.json", import.meta.url),
  JSON.stringify(receipt, null, 2),
);
console.log("\nReceipt written to paid-call-receipt.json — attach it to the claim email.");
