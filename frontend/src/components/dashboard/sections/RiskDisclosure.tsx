import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, Gauge, FileWarning } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAmount } from '@/lib/soroban';
import { SR_DEPLOYED, NETWORK_KEY } from '@/lib/config';
import {
  getDepositCap,
  getDepositHeadroom,
  getTotalAssets,
  getValueGap,
  fromScalar12,
  type SrValueGap,
} from '@/lib/srstack';

type Risk = {
  icon: typeof AlertTriangle;
  title: string;
  body: string;
  severity: 'high' | 'medium';
};

const RISKS: Risk[] = [
  {
    icon: ShieldAlert,
    severity: 'high',
    title: 'A deep bad-debt event at Blend freezes withdrawals, then costs you money',
    body:
      'Your deposit is supplied to Blend. If Blend takes losses, every state-changing call — '
      + 'withdrawals included — stops immediately. Balances stay readable throughout, so you can '
      + 'see the position; you just cannot move it. Clearing the freeze requires an action by '
      + 'Spield\u2019s admin, so how long it lasts depends on us, not on you. Once it is cleared, '
      + 'withdrawals reopen at the reduced value: the loss is shared in proportion to what you '
      + 'hold, and exiting first does not protect you. There is no fund that makes up a shortfall.',
  },
  {
    icon: AlertTriangle,
    severity: 'high',
    title: 'The quoted value of your position can exceed what it will actually pay',
    body:
      'Spield holds its exchange rate at its highest observed level and never marks it down. That '
      + 'keeps the rest of the protocol from repricing on a temporary dip, but it means that after '
      + 'a loss the number shown for your position is the old, higher one while a withdrawal pays '
      + 'the real, lower amount. Treat the displayed value as an upper bound, not a quote \u2014 '
      + 'the panel above compares it against what actually exists.',
  },
  {
    icon: AlertTriangle,
    severity: 'high',
    title: 'A Blend liquidity crunch delays exits, separately',
    body:
      'Even with backing intact, withdrawing requires Blend to have free liquidity. If borrowers '
      + 'have taken the supply, there may not be enough on hand to pay you at once. You can '
      + 'withdraw what is available and come back for the rest as liquidity returns — partial '
      + 'exits keep what they collect and never lose progress — but the remainder is not available '
      + 'until borrowers repay or new supply arrives, and nobody can promise when. This is a '
      + 'different and considerably more likely cause than the risk above.',
  },
  {
    icon: FileWarning,
    severity: 'high',
    title: 'These contracts have not been audited',
    body:
      'No independent party has reviewed this code. It carries an extensive internal test suite and '
      + 'a written self-assessment, and neither is a substitute for an audit. Treat any amount you '
      + 'deposit as at risk of total loss from a bug.',
  },
  {
    icon: Gauge,
    // On testnet the issuer is deliberately NOT locked, so this is the more serious risk there.
    severity: NETWORK_KEY === 'testnet' ? 'high' : 'medium',
    title:
      NETWORK_KEY === 'testnet'
        ? 'On testnet the PT issuer is NOT locked — anyone holding its key could mint unbacked PT'
        : 'PT is a classic Stellar asset, and its issuer must stay locked',
    body:
      NETWORK_KEY === 'testnet'
        ? 'Principal tokens are ordinary Stellar assets, and on mainnet the issuing account is '
          + 'locked at deployment so only the protocol can mint them. On testnet it is deliberately '
          + 'left unlocked so the stack can be redeployed, which means PT here is only as trustworthy '
          + 'as whoever holds that key. Treat testnet balances as a demonstration, never as value. An '
          + 'off-chain monitor still checks total PT supply against what the contracts have issued and '
          + 'alarms on any discrepancy.'
        : 'Principal tokens are ordinary Stellar assets. The issuing account is locked at deployment '
          + 'so only the protocol can mint them — if that step were ever skipped or reversed, PT could '
          + 'be created that nothing backs. An off-chain monitor checks total PT supply against what '
          + 'the contracts have issued and alarms on any discrepancy.',
  },
];

/**
 * **The risk disclosure — a product surface, not a footnote.**
 *
 * `tofix.md` #3 accepts a real residual: a deep Blend bad-debt event freezes withdrawals until an
 * admin clears the rate floor, after which the loss lands pro-rata on holders. It pairs that
 * acceptance with two required actions — cap the TVL, and
 * *publish the disclosure in user-facing docs, not only in the internal tracker*, on the grounds
 * that *"users cannot consent to a risk that is only recorded in an internal tracker."* This
 * component is that publication.
 *
 * Two decisions worth defending:
 *
 * * **It leads with the worst case, in plain words.** "Withdrawals stop and we cannot say for how
 *   long" is the honest sentence. Softening it into "temporary illiquidity under adverse
 *   conditions" would be the kind of writing that technically discloses and practically does not.
 * * **It shows the live TVL cap next to the risk it bounds.** The cap is the mitigation; a number
 *   the user can read makes it a commitment rather than a claim, and an uncapped protocol says so
 *   rather than quietly omitting the row.
 */
const RiskDisclosure = () => {
  const [cap, setCap] = useState<bigint | null>(null);
  const [headroom, setHeadroom] = useState<bigint | null>(null);
  const [assets, setAssets] = useState<bigint | null>(null);
  // `null` until the deployed contracts carry `realizable_rate`; the panel stays hidden until then.
  const [gap, setGap] = useState<SrValueGap | null>(null);

  const refresh = useCallback(async () => {
    if (!SR_DEPLOYED) return;
    const [c, h, a, g] = await Promise.all([
      getDepositCap(),
      getDepositHeadroom(),
      getTotalAssets(),
      getValueGap(),
    ]);
    setCap(c);
    setHeadroom(h);
    setAssets(a);
    setGap(g);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const capped = cap !== null && cap > 0n;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
          Risks you are taking
        </CardTitle>
        <CardDescription>
          The honest version. Read this before depositing — not after.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Gauge className="h-3.5 w-3.5" aria-hidden />
            Deposit cap
          </div>
          {capped ? (
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Cap</div>
                <div className="tabular-nums">{formatAmount(cap)} USDC</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Deployed</div>
                <div className="tabular-nums">{formatAmount(assets ?? 0n)} USDC</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Room left</div>
                <div className="tabular-nums">{formatAmount(headroom ?? 0n)} USDC</div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">No cap is currently set.</strong> The cap exists to
              bound the worst case above to an amount that could be absorbed off-protocol. Until one
              is set, that bound does not exist.
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            The cap is enforced on chain and gates deposits only — it can never block a withdrawal.
          </p>
        </div>

        {/* Quoted vs actual. Rendered ONLY once `realizable_rate` is live on chain — the same
            reasoning as the cap panel: a number the user can read makes the warning in the risk
            list below a measurement rather than a claim. A shortfall of zero is worth showing too,
            because "we checked, and today they agree" is the reassuring half of the same fact. */}
        {gap !== null && (
          <div
            className={
              gap.shortfallBps > 0
                ? 'rounded-lg border border-destructive/40 bg-destructive/5 p-3'
                : 'rounded-lg border bg-muted/30 p-3'
            }
          >
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <AlertTriangle
                className={gap.shortfallBps > 0 ? 'h-3.5 w-3.5 text-destructive' : 'h-3.5 w-3.5'}
                aria-hidden
              />
              Quoted value vs what actually exists
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Quoted rate</div>
                <div className="tabular-nums">{fromScalar12(gap.quoted).toFixed(6)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Actually backed</div>
                <div className="tabular-nums">{fromScalar12(gap.realizable).toFixed(6)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Shortfall</div>
                <div
                  className={
                    gap.shortfallBps > 0
                      ? 'tabular-nums font-medium text-destructive'
                      : 'tabular-nums'
                  }
                >
                  {(gap.shortfallBps / 100).toFixed(2)}%
                </div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {gap.shortfallBps > 0 ? (
                <>
                  <strong className="text-destructive">
                    Withdrawals currently pay {(gap.shortfallBps / 100).toFixed(2)}% less than the
                    displayed value.
                  </strong>{' '}
                  The quoted rate is a high-water mark and does not mark down. The loss is shared in
                  proportion to what you hold; exiting first does not avoid it.
                </>
              ) : (
                <>
                  The quoted rate is fully backed right now. This compares it against what the Blend
                  position actually holds, and keeps reporting during a freeze.
                </>
              )}
            </p>
          </div>
        )}

        <ul className="space-y-3">
          {RISKS.map((r) => {
            const Icon = r.icon;
            return (
              <li key={r.title} className="flex gap-3">
                <Icon
                  className={
                    r.severity === 'high'
                      ? 'mt-0.5 h-4 w-4 shrink-0 text-destructive'
                      : 'mt-0.5 h-4 w-4 shrink-0 text-amber-500'
                  }
                  aria-hidden
                />
                <div>
                  <div className="text-sm font-medium">{r.title}</div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{r.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};

export default RiskDisclosure;
