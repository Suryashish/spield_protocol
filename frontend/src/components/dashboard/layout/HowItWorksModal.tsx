import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  Coins,
  Lock,
  ShieldCheck,
  TrendingUp,
  Droplets,
  Package,
  CalendarClock,
  ArrowRightLeft,
  Sparkles,
  Zap,
  ExternalLink,
  Layers,
  X,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

export type ExplainerStep = {
  icon: LucideIcon;
  title: string;
  body: string;
};

export type ExplainerConfig = {
  title: string;
  blurb: string;
  badge?: string;
  steps: ExplainerStep[];
  callout?: {
    icon: LucideIcon;
    title: string;
    body: string;
  };
};

export const EXPLAINER_CONFIGS: Record<string, ExplainerConfig> = {
  vault: {
    title: 'How the Fixed-Rate Vault works',
    blurb:
      'The simplest way to use Spield: deposit USDC, earn a fixed, known return — the PT/YT machinery is hidden underneath.',
    badge: 'Fixed Return · No Setup',
    steps: [
      {
        icon: Coins,
        title: '1 · Deposit USDC',
        body: 'Supply USDC to the Fixed-Rate Vault — no need to understand PT or YT.',
      },
      {
        icon: Lock,
        title: '2 · Lock the rate',
        body: 'You get a receipt for a fixed payout (principal + a fixed coupon) at maturity.',
      },
      {
        icon: ShieldCheck,
        title: '3 · Backed 1:1 by PT',
        body: 'The vault holds PT 1:1 against every payout, so the vault itself is never over-committed. PT redeems from the Blend position — backed 1:1 by on-chain assets.',
      },
      {
        icon: TrendingUp,
        title: '4 · Redeem at maturity',
        body: 'Redeem the receipt for your exact locked payout. The coupon is funded by the vault’s real Blend yield.',
      },
    ],
    callout: {
      icon: ShieldCheck,
      title: 'No trustlines or setup required',
      body: 'The vault holds the principal tokens backing your payout itself, so your wallet needs no trustlines — deposit and your rate is locked.',
    },
  },

  deposit: {
    title: 'How a deposit works',
    blurb:
      'Spield splits a yield-bearing deposit into a fixed-rate bond (PT) and a floating yield token (YT).',
    badge: 'Par Split · 1:1 Backing',
    steps: [
      {
        icon: Coins,
        title: '1 · Deposit USDC',
        body: 'Supply USDC. It is wrapped into SR — a yield-bearing share — and lent into the Blend pool, where it earns real on-chain interest.',
      },
      {
        icon: Lock,
        title: '2 · Get PT + YT',
        body: 'You receive equal PT (your principal, redeemable 1:1 at maturity) and YT (the yield claim).',
      },
      {
        icon: TrendingUp,
        title: '3 · Earn & claim',
        body: "As Blend's bRate rises, claim accrued yield against your YT — anytime, without burning it.",
      },
      {
        icon: ShieldCheck,
        title: '4 · Redeem',
        body: 'Redeem PT 1:1 at maturity, or recombine PT + YT to exit early at face. Backing is checked on every single state change.',
      },
    ],
    callout: {
      icon: Layers,
      title: 'Par value minting',
      body: '1 USDC mints 1 PT + 1 YT at exact par value with zero slippage and no AMM curve spread.',
    },
  },

  markets: {
    title: 'How the Market works',
    blurb:
      'A real yield AMM: PT prices are market-discovered and an implied APY falls out of the curve.',
    badge: 'Time-Decay AMM · Deep Liquidity',
    steps: [
      {
        icon: TrendingUp,
        title: 'Time-decay curve',
        body: 'PT trades below par and drifts to 1.0 as maturity nears — the discount is the yield. The curve makes that march automatic.',
      },
      {
        icon: Coins,
        title: 'Earn Fixed',
        body: 'Buy PT now with USDC and hold to maturity to lock the implied APY. The cheaper you buy, the higher your fixed return.',
      },
      {
        icon: Lock,
        title: 'Sell anytime',
        body: 'Need to exit early? Sell PT back to USDC at the live market price — no waiting for maturity.',
      },
      {
        icon: TrendingUp,
        title: 'Long Yield',
        body: 'Bet that real Blend yield beats the implied rate. Buy YT straight from the pool for a fraction of its face — the pool funds the rest and keeps the PT.',
      },
    ],
    callout: {
      icon: ShieldCheck,
      title: 'Pure on-chain pricing',
      body: 'Every price is calculated mathematically by the AMM curve without centralized oracles or liquidations.',
    },
  },

  liquidity: {
    title: 'How liquidity works',
    blurb:
      'Provide the two sides of the pool, earn fees on every PT trade, and exit on your terms.',
    badge: 'Low Impermanent Loss · Swap Fees',
    steps: [
      {
        icon: Droplets,
        title: '1 · Supply PT + USDC',
        body: 'Add liquidity in the pool’s current ratio. The pool’s second leg is SR, so the panel wraps your USDC for you automatically.',
      },
      {
        icon: Coins,
        title: '2 · Earn the swap fee',
        body: 'Every trade pays a fee that shrinks as maturity nears. LPs keep 80% of it; your shares grow as volume flows.',
      },
      {
        icon: ShieldCheck,
        title: '3 · Low impermanent loss',
        body: 'Because the time-decay curve tracks PT’s march to par, an LP who holds to maturity sees ~no IL on the predictable price move.',
      },
      {
        icon: Lock,
        title: '4 · Withdraw anytime',
        body: 'Burn your LP shares to take back a proportional slice of PT + SR — including fees earned — whenever you like.',
      },
    ],
    callout: {
      icon: Droplets,
      title: 'Fee distribution',
      body: 'Protocol swap fees accumulate directly inside the pool reserves, automatically increasing the redemption value of each LP share.',
    },
  },

  solvency: {
    title: 'Solvent by construction',
    blurb:
      'Why backing can never fall below principal — and how anyone can verify it on-chain.',
    badge: 'Invariant backing ≥ principal',
    steps: [
      {
        icon: ShieldCheck,
        title: 'Real Blend Collateral',
        body: 'Every deposit is supplied to Blend, Stellar’s leading lending protocol. Assets grow on-chain via rising bRate, not an IOU.',
      },
      {
        icon: Lock,
        title: 'Strict Invariant',
        body: 'The engine asserts the invariant "backing ≥ principal" after every single state mutation and reverts if violated.',
      },
      {
        icon: Coins,
        title: 'Yield Surplus Buffer',
        body: 'Accrued interest continuously provides an additional buffer above the outstanding principal tokens.',
      },
      {
        icon: ShieldCheck,
        title: 'No Relayers or Oracles',
        body: 'There is no off-chain yield index and no trusted relayer. The first claimant can never drain the vault.',
      },
    ],
    callout: {
      icon: ExternalLink,
      title: 'Publicly verifiable',
      body: 'Anyone can query the solvency() view function on Soroban to verify backing numbers and reserve health in real time.',
    },
  },

  v2: {
    title: 'How Yield works',
    blurb:
      'What YT actually earns — claimable straight to USDC in one signature without giving up the position.',
    badge: 'Variable Yield · Non-Destructive',
    steps: [
      {
        icon: Sparkles,
        title: 'Continuous interest',
        body: 'Holding YT accrues interest continuously against Blend’s rising supply index until the series matures.',
      },
      {
        icon: Coins,
        title: 'Non-destructive claim',
        body: 'Claiming yield does not burn your YT tokens. Your position continues earning variable yield until maturity.',
      },
      {
        icon: Lock,
        title: 'Single-signature settlement',
        body: 'The router claims accrued interest and unwraps it into USDC directly in a single transaction.',
      },
      {
        icon: ShieldCheck,
        title: 'Retained claims',
        body: 'Selling your YT credits the yield you have earned without stranding it; accrued yield remains claimable anytime.',
      },
    ],
    callout: {
      icon: Sparkles,
      title: 'Zero liquidation risk',
      body: 'YT is an asset, not a debt position — you can never be margin called or liquidated.',
    },
  },

  srwrap: {
    title: 'How SR Wrapper works',
    blurb:
      'Hold SR itself — a yield-bearing dollar with no maturity date, powered by Blend lending.',
    badge: 'Yield-Bearing Dollar · No Expiry',
    steps: [
      {
        icon: Package,
        title: 'Share Token Mechanics',
        body: 'SR is a share token whose redemption rate climbs continuously as Blend’s lending pool accrues interest.',
      },
      {
        icon: CalendarClock,
        title: 'No maturity date',
        body: 'Unlike PT and YT, SR has no fixed expiry. Hold it as long as you want to earn floating dollar yield.',
      },
      {
        icon: ArrowRightLeft,
        title: 'Instant wrap & unwrap',
        body: 'Convert USDC to SR or unwrap SR back to USDC at the exact live exchange rate with no term lockup.',
      },
      {
        icon: ShieldCheck,
        title: 'Foundation of Spield',
        body: 'Every PT and YT trade automatically interacts with SR under the hood; wrapping here lets you hold it directly.',
      },
    ],
    callout: {
      icon: TrendingUp,
      title: '1 SR ≠ 1 USDC',
      body: 'SR value equals balance × exchange rate. The rate only ever climbs, reflecting cumulative lending interest.',
    },
  },

  overview: {
    title: 'How Spield works',
    blurb:
      'Fixed-rate savings and yield tokenization on Stellar, backed 1:1 by real on-chain assets.',
    badge: 'DeFi Fixed Income on Stellar',
    steps: [
      {
        icon: Coins,
        title: '1 · Choose your strategy',
        body: 'Lock a predictable fixed return in the Vault, or split your deposit into PT (bond) and YT (yield) to trade.',
      },
      {
        icon: ShieldCheck,
        title: '2 · Backed by Blend',
        body: 'All principal is deposited into audited smart contracts on Stellar, earning real yield from borrowers.',
      },
      {
        icon: Lock,
        title: '3 · Mathematical Solvency',
        body: 'On-chain smart contracts guarantee backing always exceeds principal, preventing bank runs and undercollateralization.',
      },
      {
        icon: TrendingUp,
        title: '4 · Free to exit anytime',
        body: 'Trade PT and YT on the AMM or redeem at maturity at 1:1 par value whenever you are ready.',
      },
    ],
    callout: {
      icon: ShieldCheck,
      title: 'Institutional grade on Stellar',
      body: 'Fast settlement, sub-cent transaction fees, and native cross-chain USDC bridging via Circle CCTP.',
    },
  },

  bridge: {
    title: 'How CCTP Bridge works',
    blurb:
      'Native cross-chain USDC transfers powered by Circle’s Cross-Chain Transfer Protocol.',
    badge: 'Zero Slippage · Native USDC',
    steps: [
      {
        icon: Coins,
        title: '1 · Burn on source',
        body: 'USDC is burned on Ethereum, Arbitrum, Base, or Solana via official Circle contracts.',
      },
      {
        icon: ShieldCheck,
        title: '2 · Circle attestation',
        body: 'Circle’s attestation service cryptographically signs the burn verification once finality is reached.',
      },
      {
        icon: Lock,
        title: '3 · Mint on Stellar',
        body: 'Native USDC is minted directly into your Stellar wallet. Zero liquidity pool risk and zero bridge slippage.',
      },
      {
        icon: Zap,
        title: '4 · Fast finality',
        body: 'Optimized routes transfer native USDC across chains in minutes with low fees.',
      },
    ],
    callout: {
      icon: ShieldCheck,
      title: 'Native USDC',
      body: 'You receive canonical Circle USDC on Stellar, not a wrapped synthetic representation.',
    },
  },
};

export interface HowItWorksModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionId: string;
}

export const HowItWorksModal = ({
  open,
  onOpenChange,
  sectionId,
}: HowItWorksModalProps) => {
  const config = EXPLAINER_CONFIGS[sectionId] ?? EXPLAINER_CONFIGS.overview;
  const CalloutIcon = config.callout?.icon;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-stage/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content className="app-shell panel fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl p-6 shadow-lift data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
            <div className="min-w-0 pr-2">
              <div className="flex flex-wrap items-center gap-2">
                <DialogPrimitive.Title className="font-display text-[20px] font-semibold tracking-[-0.02em] sm:text-[22px]">
                  {config.title}
                </DialogPrimitive.Title>
                {config.badge && (
                  <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-brand-text">
                    {config.badge}
                  </span>
                )}
              </div>
              <DialogPrimitive.Description className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {config.blurb}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="Close dialog"
              className="-mr-1.5 -mt-1.5 grid size-8 shrink-0 place-items-center rounded-full text-subtle transition-colors duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X size={18} />
            </DialogPrimitive.Close>
          </div>

          {/* Steps 2-column grid */}
          <div className="grid gap-4 py-5 sm:grid-cols-2">
            {config.steps.map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.title}
                  className="well flex flex-col justify-between rounded-xl p-4 transition-colors hover:border-brand/30"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand-text">
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-display text-[14px] font-semibold text-foreground">
                        {step.title}
                      </h4>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                        {step.body}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Callout box if present */}
          {config.callout && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand/30 bg-brand/8 p-3.5 text-xs">
              {CalloutIcon && (
                <CalloutIcon size={16} className="mt-0.5 shrink-0 text-brand-text" />
              )}
              <div className="min-w-0">
                <span className="font-semibold text-foreground">
                  {config.callout.title}:{' '}
                </span>
                <span className="text-muted-foreground leading-relaxed">
                  {config.callout.body}
                </span>
              </div>
            </div>
          )}

          {/* Footer action */}
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-9 px-5 text-[13px] font-medium"
            >
              Got it
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default HowItWorksModal;
