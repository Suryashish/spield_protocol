import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * The USDC-issuer picker the USTRY panels need and the Blend panels do not. It has no Blend twin
 * to borrow from, so it borrows the field well instead: same surface, radius and eyebrow as the
 * AmountField below it, with the native arrow replaced by the dashboard's chevron.
 */
export default function IssuerSelect({
  label,
  value,
  disabled,
  onChange,
  children,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="eyebrow">USDC asset</span>
      <span className="relative flex items-center">
        <select
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="well h-10 w-full min-w-0 cursor-pointer appearance-none truncate rounded-lg pl-3 pr-9 text-[13px] font-medium text-foreground transition-colors duration-200 hover:border-line-strong focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {children}
        </select>
        <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-3 text-subtle" />
      </span>
    </label>
  );
}
