# Blockchain IQ x402 — LangChain Tools

Original [LangChain](https://github.com/langchain-ai/langchainjs) tools
for [Blockchain IQ](https://www.blockchainiq.co)'s pay-per-call
market-data API, paid with [x402](https://x402.org) (v2) in USDC on
Base. Built for the **Blockchain IQ x402 Build Bounties** round
($525 USDC on Base; first claim to pass their check gets $150, the next
three get $125 each; round closes 2026-12-31 23:59 Central; claims to
partnerships@blockchainiq.co).

## Why LangChain

The bounty offers one slot per framework; LangChain is the standard
agent-tooling choice — `createBlockchainIqTools(account)` returns two
plain `@langchain/core` tools that drop straight into any LangChain
agent (`model.bindTools(tools)`) or can be invoked directly. The
payment itself is done by the standard `@x402/fetch` client with an
`ExactEvmScheme` signer, so the x402 protocol handling is the public
library, not hand-rolled.

## Tools

| Tool | Cost | What it returns |
|---|---|---|
| `get_market_brief` | $0.01 USDC | BTC/ETH/SOL/XRP price, 24h/7d/30d moves and rank, events in the next 48h, short risk flags — plus the on-chain payment tx hash |
| `get_free_sample` | free | Bitcoin network activity for one day (transactions, active addresses, fees) |

Both are parameter-free. `get_free_sample` is the safe way to test the
integration before any payment.

## Install

```bash
npm install
```

Node 22+ required.

## Usage

```ts
import { privateKeyToAccount } from "viem/accounts";
import { createBlockchainIqTools } from "./tools.js";

const account = privateKeyToAccount("0x...");
const tools = createBlockchainIqTools(account);

// Drop into any LangChain agent:
//   const modelWithTools = model.bindTools(tools);
// Or invoke directly:
const briefJson = await tools[0].invoke({});
```

The wallet is a JSON keypair file `{ address, privateKey }`, passed by
path — it is **never** stored in this repo and never printed:

```bash
export BIQ_KEYPAIR_PATH=/path/to/base-wallet-keypair.json
```

### Demo / self-test (free — no payment is attempted)

```bash
npm run demo
```

The demo:
1. Builds the two LangChain tools and lists them.
2. Calls `get_free_sample` end to end against the live API. (If
   Blockchain IQ's own `/sample` endpoint answers HTTP 503 "Sample
   temporarily unavailable" — its Bitcoin figures are stale on their
   side — the demo records the step as SKIPPED and keeps verifying the
   paid path; any other failure aborts. Re-run after they refresh their
   figures.)
3. Dry-run inspects the paid endpoint: plain fetch to `/brief`, expects
   HTTP 402, decodes the `PAYMENT-REQUIRED` header and runs it through the
   spending guard — no wallet, no signature.
4. Replays the full 402 → sign → retry loop against a **localhost mock**
   (the real captured 402, only its `resource` URL rewritten to localhost).
   The mock records that a `PAYMENT-SIGNATURE` header arrived — its value
   is never logged — and answers 200. Nothing leaves the machine.

### The qualifying paid call (after the user's go-ahead)

```bash
npm run paid-brief -- --confirm-paid
```

Without `--confirm-paid` it only prints what it would do. With the flag it
first verifies the live catalogue still prices `/brief` at $0.01 with the
same payTo, then checks the wallet holds at least $0.01 USDC on Base
(read-only), and only then makes the one paid call. It prints the brief and
the payment tx hash and writes `paid-call-receipt.json` (the proof for the
claim email).

## Spending guard

`src/blockchainIq.ts` is the single chokepoint for all spending. Before
any signature is produced, `selectPaymentRequirements` only accepts a
payment requirement that is:

- scheme `exact`, network `eip155:8453` (Base),
- asset USDC on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, verified
  on-chain: name "USD Coin", symbol "USDC", 6 decimals),
- payTo exactly `0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e` (the address
  published in the Blockchain IQ catalogue),
- amount at most **$2.00** in a single payment.

Anything else throws and no payment happens. The integration only ever
calls the $0.01 `/brief` resource for its paid call.

## How x402 works here

1. `GET /api/x402/v1/brief` without payment → HTTP 402 with a
   `PAYMENT-REQUIRED` header (base64 JSON: network, amount, asset, payTo).
2. `@x402/fetch` parses it, the guard above approves it, and
   `ExactEvmScheme` signs an EIP-3009 `transferWithAuthorization`
   (off-chain signature, no gas).
3. The request is retried with a `PAYMENT-SIGNATURE` header; the server
   settles on-chain and answers 200 with a `PAYMENT-RESPONSE` header
   carrying the transaction hash. A 404 or any other error is never charged.

## Layout

```
src/
  blockchainIq.ts   x402 client layer + spending guard + 402 inspection
  tools.ts          createBlockchainIqTools — the two LangChain tools
  demo.ts           free self-test incl. localhost 402-loop simulation
  paid-brief.ts     the one paid call, with funding pre-checks
```

## Claim

After the paid call succeeds, send the claim email — see
`claim-email-draft.md` (repo URL + tx hash filled in from
`paid-call-receipt.json`, payout wallet `0x37712849AB48905dF878A3eC4FBa41B1373Dea5e`).
