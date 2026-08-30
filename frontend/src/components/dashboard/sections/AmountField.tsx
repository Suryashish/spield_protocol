import { useId } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The amount field — every "how much" control in the app.
 *
 * It replaces the pattern each panel had grown independently: a caption
 * floating above a 54px well holding a 14px number. Three things were wrong
 * with that. The label sat outside the thing it labelled, so the control read
 * as two objects. The field was shorter than the button under it, which put
 * the app's primary input below its confirmation in visual weight. And the
 * typed figure rendered SMALLER than the figure quoted back beside it, because
 * the Input primitive's `md:text-sm` out-specified the instance's size.
 *
 * Here the label and the balance are the field's own caption line, the figure
 * is display-size and tabular, the asset is a chip, and the whole shell takes
 * the focus ring — so it reads as one control that happens to contain a
 * number.
 *
 * The same component renders the read-only side of a swap (`onChange`
 * omitted), which is what keeps "you pay" and "you receive" a matched pair
 * rather than two boxes that resemble each other.
 */
export type AmountFieldProps = {
  /** The caption. Rendered as a real <label> bound to the input. */
  label: React.ReactNode;
  /** The asset the figure is in — a ticker, or any node (a token disc, say). */
  token?: React.ReactNode;
  value: string;
  /** Omit to render a read-only figure — the quoted side of a swap. */
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Wallet balance for this asset, e.g. "1,240.00 USDC". */
  balance?: string;
  /** Fills the field with the balance. Renders the Max button when given. */
  onMax?: () => void;
  /** A line under the figure — "PT · Principal", "+ 4.90 fixed coupon". */
  hint?: React.ReactNode;
  /** Colours the hint. `brand` is the fixed side, `ember` the variable one. */
  hintTone?: 'muted' | 'brand' | 'ember';
  /** Shows a spinner beside the figure while a quote is in flight. */
  loading?: boolean;
  /** Turns the field's rule red — over balance, over capacity, malformed. */
  invalid?: boolean;
  className?: string;
};

const HINT: Record<NonNullable<AmountFieldProps['hintTone']>, string> = {
  muted: 'text-muted-foreground',
  brand: 'text-brand-text',
  ember: 'text-ember-text',
};

const AmountField = ({
  label,
  token,
  value,
  onChange,
  placeholder = '0.0',
  disabled,
  balance,
  onMax,
  hint,
  hintTone = 'muted',
  loading,
  invalid,
  className,
}: AmountFieldProps) => {
  const id = useId();
  const editable = typeof onChange === 'function';
  const hasMeta = Boolean(balance || onMax);

  return (
    <div className={cn('field-shell', className)} data-invalid={invalid || undefined}>
      <div className="flex items-center justify-between gap-3">
        {/* The label is only capped when it has to share the line. On a field
            with no balance row it gets the full width, so "Fixed payout at
            maturity" reads out in a half-width column instead of clipping. */}
        <label
          htmlFor={editable ? id : undefined}
          className={cn('eyebrow truncate', hasMeta ? 'max-w-[52%] shrink-0' : 'min-w-0')}
        >
          {label}
        </label>

        {/* The balance is the part that gives way — the label names the field
            and Max is a target, so those two hold their size. A seven-figure
            balance with eight decimals is what a testnet faucet actually
            hands out, and it must not push the button out of the field. */}
        {(balance || onMax) && (
          <div className="flex min-w-0 items-center justify-end gap-2">
            {balance && (
              <span className="mono min-w-0 truncate text-[11px] text-muted-foreground">
                Bal {balance}
              </span>
            )}
            {onMax && (
              <button
                type="button"
                onClick={onMax}
                disabled={disabled}
                className="shrink-0 rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[9.5px] font-medium tracking-[0.12em] uppercase text-muted-foreground shadow-float-sm transition-colors duration-200 hover:border-brand/40 hover:text-brand-text disabled:pointer-events-none disabled:opacity-50"
              >
                Max
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-3">
        {editable ? (
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            autoComplete="off"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="field-figure"
          />
        ) : (
          <span className={cn('field-figure truncate', !value && 'text-subtle')} title={value}>
            {value || placeholder}
          </span>
        )}

        {loading && <Loader2 size={14} className="shrink-0 animate-spin text-subtle" />}
        {token && <span className="token-chip">{token}</span>}
      </div>

      {hint && (
        <p className={cn('mt-2 truncate text-[12px] font-medium', HINT[hintTone])}>{hint}</p>
      )}
    </div>
  );
};

export default AmountField;
