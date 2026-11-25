/**
 * Blockchain IQ x402 client layer (original code).
 *
 * Talks to the pay-per-call market-data API at blockchainiq.co using the
 * public x402 protocol v2 (Base mainnet, USDC). The only money this module
 * can ever move is guarded by `selectPaymentRequirements`: it refuses to pay
 * unless the 402 asks for Base USDC, the exact payTo address published in
 * the catalogue, and at most $2.00 in a single payment.
 *
 * No account, no API key. A 402 means "pay and retry"; a 404 or any other
 * error is never charged.
 */

import {
  wrapFetchWithPaymentFromConfig,
  decodePaymentResponseHeader,
} from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import type { PrivateKeyAccount } from "viem/accounts";

export const BASE_URL = "https://www.blockchainiq.co";
export const CATALOG_PATH = "/api/x402/v1";
export const SAMPLE_PATH = "/api/x402/v1/sample";
export const BRIEF_PATH = "/api/x402/v1/brief";

/** x402 network for every payment here. */
export const NETWORK = "eip155:8453";
/** The only address this integration will ever pay, from the catalogue. */
export const PAY_TO = "0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e";
/** USDC on Base (6 decimals). Verified on-chain 2026-11-24: name "USD Coin", symbol "USDC". */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** The qualifying call: the parameter-free market brief. */
export const BRIEF_PRICE_USD = 0.01;
export const BRIEF_PRICE_BASE_UNITS = 10_000n;
/** Hard cap: no single payment above this, ever. */
export const MAX_PAYMENT_USD = 2.0;
export const MAX_PAYMENT_BASE_UNITS = 2_000_000n; // $2.00 in USDC base units

export interface PaymentAccept {
  scheme?: string;
  network?: string;
  amount?: string;
  asset?: string;
  payTo?: string;
  maxAmountRequired?: string;
  maxTimeoutSeconds?: number;
  resource?: string;
  description?: string;
  [key: string]: unknown;
}

export interface PaymentRequirementsDoc {
  x402Version?: number;
  accepts?: PaymentAccept[];
  error?: string;
  [key: string]: unknown;
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decode a PAYMENT-REQUIRED header value. x402 v2 sends base64url JSON;
 * tolerate a plain JSON value too.
 */
export function decodePaymentRequired(header: string): PaymentRequirementsDoc {
  const trimmed = header.trim();
  try {
    return JSON.parse(trimmed) as PaymentRequirementsDoc;
  } catch {
    return JSON.parse(base64UrlDecode(trimmed)) as PaymentRequirementsDoc;
  }
}

export function encodePaymentRequired(doc: PaymentRequirementsDoc): string {
  return base64UrlEncode(JSON.stringify(doc));
}

/**
 * Guard: does this one payment requirement describe a payment we are
 * willing to make? Returns the amount in USDC base units when it passes,
 * throws otherwise. This is the single chokepoint for all spending.
 */
export function validateAccept(accept: PaymentAccept): {
  amountBaseUnits: bigint;
  amountUsd: number;
} {
  if ((accept.scheme ?? "exact") !== "exact") {
    throw new Error(`refusing to pay: unexpected scheme ${accept.scheme}`);
  }
  if (accept.network !== NETWORK) {
    throw new Error(`refusing to pay: unexpected network ${accept.network}`);
  }
  if ((accept.payTo ?? "").toLowerCase() !== PAY_TO.toLowerCase()) {
    throw new Error(`refusing to pay: unexpected payTo ${accept.payTo}`);
  }
  if ((accept.asset ?? "").toLowerCase() !== USDC_BASE.toLowerCase()) {
    throw new Error(`refusing to pay: unexpected asset ${accept.asset}`);
  }
  const amount = BigInt(accept.amount ?? accept.maxAmountRequired ?? "0");
  if (amount <= 0n) {
    throw new Error(`refusing to pay: non-positive amount ${accept.amount}`);
  }
  if (amount > MAX_PAYMENT_BASE_UNITS) {
    throw new Error(
      `refusing to pay: amount ${amount} base units exceeds the $${MAX_PAYMENT_USD} cap`,
    );
  }
  return { amountBaseUnits: amount, amountUsd: Number(amount) / 1e6 };
}

/**
 * Payment-requirements selector handed to @x402/fetch. It runs before any
 * signature is produced: only a requirement that passes the guard is ever
 * paid, and the cheapest conforming one wins.
 */
export function selectPaymentRequirements(
  _version: number,
  accepts: PaymentAccept[],
): PaymentAccept {
  const conforming: { accept: PaymentAccept; amount: bigint }[] = [];
  for (const accept of accepts ?? []) {
    try {
      const { amountBaseUnits } = validateAccept(accept);
      conforming.push({ accept, amount: amountBaseUnits });
    } catch {
      // Not a payment we will make; skip it.
    }
  }
  if (conforming.length === 0) {
    throw new Error(
      "refusing to pay: no payment requirement passed the guard " +
        `(network ${NETWORK}, payTo ${PAY_TO}, max $${MAX_PAYMENT_USD})`,
    );
  }
  conforming.sort((a, b) => (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0));
  return conforming[0].accept;
}

/** Build the payment-aware fetch for one viem account. */
export function createPaymentFetch(account: PrivateKeyAccount): typeof fetch {
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: NETWORK,
        client: new ExactEvmScheme(account),
      },
    ],
    paymentRequirementsSelector: selectPaymentRequirements as never,
  });
}

export interface PaidCallResult {
  status: number;
  data: unknown;
  /** Decoded PAYMENT-RESPONSE header, when the server settled a payment. */
  payment: unknown | null;
  paymentTxHash: string | null;
}

function decodePaymentResponse(response: Response): {
  payment: unknown | null;
  txHash: string | null;
} {
  const header = response.headers.get("PAYMENT-RESPONSE");
  if (!header) return { payment: null, txHash: null };
  try {
    const decoded = decodePaymentResponseHeader(header) as Record<string, unknown>;
    const txHash =
      typeof decoded?.transaction === "string" ? decoded.transaction : null;
    return { payment: decoded, txHash };
  } catch {
    return { payment: { raw: header }, txHash: null };
  }
}

async function fetchJson(
  fetchFn: typeof fetch,
  url: string,
): Promise<PaidCallResult> {
  const response = await fetchFn(url, { method: "GET" });
  const { payment, txHash } = decodePaymentResponse(response);
  let data: unknown = null;
  const text = await response.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(
      `request to ${url} failed with HTTP ${response.status}`,
    ) as Error & { status: number; data: unknown };
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return { status: response.status, data, payment, paymentTxHash: txHash };
}

/** Free sample: Bitcoin network activity for one day. Never charges. */
export async function fetchFreeSample(
  fetchFn: typeof fetch,
): Promise<PaidCallResult> {
  return fetchJson(fetchFn, `${BASE_URL}${SAMPLE_PATH}`);
}

/**
 * The qualifying paid call: the parameter-free market brief ($0.01).
 * Through the wrapped fetch this does 402 -> sign -> retry automatically.
 * The guard in selectPaymentRequirements is what makes it safe to call.
 */
export async function fetchBrief(
  fetchFn: typeof fetch,
): Promise<PaidCallResult> {
  return fetchJson(fetchFn, `${BASE_URL}${BRIEF_PATH}`);
}

/**
 * Dry-run inspection of the paid endpoint: plain fetch, no wallet, no
 * signature. Expects HTTP 402 and returns the parsed + guard-validated
 * payment requirements, so the caller can prove what a paid call would
 * cost before any money moves.
 */
export async function inspectBriefPrice(): Promise<{
  status: number;
  rawPaymentRequiredHeader: string;
  requirements: PaymentRequirementsDoc;
  validated: { amountBaseUnits: bigint; amountUsd: number }[];
}> {
  const response = await fetch(`${BASE_URL}${BRIEF_PATH}`, { method: "GET" });
  if (response.status !== 402) {
    throw new Error(
      `expected HTTP 402 from ${BRIEF_PATH}, got ${response.status}`,
    );
  }
  const header = response.headers.get("PAYMENT-REQUIRED");
  if (!header) {
    throw new Error("402 response carried no PAYMENT-REQUIRED header");
  }
  const requirements = decodePaymentRequired(header);
  // The 402 offers two rails (Base + Solana). The guard only ever pays
  // the Base one, so validate the conforming requirements, not every
  // offered rail.
  const validated = (requirements.accepts ?? []).flatMap((a) => {
    try {
      return [validateAccept(a)];
    } catch {
      return [];
    }
  });
  if (validated.length === 0) {
    throw new Error(
      "402 offered no payment requirement this integration will pay " +
        `(network ${NETWORK}, payTo ${PAY_TO}, max $${MAX_PAYMENT_USD})`,
    );
  }
  return {
    status: response.status,
    rawPaymentRequiredHeader: header,
    requirements,
    validated,
  };
}
