import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, Gauge, FileWarning } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAmount } from '@/lib/soroban';
import { SR_DEPLOYED } from '@/lib/config';
import { getDepositCap, getDepositHeadroom, getTotalAssets } from '@/lib/srstack';

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
      + 'the real, lower amount. Treat the displayed value as an upper bound, not a quote.',
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
    severity: 'medium',
    title: 'PT is a classic Stellar asset, and its issuer must stay locked',
    body:
      'Principal tokens are ordinary Stellar assets. The issuing account is locked at deployment so '
      + 'only the protocol can mint them — if that step were ever skipped or reversed, PT could be '
      + 'created that nothing backs. An off-chain monitor checks total PT supply against what the '
      + 'contracts have issued and alarms on any discrepancy.',
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

  const refresh = useCallback(async () => {
    if (!SR_DEPLOYED) return;
    const [c, h, a] = await Promise.all([getDepositCap(), getDepositHeadroom(), getTotalAssets()]);
    setCap(c);
    setHeadroom(h);
    setAssets(a);
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
