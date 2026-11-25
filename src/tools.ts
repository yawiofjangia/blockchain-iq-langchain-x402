/**
 * LangChain tools for Blockchain IQ's x402 market-data API.
 *
 * Two tools, both parameter-free, built on the standard @langchain/core
 * `tool()` helper:
 *  - get_market_brief — the paid call ($0.01 USDC on Base). The opening
 *    call of a trading-agent loop: BTC/ETH/SOL/XRP with price and
 *    24h/7d/30d moves, scheduled events in the next 48h, and short risk
 *    flags. The response includes the on-chain payment transaction hash.
 *  - get_free_sample — the free Bitcoin-network sample, for testing the
 *    integration before any payment.
 *
 * The tools are constructed with the agent's viem account; the x402
 * payment client is built from that same account, so the payer is always
 * the wallet the agent is using. Spending is capped by the guard in
 * ./blockchainIq.ts (Base USDC only, the catalogue payTo only, max $2.00
 * per payment) — the tools never handle raw amounts.
 *
 * Usage (LangChain agent):
 *
 *   import { createBlockchainIqTools } from "./tools.js";
 *   const tools = createBlockchainIqTools(account);
 *   // pass `tools` to your agent / model.bindTools(tools)
 *
 * Or invoke a tool directly:
 *
 *   const [brief] = createBlockchainIqTools(account);
 *   await brief.invoke({});
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { PrivateKeyAccount } from "viem/accounts";
import {
  BRIEF_PRICE_USD,
  createPaymentFetch,
  fetchBrief,
  fetchFreeSample,
} from "./blockchainIq.js";

const EmptySchema = z.object({});

export const GetMarketBriefSchema = EmptySchema;
export const GetFreeSampleSchema = EmptySchema;

/**
 * Build the two Blockchain IQ tools for one viem account.
 * Returns [getMarketBrief, getFreeSample].
 */
export function createBlockchainIqTools(account: PrivateKeyAccount) {
  const fetchWithPayment = createPaymentFetch(account);

  const getMarketBrief = tool(
    async () => {
      const result = await fetchBrief(fetchWithPayment);
      return JSON.stringify(
        {
          action: "get_market_brief",
          payer: account.address,
          paid: true,
          priceUsd: BRIEF_PRICE_USD,
          paymentTxHash: result.paymentTxHash,
          payment: result.payment,
          data: result.data,
        },
        null,
        2,
      );
    },
    {
      name: "get_market_brief",
      description:
        "Fetch the Blockchain IQ market brief (x402, $0.01 USDC on Base): " +
        "BTC, ETH, SOL and XRP with price, 24h/7d/30d moves and rank, " +
        "scheduled events in the next 48 hours, and short risk flags. " +
        "The $0.01 is paid from the agent wallet via x402; the response " +
        "includes the on-chain payment transaction hash.",
      schema: GetMarketBriefSchema,
    },
  );

  const getFreeSample = tool(
    async () => {
      const result = await fetchFreeSample(fetchWithPayment);
      return JSON.stringify(
        {
          action: "get_free_sample",
          payer: account.address,
          paid: false,
          priceUsd: 0,
          data: result.data,
        },
        null,
        2,
      );
    },
    {
      name: "get_free_sample",
      description:
        "Fetch the free Blockchain IQ sample (no payment): Bitcoin network " +
        "activity for its latest day — transactions, active addresses and " +
        "fees. Use it to test the integration before paying for anything.",
      schema: GetFreeSampleSchema,
    },
  );

  return [getMarketBrief, getFreeSample] as const;
}
