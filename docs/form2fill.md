# Instaward 2: form answers, ready to paste

Budget: **$3,500**. Three deliverables, built from your seven points:

| Your point | Where it went |
|---|---|
| Multiple markets of different maturities at the same time | Deliverable 1 |
| Real trials with real users and real funds, supported by your own money | Deliverable 1, Week 4, budget note |
| Yield sources beyond Blend, focused on RWA | Deliverable 2 |
| Etherfuse USTRY integration | Deliverable 2 |
| Buy PT and YT with SR, and sell them for USDC or SR | Deliverable 3 |
| Bridge and deposit in one journey | Deliverable 3 |
| SDK config for mainnet | Deliverable 3 |

Text inside a `>` block is what you paste. Everything else is a note for you. Four things to
check are listed at the end.

---

# 2. Instawards Overview & Intent

Programme boilerplate. Leave it as it is on the form.

---

# 3. Problem Statement & Objective

## Problem Being Addressed

> Instaward 1 took Spield from a testnet build to a guarded launch on Stellar mainnet. Six
> contracts have been live since 1 September 2026 under a 2-of-3 multisig, USDC arrives from six
> EVM chains and Solana through Circle's CCTP, and the first fixed-rate series ran its full
> 30-day term on real USDC and matured on 30 September 2026.
>
> That first full term showed what still separates a working protocol from a product people can
> use. Spield today is one maturity, one yield source and one way in. Three scoped gaps follow:
>
> 1. **One maturity, and it has ended.** Each series has a maturity that is fixed permanently
>    at deployment, so a matured series refuses new deposits. There is no second series, and no
>    choice of term. As of today a new user cannot open a fixed-rate position on mainnet, and a
>    user who wants their money back in two weeks and one who can wait two months are offered
>    the same single date.
> 2. **One yield source, while Stellar's largest pool of yield is out of reach.** All of
>    Spield's yield comes from a single Blend pool. We checked the alternatives on chain: the
>    other lending pools that hold USDC are frozen or nearly empty, so a second lending source
>    is not available. Meanwhile tokenized real-world assets on Stellar have grown to more than
>    $3 billion, most of it treasury products paying a floating yield, and none of it can be
>    locked at a fixed rate or traded as a rate. Spield cannot reach it, because the protocol
>    accepts only USDC and speaks only to Blend.
> 3. **Getting in and out takes too many steps and allows only one currency.** A user coming
>    from another chain must bridge first and then start again to deposit. A user who already
>    holds Spield's SR token cannot use it to buy PT or YT, and anyone selling PT or YT can only
>    receive USDC. Builders have the same problem: the SDK is configured for testnet only, so
>    no wallet or app can offer Spield to its own users on mainnet.
>
> This is worth solving now because we are ready to begin trials with real users and real
> funds, supported from the team's own money. A trial needs something to deposit into, a term
> the user can choose, and a way in that does not lose them at the second step. The work is
> finite and builds on what Instaward 1 delivered: the deployment scripts, the multisig, the
> bridge, the app and the SDK already exist.

## Objective of This Instaward

> At the end of 30 days, Spield has more than one maturity open at the same time on Stellar
> mainnet and has begun trials with real users and real funds. Tokenized US Treasuries
> (Etherfuse USTRY) run through their full lifecycle as Spield's second yield source on
> testnet, and users can bridge and deposit in one journey, use SR as well as USDC to enter and
> exit, and reach Spield on mainnet through the SDK.

---

# 4. Scope of Work (30-Day Deliverables)

## 4.1 In-Scope Deliverables

### Deliverable 1

**Description (What will be built or produced?)**

> **Multiple maturities open at the same time on mainnet.**
>
> - **Repeatable series launch.** One scripted runbook that creates a fresh, self-locking PT
>   issuer, deploys and wires a series, seeds its Fixed-Rate Vault, verifies the result (wiring
>   checks, and the live code compared byte for byte with the built code), and hands admin to
>   the existing 2-of-3 multisig. Rehearsed on testnet first.
> - **Two series live on mainnet with different maturities**, a short term and a longer term
>   (for example 14 days and 30 days), each with its fixed rate set from Blend's current rate
>   through the existing on-chain gate that refuses a rate the yield source cannot fund. Each
>   runs under the Guarded Launch Cap.
> - **Multi-maturity app.** A series selector that shows every open series with its maturity
>   date and fixed rate side by side, and a redemption screen for matured series, including
>   Series 1.
> - **Real-fund trials.** Once both series are open, we begin trials with a small group of
>   real users depositing real USDC. Seed liquidity, coupon capacity and network fees for these
>   trials are paid from the team's own funds.

**Why this matters**

> A fixed-income product must always have a term open, and one term does not fit everyone.
> Today the only series has matured, so nobody can deposit. Two maturities side by side reopen
> the product, give depositors a real choice, and create the first on-chain yield curve on
> Stellar: a fixed rate for more than one date. Making the launch repeatable means there is
> never again a gap between one maturity and the next. And because the short series matures
> inside this sprint, trial users see a complete deposit-to-payout cycle with their own money
> within two weeks, which is the proof that matters most for an unaudited protocol.

---

### Deliverable 2

**Description (What will be built or produced?)**

> **A second yield source from real-world assets: Etherfuse USTRY (tokenized US Treasuries).**
>
> - **Treasury strategy adapter.** A new adapter behind Spield's existing yield-source
>   interface that holds a tokenized treasury asset. The target is Etherfuse USTRY, which is
>   live on Stellar mainnet, freely transferable, and already held by other smart contracts, so
>   no issuer permission is needed.
> - **Token-in deposits.** An extension of Spield's SR wrapper so that the token a user
>   deposits (the treasury token) and the unit of account (US dollars) can differ. Today Spield
>   assumes USDC in and USDC out. This is the change that lets any yield-bearing real-world
>   asset, not only a lending position, sit underneath a fixed rate.
> - **A rate feed that one trade cannot move.** The treasury token's value is read from a
>   standard Stellar oracle feed (SEP-40) and passed through Spield's existing guards: the rate
>   can never fall, and can never rise faster than a set annual ceiling. It never reads a DEX
>   price.
> - **Full lifecycle on testnet.** Deposit the treasury token, split it into PT and YT, take a
>   fixed-rate receipt, and redeem at maturity, on a short testnet series that matures inside
>   the sprint, using a test version of the token and the feed.
> - **Checked against the real asset.** The adapter's tests run against the real USTRY token
>   contract taken from mainnet, the way Spield's existing tests run against real Blend code. A
>   written mainnet plan states what must be true before a treasury series goes live.

**Why this matters**

> Tokenized real-world assets on Stellar have grown to more than $3 billion, yet very little of
> that value is active in DeFi. Holders of these assets earn a floating yield and have nothing
> else to do with them on chain. Spield is built to change that: it can turn a treasury token's
> floating yield into a fixed rate and a tradable yield token. This brings deeper liquidity to
> Spield from people who already hold these assets, ends our dependence on a single lending
> pool, and gives Stellar's real-world assets a new use. We prove it on testnet first for a
> reason. In February 2026 a lending pool on Stellar lost about $10 million when this class of
> asset was priced from a thinly traded market. The asset was not at fault; the price source
> was. This deliverable builds the bounded rate feed before any real money touches it.

---

### Deliverable 3 (optional)

**Description (What will be built or produced?)**

> **One journey in, flexible ways out, and mainnet access for builders.**
>
> - **Bridge and deposit in one journey.** A single guided flow that takes a user from USDC on
>   Ethereum, Base, Arbitrum, OP Mainnet, Polygon, Avalanche or Solana to an open fixed-rate
>   position on Stellar. The user chooses the amount and the maturity once; the app carries
>   them through the bridge transfer and the deposit, shows progress at each step, and resumes
>   where it stopped if the session is interrupted.
> - **Buy PT and YT with SR.** A user who already holds SR, Spield's yield-bearing wrapped
>   token, can use it directly to buy PT or YT, without first converting back to USDC.
> - **Choose what you receive when selling.** When selling PT or YT, the user chooses to
>   receive USDC or SR. Every route shows a quote and a minimum amount before signing.
> - **SDK configured for mainnet.** A new `@spield/sdk` release with a built-in mainnet
>   configuration alongside testnet, covering every live series, plus the SR and USDC routes
>   above. All mainnet transactions remain bounded by the on-chain Guarded Launch Cap.

**Why this matters**

> Every extra step is a place where a new user gives up. Today someone arriving from another
> chain must finish a bridge and then start a second process to deposit; one journey removes
> that break at exactly the point where trial users would be lost. Letting users pay with SR
> and be paid in SR keeps their money earning between trades and saves them a conversion each
> way, which matters most to active PT and YT traders. And a mainnet SDK is what allows
> wallets and other apps to offer Spield to their own users, so growth no longer depends only
> on people finding our app.

---

### Out-of-Scope (Explicitly Not Included)

> - **A live treasury series on mainnet.** The USTRY source is delivered on testnet and tested
>   against the real mainnet asset. Going live with real funds is the next step.
> - **Permissioned real-world assets** such as Ondo USDY, Franklin Templeton BENJI and the
>   Spiko funds. A contract needs the issuer's onboarding to hold them, which is not in our
>   control inside 30 days.
> - **Swapping USDC into treasury tokens inside the protocol.** Deposits into the treasury
>   series are made in the treasury token itself. Its on-chain market is too thin to route
>   user funds through safely.
> - **A second lending pool as a yield source.** No other pool on Stellar currently holds
>   enough USDC to serve as one.
> - **Raising or removing the Guarded Launch Cap.** Every mainnet series, and every trial,
>   runs under the cap.
> - **A professional security audit.** It is not part of this Instaward.
> - **Redemption of the longer series.** Its maturity falls after the sprint ends. The
>   lifecycle evidence comes from the short series and from Series 1.
> - **Automatic rollover from a matured series into a new one.** Users redeem and deposit
>   again through the app.
> - **Deep market liquidity and liquidity incentives.** These need pool depth that the cap
>   does not allow.
> - **The MoneyGram fiat on and off ramp, and a Tron route.** Both remain deferred.
> - **Seed liquidity, coupon capacity, network fees and trial support.** All are paid from the
>   team's own funds, not from grant funds.
> - **Any user-count or TVL target.** The trials start in this sprint; while deposits are
>   capped, totals are not a meaningful measure.

---

## 4.2 Deliverable-Aligned Budget Request

**Requested Budget Amount**

> $3,500

**Rationale for Budget Request**

> Covers 30 days of work by a two-developer team, allocated across the three deliverables in
> proportion to engineering effort.
>
> - **Deliverable 1, multiple maturities on mainnet: $1,250.** The repeatable series-launch
>   runbook, deployment and verification of two series, the multisig handover, the
>   multi-maturity app and redemption screen, and running the first real-fund trials.
> - **Deliverable 2, Etherfuse USTRY as a second yield source: $1,250.** The treasury strategy
>   adapter, the token-in extension of the SR wrapper, the bounded rate feed, the tests against
>   the real mainnet asset, and the full lifecycle on testnet.
> - **Deliverable 3, one journey in, flexible exits, mainnet SDK: $1,000.** The combined
>   bridge-and-deposit flow, the SR routes for buying and selling PT and YT, and the SDK
>   release with mainnet configuration.
>
> The grant funds engineering only. Seed liquidity, coupon capacity, on-chain deployment fees
> and the funds supporting the user trials all come from the team's own money.

---

# 5. 30-Day Execution Plan & Timeline

## 5.1 Weekly Breakdown

| Week | Planned Work | Expected Output |
|---|---|---|
| Week 1 | Build the repeatable series-launch runbook and rehearse a full launch on testnet. Fix both maturities and both rates before anything is deployed. Redeem Series 1 on mainnet. For the treasury source: settle the design in writing (how token-in deposits work, which rate feed is used) and begin the SR extension and the adapter. Begin the SR routes for buying and selling PT and YT. | A complete series launch rehearsed on testnet from one runbook. Maturities and rates decided. Series 1 redeem transaction published. Treasury design note written. |
| Week 2 | Launch both series on mainnet through the runbook: deploy, verify, seed (team-funded) and hand admin to the multisig. Ship the series selector and redemption screen. Complete the treasury adapter, the SR extension and the bounded rate feed, with tests, including the tests against the real mainnet token. Finish the SR routes in the app. | Two series with different maturities open on mainnet, verified, and under the multisig. The app showing both with their rates. Treasury contracts passing their tests. Users able to buy PT and YT with SR and sell for USDC or SR. |
| Week 3 | Ship the bridge-and-deposit journey and complete a real cross-chain deposit through it. Deploy the treasury series on testnet with a short maturity and make the first deposits. Add the mainnet configuration and the new routes to the SDK. Start the real-fund trials with the first users. | A real bridge-and-deposit completed on mainnet with transaction links. A treasury series live on testnet with deposits. SDK changes complete and tested. First trial deposits on mainnet. |
| Week 4 | The short mainnet series matures: trial users redeem. Redeem the matured treasury series on testnet, completing its lifecycle. Release the SDK. Write the mainnet plan for the treasury source. Record the demo and assemble the evidence. The last days are kept as a buffer. | A second full lifecycle completed on mainnet, by trial users. Treasury lifecycle complete on testnet. New SDK version on npm. Demo video and evidence package ready for Ambassador review. |

---

# 6. Evidence of Completion (Required)

## 6.1 Planned Evidence to Be Submitted

| Deliverable | Evidence Type | Description |
|---|---|---|
| Deliverable 1 | Explorer links, transaction links, live app URL, screenshot | The contract addresses of both mainnet series as links anyone can open in a Stellar explorer. The live app showing both maturities with their fixed rates. Deposit transactions into each series, including deposits from trial users' wallets. A redeem transaction on the short series after it matures, and the Series 1 redeem transaction. |
| Deliverable 2 | Testnet explorer and transaction links, test output, short screen recording, document | The treasury series contracts on testnet as explorer links. Testnet transactions for each step of the lifecycle: deposit of the treasury token, split into PT and YT, fixed-rate receipt, and redemption at maturity. The test run output, including the tests that run against the real USTRY token contract from mainnet. A short recording of the treasury flow in the app. The written mainnet plan. |
| Deliverable 3 | Transaction links, short screen recording, npm link | The source-chain and Stellar transactions of one real bridge-and-deposit, with a recording of the whole journey from another chain to an open position. Mainnet transactions showing PT and YT bought with SR, and PT or YT sold for SR and for USDC. The published `@spield/sdk` version with mainnet configuration, and a recording of its example reading live mainnet data. |

---

## Check these before you paste

1. **The SDK on mainnet reverses a line from Instaward 1.** That SOW listed mainnet SDK support
   as out of scope until an audit. The reviewer may remember. If asked, the answer is already in
   the text: every mainnet transaction is bounded by the on-chain cap, so the SDK cannot expose
   more than the app does.
2. **The USTRY source is on testnet, not mainnet.** I kept it there because I could not confirm
   a trustworthy price feed for USTRY on mainnet. If you find one in Week 1, a guarded mainnet
   series is a natural next Instaward. Do not promise it here.
3. **The "$3 billion" figure comes from press reports.** Check it on rwa.xyz before pasting.
4. **The scope is full.** I estimate about 7 of your 8 developer-weeks, with the treasury work
   the least certain. If you need slack, cut the bridge-and-deposit journey from Deliverable 3
   first; it is the item whose removal breaks nothing else.

Two smaller points. The trials are described without a number of users, on purpose: a count you
do not control should not become a deliverable. And the SR routes are cheaper than they look,
because the market already trades PT against SR directly and only the router and app are
USDC-only today.
