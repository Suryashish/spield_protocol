"use client";

import { useState } from "react";
import { SERIES, fmtInt, fmtUsd, quote } from "@/lib/series";
import { MAX_INPUT, PRESETS, TERMS } from "@/lib/vault";
import { useInView } from "@/lib/useInView";
import { ArrowRight } from "@/components/icons";
import Illustrative from "@/components/Illustrative";

/**
 * Section 3 — the Fixed-Rate Vault. The flagship, and the front door:
 * everything before this explains what the protocol does, and this is
 * where you find out what it does *for you*, as one number on one date.
 *
 * So the whole section is a single instrument: set an amount, pick a
 * maturity, and the payout is quoted — the largest thing in the
 * section, because it is the only thing the vault actually promises.
 * No PT, no YT, no chart. Those live either side of this section and
 * are named once at the bottom, as the thing you never have to touch.
 *
 * The one piece of behaviour worth the code is the decline. The vault
 * only quotes what it already holds the inventory to cover, so past a
 * series' capacity it says no — in plain words, with the amount that
 * would work and the date that would take it. Telling the truth about
 * a limit is more convincing than any claim about solvency, and it is
 * the one property of this product that a paragraph cannot demonstrate.
 */
export default function VaultSection() {
  const sectionRef = useInView<HTMLElement>(0.15);
  /* its own trigger — the section's `.in` fires while the statement is
     still most of a screen below the fold */
  const statementRef = useInView<HTMLDivElement>(0.25, "seen");

  const [termIndex, setTermIndex] = useState(0);
  const [amount, setAmount] = useState<number>(SERIES.deposit);
  /* what is in the field while it has focus. Held apart from `amount`
     so a half-typed "1" is not immediately reformatted as "1", and so
     an empty field can stay empty instead of snapping back to a zero. */
  const [typing, setTyping] = useState<string | null>(null);

  const term = TERMS[termIndex];
  const priced = amount > 0;
  const over = amount > term.capacity;
  const payout = quote(amount, term.rate, term.days);
  const gain = payout - amount;
  /* the later date that would take this deposit, if there is one — the
     second half of "try a smaller amount, or a later date" */
  const laterIndex = TERMS.findIndex((t, i) => i > termIndex && amount <= t.capacity);

  const take = (v: number) => {
    setAmount(Math.min(MAX_INPUT, Math.max(0, v)));
    setTyping(null);
  };

  /* Digits only, formatted as you go. USDC has cents, but this is an
     example of a deposit rather than a payment form, and whole numbers
     keep the field from ever showing a caret parked after a decimal
     point it is about to reject. */
  const onType = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 12);
    const n = digits ? Math.min(MAX_INPUT, Number(digits)) : 0;
    setAmount(n);
    setTyping(digits ? fmtInt(n) : "");
  };

  const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

  return (
    <section
      ref={sectionRef}
      id="vault"
      className="relative z-2 mx-auto max-w-[1220px] px-[clamp(20px,4vw,48px)] pb-[clamp(90px,12vh,150px)]"
      aria-label="The Fixed-Rate Vault"
    >
      {/* centred, like the two statements either side of it */}
      <div ref={statementRef} className="mx-auto max-w-[900px] text-center">
        <div className="blur-in" style={d(0)}>
          <span className="inline-flex items-center gap-[9px] rounded-full border border-line bg-surface/60 px-[15px] py-2 font-mono text-[11px] font-medium tracking-[0.14em] uppercase text-muted">
            <span className="pulse-dot" aria-hidden="true" /> The front door
          </span>
        </div>

        <h2
          className="blur-in mx-auto mt-[26px] max-w-[13em] text-balance font-display text-[clamp(34px,4.6vw,68px)] font-bold leading-[1.02] tracking-[-0.028em]"
          style={d(140)}
        >
          Know exactly what you&rsquo;ll{" "}
          <span className="font-serif italic font-normal text-[1.04em] text-accent-text">earn</span>.
        </h2>

        <p
          className="blur-in mx-auto mt-[18px] max-w-[40em] text-pretty text-[clamp(15.5px,1.3vw,18px)] leading-[1.6] text-muted"
          style={d(280)}
        >
          Set an amount, pick a date, and the vault quotes the{" "}
          <strong className="font-medium text-ink">exact figure</strong>&nbsp;that comes back
          &mdash; before you sign anything.
        </p>
      </div>

      {/* ---- the instrument: what you set, and what it is worth ---- */}
      <div className="vault io" style={d(120)}>
        <div className="vault-set">
          <label className="vault-label" htmlFor="deposit">
            You deposit
          </label>

          <div className="vault-field" data-over={String(over)}>
            <input
              id="deposit"
              className="vault-amount"
              /* the fallback width where field-sizing is unsupported —
                 roughly the widest preset, so USDC still sits beside
                 the figure rather than out at the column's edge */
              size={8}
              value={typing ?? (priced ? fmtInt(amount) : "")}
              onChange={(e) => onType(e.target.value)}
              onFocus={() => setTyping(priced ? fmtInt(amount) : "")}
              onBlur={() => setTyping(null)}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              placeholder="0"
              aria-label="Deposit amount, in USDC"
            />
            <span className="vault-unit">USDC</span>
          </div>

          <div className="vault-presets">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className="vault-chip"
                aria-pressed={amount === p}
                onClick={() => take(p)}
              >
                {fmtInt(p)}
              </button>
            ))}
          </div>

          {/* The capacity of the series, and how much of it this deposit
              would take. It is the reason the vault can decline, so it
              is on screen before the decline rather than as its excuse. */}
          <div className="vault-cap" data-over={String(over)}>
            <div className="vault-cap-track">
              <span
                className="vault-cap-fill"
                style={{ "--fill": `${Math.min(1, amount / term.capacity) * 100}%` } as React.CSSProperties}
              />
            </div>
            <p className="vault-cap-line">
              {over ? "Over this series’ remaining capacity" : "Capacity left in this series"}
              <span className="vault-cap-num">{fmtInt(term.capacity)} USDC</span>
            </p>
          </div>

          <label className="vault-label vault-label-2" id="maturity-label">
            Maturity
          </label>
          <div className="vault-terms-row" role="group" aria-labelledby="maturity-label">
            {TERMS.map((t, i) => (
              <button
                key={t.maturity}
                type="button"
                className="vault-term"
                aria-pressed={i === termIndex}
                onClick={() => setTermIndex(i)}
              >
                <span className="vault-term-date">{t.maturity}</span>
                <span className="vault-term-meta">
                  {t.rate.toFixed(2)}% &middot; {t.days}d
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ---- the quote ---- */}
        <div className="vault-out" data-state={over ? "declined" : priced ? "ok" : "empty"}>
          <div className="vault-out-head">
            <span className="vault-label">{over ? "The vault declines" : "You receive"}</span>
            <Illustrative />
          </div>

          {/* one live region for both states, so a screen reader hears
              the decline the same way it hears a number change */}
          <div className="vault-out-body" aria-live="polite">
            {over ? (
              <>
                <p className="vault-decline">We can&rsquo;t back this size today.</p>
                <p className="vault-decline-sub">
                  This series has{" "}
                  <strong className="font-medium text-ink">{fmtInt(term.capacity)} USDC</strong>{" "}
                  left. Take that, or move to a date with more room &mdash; the vault would rather
                  say no than quote a payout it can&rsquo;t already cover.
                </p>
                <div className="vault-fixes">
                  <button type="button" className="vault-chip" onClick={() => take(term.capacity)}>
                    Use {fmtInt(term.capacity)}
                  </button>
                  {laterIndex > -1 && (
                    <button
                      type="button"
                      className="vault-chip"
                      onClick={() => setTermIndex(laterIndex)}
                    >
                      Move to {TERMS[laterIndex].maturity}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="vault-payout">
                  {priced ? fmtUsd(payout) : "—"}
                  <span className="vault-payout-unit">USDC</span>
                </p>
                <p className="vault-on">
                  on <strong className="font-medium text-ink">{term.maturity}</strong>
                </p>
                <ul className="vault-facts">
                  <li>
                    <span className="vault-facts-key">Locked return</span>
                    <span className="vault-facts-val vault-facts-gain mono">
                      {priced ? `+${fmtUsd(gain)}` : "—"}
                    </span>
                  </li>
                  <li>
                    <span className="vault-facts-key">Fixed rate</span>
                    <span className="vault-facts-val mono">{term.rate.toFixed(2)}%</span>
                  </li>
                  <li>
                    <span className="vault-facts-key">Term</span>
                    <span className="vault-facts-val mono">{term.days} days</span>
                  </li>
                </ul>
              </>
            )}
          </div>

          {/* stood down rather than removed while the vault is declining:
              the action stays where it was, visibly waiting on the
              amount, instead of the column re-flowing around its hole */}
          <a
            className="btn btn-primary vault-cta"
            data-off={String(over)}
            href="#"
            aria-disabled={over || undefined}
            tabIndex={over ? -1 : undefined}
          >
            Open this position
            <ArrowRight />
          </a>
        </div>
      </div>

    </section>
  );
}
