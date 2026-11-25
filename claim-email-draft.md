# Claim email — DRAFT (do not send until the paid call has succeeded)

To: partnerships@blockchainiq.co
Subject: x402 Build Bounty claim — LangChain integration (Blockchain IQ market brief)

Hi Jeremy,

Claiming one of the x402 Build Bounty slots with a LangChain tool
integration for the Blockchain IQ pay-per-call API.

- Framework: LangChain (tools)
- Public repository: [REPO_URL — fill in after publishing to GitHub]
- Resource called: GET https://www.blockchainiq.co/api/x402/v1/brief
  (the market brief, $0.01 USDC on Base, x402 v2)
- Paid-call transaction hash: [TX_HASH — fill in from paid-call-receipt.json]
- Payer wallet: 0x37712849AB48905dF878A3eC4FBa41B1373Dea5e (Base)
- Payout address (USDC on Base): 0x37712849AB48905dF878A3eC4FBa41B1373Dea5e

What the repo contains:
- `src/tools.ts` — createBlockchainIqTools with two @langchain/core tools:
  `get_market_brief` ($0.01, the qualifying paid call) and
  `get_free_sample` (free, for testing before paying).
- `src/blockchainIq.ts` — the x402 client layer built on the standard
  @x402/fetch + @x402/evm libraries, with a spending guard (Base USDC
  only, the catalogue payTo only, max $2.00 per payment).
- `src/demo.ts` — free self-test, including a localhost simulation of the
  full 402 → sign → retry loop.
- `src/paid-brief.ts` — the paid-call script with funding pre-checks.

The paid call above was made from the payer wallet through this
integration; the transaction hash is on Base and verifiable.

Thanks,
qingshanfeihu
