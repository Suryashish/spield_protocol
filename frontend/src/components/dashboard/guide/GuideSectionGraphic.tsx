import React from 'react';
import { motion } from 'framer-motion';
import {
  Lock,
  Coins,
  TrendingUp,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  Zap,
  Percent,
  CheckCircle2,
  DollarSign,
  Droplets,
  Package,
} from 'lucide-react';

interface GraphicProps {
  type: 'overview' | 'vault' | 'deposit' | 'markets' | 'v2' | 'liquidity' | 'srwrap' | 'bridge';
}

/* ------------------------------------------------------------- 1. OVERVIEW */
const OverviewGraphic = () => {
  return (
    <div className="relative flex h-full min-h-[220px] flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-sunken/60 p-4 sm:p-5">
      {/* Top flow */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/10 px-3 py-1.5 shadow-sm">
          <DollarSign size={14} className="text-brand-text" />
          <span className="mono text-xs font-semibold text-brand-text">100 USDC</span>
        </div>

        <motion.div
          animate={{ x: [0, 6, 0] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
          className="text-subtle"
        >
          <ArrowRight size={16} />
        </motion.div>

        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm">
          <span className="pulse-dot" />
          <span>Blend Lending Pool</span>
        </div>
      </div>

      {/* Middle split paths */}
      <div className="grid grid-cols-3 gap-2 my-auto py-2">
        <motion.div
          whileHover={{ y: -2 }}
          className="flex flex-col items-center justify-center rounded-lg border border-border bg-card/80 p-2.5 text-center shadow-float-sm"
        >
          <div className="grid size-7 place-items-center rounded-md bg-brand/10 text-brand-text">
            <Lock size={13} />
          </div>
          <span className="mt-1 text-[11px] font-medium text-foreground">Fixed Vault</span>
          <span className="mono text-[10px] text-brand-text font-semibold">Locked APY</span>
        </motion.div>

        <motion.div
          whileHover={{ y: -2 }}
          className="flex flex-col items-center justify-center rounded-lg border border-border bg-card/80 p-2.5 text-center shadow-float-sm"
        >
          <div className="grid size-7 place-items-center rounded-md bg-ember/10 text-ember-text">
            <Coins size={13} />
          </div>
          <span className="mt-1 text-[11px] font-medium text-foreground">PT + YT Split</span>
          <span className="mono text-[10px] text-ember-text font-semibold">Par Mint</span>
        </motion.div>

        <motion.div
          whileHover={{ y: -2 }}
          className="flex flex-col items-center justify-center rounded-lg border border-border bg-card/80 p-2.5 text-center shadow-float-sm"
        >
          <div className="grid size-7 place-items-center rounded-md bg-accent text-foreground">
            <TrendingUp size={13} />
          </div>
          <span className="mt-1 text-[11px] font-medium text-foreground">Markets AMM</span>
          <span className="mono text-[10px] text-muted-foreground font-semibold">Discount Curve</span>
        </motion.div>
      </div>

      {/* Bottom verified proof pill */}
      <div className="flex items-center justify-between rounded-lg border border-brand/20 bg-brand/5 px-3 py-1.5 text-[11px]">
        <span className="flex items-center gap-1.5 text-brand-text font-medium">
          <ShieldCheck size={14} />
          <span>Mathematical Solvency</span>
        </span>
        <span className="mono text-[11px] font-semibold text-foreground">Backing ≥ 100%</span>
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- 2. VAULT */
const VaultGraphic = () => {
  return (
    <div className="relative flex h-full min-h-[220px] flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-sunken/60 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-muted-foreground">Fixed-Rate Vault Mechanism</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
          <Percent size={11} />
          <span>Guaranteed Payout</span>
        </span>
      </div>

      {/* Vault lock animation */}
      <div className="my-auto flex flex-col items-center justify-center gap-3 py-2">
        <div className="relative flex items-center justify-center">
          <motion.div
            animate={{ scale: [1, 1.05, 1], rotate: [0, 1, 0, -1, 0] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
            className="relative grid size-16 place-items-center rounded-2xl border border-brand/40 bg-card shadow-lift"
          >
            <Lock size={26} className="text-brand-text" />
            <motion.div
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="absolute -inset-1 rounded-2xl border border-brand/20 -z-10"
            />
          </motion.div>
        </div>

        {/* Floating Receipt */}
        <motion.div
          animate={{ y: [0, -3, 0] }}
          transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          className="w-full max-w-[260px] rounded-lg border border-border bg-card p-2.5 text-left shadow-sm"
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-foreground">Smart Receipt</span>
            <span className="mono text-brand-text font-bold">1:1 Backed</span>
          </div>
          <div className="mt-1 flex items-center justify-between mono text-[12px] text-muted-foreground">
            <span>Deposit: 1,000 USDC</span>
            <span className="font-bold text-foreground">→ 1,072 USDC</span>
          </div>
        </motion.div>
      </div>

      {/* Progress to maturity */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10.5px] text-muted-foreground">
          <span>Deposit Date</span>
          <span className="font-medium text-brand-text">Maturity Redeemable</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <motion.div
            animate={{ width: ['20%', '100%'] }}
            transition={{ repeat: Infinity, duration: 5, ease: 'linear' }}
            className="h-full rounded-full bg-brand"
          />
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------- 3. DEPOSIT */
const DepositGraphic = () => {
  return (
    <div className="relative flex h-full min-h-[220px] flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-sunken/60 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-muted-foreground">Par Minting Invariant</span>
        <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          0.00% Slippage
        </span>
      </div>

      {/* Split diagram */}
      <div className="my-auto flex flex-col items-center gap-2 py-1">
        {/* Input */}
        <div className="flex items-center gap-2 rounded-lg border border-brand/30 bg-card px-3.5 py-1.5 shadow-sm">
          <Coins size={14} className="text-brand-text" />
          <span className="mono text-xs font-bold text-foreground">100 USDC Deposited</span>
        </div>

        {/* Splitting beam */}
        <motion.div
          animate={{ scaleY: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="flex h-5 w-px bg-gradient-to-b from-brand/60 to-border"
        />

        {/* Two outputs */}
        <div className="grid w-full grid-cols-2 gap-3">
          <motion.div
            animate={{ x: [-2, 0, -2] }}
            transition={{ repeat: Infinity, duration: 2.5 }}
            className="rounded-lg border border-brand/30 bg-card p-2 text-center shadow-sm"
          >
            <div className="flex items-center justify-center gap-1 text-[11.5px] font-bold text-brand-text">
              <ShieldCheck size={13} />
              <span>100 PT</span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Fixed $1.00 at expiry</p>
          </motion.div>

          <motion.div
            animate={{ x: [2, 0, 2] }}
            transition={{ repeat: Infinity, duration: 2.5 }}
            className="rounded-lg border border-ember/30 bg-card p-2 text-center shadow-sm"
          >
            <div className="flex items-center justify-center gap-1 text-[11.5px] font-bold text-ember-text">
              <Sparkles size={13} />
              <span>100 YT</span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">100% of lending yield</p>
          </motion.div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/60 p-2 text-center text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">Recombine anytime: </span>
        100 PT + 100 YT = 100 USDC at face value
      </div>
    </div>
  );
};

/* -------------------------------------------------------------- 4. MARKETS */
const MarketsGraphic = () => {
  return (
    <div className="relative flex h-full min-h-[220px] flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-sunken/60 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-muted-foreground">Time-Decay AMM Price Drift</span>
        <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
          Implied APY: 6.8%
        </span>
      </div>

      {/* Curve simulation */}
      <div className="my-auto py-2">
        <div className="relative h-24 w-full rounded-lg border border-border bg-card/80 p-3">
          {/* Discount start */}
          <div className="absolute left-3 top-12 flex flex-col items-start">
            <span className="mono text-[11px] font-bold text-ember-text">$0.938</span>
            <span className="text-[9.5px] text-muted-foreground">Buy Discount</span>
          </div>

          {/* Maturity par */}
          <div className="absolute right-3 top-2 flex flex-col items-end">
            <span className="mono text-[11px] font-bold text-brand-text">$1.000 Par</span>
            <span className="text-[9.5px] text-muted-foreground">At Maturity</span>
          </div>

          {/* SVG trajectory curve */}
          <svg className="h-full w-full overflow-visible" viewBox="0 0 200 60">
            <path
              d="M 25 45 Q 110 40 180 15"
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2.5"
              strokeDasharray="4 2"
            />
            <motion.circle
              cx="25"
              cy="45"
              r="4"
              fill="var(--brand)"
              animate={{ cx: [25, 180, 25], cy: [45, 15, 45] }}
              transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
            />
          </svg>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-md border border-border bg-card px-2 py-1 text-center">
          <span className="text-muted-foreground">Buy PT: </span>
          <span className="font-semibold text-foreground">Lock Fixed APY</span>
        </div>
        <div className="rounded-md border border-border bg-card px-2 py-1 text-center">
          <span className="text-muted-foreground">Long YT: </span>
          <span className="font-semibold text-foreground">Speculate on Yield</span>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------- 5. YIELD */
const YieldGraphic = () => {
  return (
    <div className="relative flex h-full min-h-[220px] flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-sunken/60 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-muted-foreground">Accrued Interest Harvester</span>
        <span className="flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
          <Sparkles size={11} />
          <span>Non-Destructive</span>
        </span>
      </div>

      {/* Yield counter */}
      <div className="my-auto flex flex-col items-center justify-center gap-2 py-2">
        <div className="flex flex-col items-center">
          <span className="text-[11px] text-muted-foreground">Accrued Yield Available</span>
          <motion.div
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ repeat: Infinity, duration: 2.2 }}
            className="mono text-2xl font-bold tracking-tight text-brand-text sm:text-3xl"
          >
            +$48.72 USDC
          </motion.div>
        </div>

        {/* Claim button simulator */}
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-2 rounded-full border border-brand bg-brand px-4 py-1.5 text-xs font-semibold text-brand-contrast shadow-sm"
        >
          <Zap size={13} />
          <span>1-Signature Claim</span>
        </motion.div>
      </div>

      <div className="rounded-lg border border-border bg-card/60 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">YT tokens remain in wallet: </span>
        Keep generating variable yield until maturity date
      </div>
    </div>
  );
};

/* --------------------------------------------------------------- 6. LIQUIDITY */
const LiquidityGraphic = () => {
  return (
    <div className="relative flex h-full min-h-[220px] flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-sunken/60 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-muted-foreground">Liquidity Pool Mechanics</span>
        <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
          80% Fee Share to LPs
        </span>
      </div>

      {/* Dual leg pool balance */}
      <div className="my-auto py-2">
        <div className="flex items-center justify-between gap-2">
          <motion.div
            animate={{ y: [0, -3, 0] }}
            transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
            className="flex-1 rounded-lg border border-border bg-card p-2.5 text-center shadow-sm"
          >
            <div className="flex items-center justify-center gap-1 text-[11.5px] font-bold text-foreground">
              <ShieldCheck size={13} className="text-brand-text" />
              <span>PT Leg</span>
            </div>
            <p className="mt-0.5 mono text-[11px] text-muted-foreground">Principal Tokens</p>
          </motion.div>

          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-foreground text-xs font-bold">
            +
          </div>

          <motion.div
            animate={{ y: [0, 3, 0] }}
            transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
            className="flex-1 rounded-lg border border-border bg-card p-2.5 text-center shadow-sm"
          >
            <div className="flex items-center justify-center gap-1 text-[11.5px] font-bold text-foreground">
              <Droplets size={13} className="text-blue-500" />
              <span>SR Leg</span>
            </div>
            <p className="mt-0.5 mono text-[11px] text-muted-foreground">Wrapped USDC</p>
          </motion.div>
        </div>

        {/* Swap fee accumulation pill */}
        <div className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-brand/20 bg-brand/5 py-1.5 text-xs text-brand-text">
          <CheckCircle2 size={13} />
          <span>Swap fees accumulate automatically in your LP shares</span>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/60 p-1.5 text-center text-[10.5px] text-muted-foreground">
        Zero IL risk when LP is held until term maturity
      </div>
    </div>
  );
};

/* -------------------------------------------------------------- 7. SR WRAPPER */
const SrWrapGraphic = () => {
  return (
    <div className="relative flex h-full min-h-[220px] flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-sunken/60 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-muted-foreground">Yield-Bearing Dollar</span>
        <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
          No Expiry Date
        </span>
      </div>

      {/* Climbing exchange rate */}
      <div className="my-auto space-y-2 py-2">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-2.5 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-md bg-brand/10 text-brand-text">
              <Package size={14} />
            </div>
            <div className="text-left">
              <div className="text-[12px] font-semibold text-foreground">1 SR Exchange Rate</div>
              <div className="text-[10px] text-muted-foreground">Climbs as interest accrues</div>
            </div>
          </div>

          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="mono text-xs font-bold text-brand-text"
          >
            1.0584 USDC ↑
          </motion.div>
        </div>

        {/* Wrap & unwrap toggle */}
        <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <DollarSign size={12} className="text-brand-text" /> USDC
          </span>
          <ArrowRight size={13} />
          <span className="flex items-center gap-1 font-semibold text-foreground">
            <Package size={12} className="text-brand-text" /> SR Shares
          </span>
          <ArrowRight size={13} />
          <span className="flex items-center gap-1">
            <DollarSign size={12} className="text-brand-text" /> USDC
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/60 p-2 text-center text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">Instant liquidity: </span>
        Unwrap back to USDC at the live rate anytime without waiting
      </div>
    </div>
  );
};

/* ------------------------------------------------------- 8. BRIDGE & SOLVENCY */
const BridgeGraphic = () => {
  return (
    <div className="relative flex h-full min-h-[220px] flex-col justify-between overflow-hidden rounded-xl border border-border/70 bg-sunken/60 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-muted-foreground">Circle CCTP & Backing Proof</span>
        <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
          Canonical USDC
        </span>
      </div>

      {/* Cross-chain transfer animation */}
      <div className="my-auto space-y-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-center text-[11px] font-medium text-foreground">
            EVM / Solana
          </div>

          <motion.div
            animate={{ x: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 1.6 }}
            className="flex items-center gap-1 text-brand-text text-[11px] font-semibold"
          >
            <span>Circle CCTP</span>
            <ArrowRight size={14} />
          </motion.div>

          <div className="rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1.5 text-center text-[11px] font-bold text-brand-text">
            Stellar Native
          </div>
        </div>

        {/* Solvency status */}
        <div className="rounded-lg border border-border bg-card p-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">On-chain Invariant:</span>
            <span className="mono font-semibold text-brand-text">solvency() ≥ 100%</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-subtle">
            <span>Blend Collateral Reserves</span>
            <span className="text-foreground font-medium">Verified Every Block</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
        <ShieldCheck size={13} className="text-brand-text" />
        <span>No synthetic tokens · 100% verifiable on Soroban</span>
      </div>
    </div>
  );
};

export const GuideSectionGraphic: React.FC<GraphicProps> = ({ type }) => {
  switch (type) {
    case 'overview':
      return <OverviewGraphic />;
    case 'vault':
      return <VaultGraphic />;
    case 'deposit':
      return <DepositGraphic />;
    case 'markets':
      return <MarketsGraphic />;
    case 'v2':
      return <YieldGraphic />;
    case 'liquidity':
      return <LiquidityGraphic />;
    case 'srwrap':
      return <SrWrapGraphic />;
    case 'bridge':
      return <BridgeGraphic />;
    default:
      return <OverviewGraphic />;
  }
};

export default GuideSectionGraphic;
