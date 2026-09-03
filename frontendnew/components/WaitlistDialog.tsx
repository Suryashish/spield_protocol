"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight } from "@/components/icons";
import { SITE } from "@/lib/seo/site";

/**
 * The waitlist form, as a modal over whatever page you were reading.
 *
 * It is a dialog rather than a route because the ask is small and the page
 * behind it is the pitch — sending someone to /waitlist would make them leave
 * the argument to answer it, and then land them somewhere with no way back in.
 *
 * Two fields and nothing else. The name is what a launch email is addressed
 * to; the address is what it is sent to. Written to the page's own grammar:
 * mono uppercase labels over hairline-ruled fields, no boxes, because a boxed
 * input here would be the one framed thing on a site that frames nothing.
 *
 * It portals to <body>. The nav that owns it is `fixed z-30`, which is a
 * stacking context — nested inside it, the scrim would sit under the click-warp
 * layer at z-45 and could never cover the full page.
 */

type Status = "idle" | "sending" | "done";

/** Mirrors the API's own rule, so an obvious typo is caught before a round-trip. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

export default function WaitlistDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  /* Where focus was when the dialog opened, so closing puts it back on the
     button that opened it rather than at the top of the document. */
  const openerRef = useRef<HTMLElement | null>(null);

  const titleId = useId();
  const subId = useId();
  const nameId = useId();
  const emailId = useId();
  const emailHintId = useId();
  const errorId = useId();

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    onClose();
    openerRef.current?.focus?.();
  }, [onClose]);

  /* Open: remember the opener, reset any previous attempt, lock the page,
     and put the caret in the first field. */
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    setStatus("idle");
    setError(null);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    /* One frame, so the panel is visible before it takes focus — focusing a
       `visibility: hidden` element is a no-op and the caret lands nowhere. */
    const raf = requestAnimationFrame(() => nameRef.current?.focus());

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  /* Escape closes; Tab is trapped inside the panel. `aria-modal` alone tells a
     screen reader the page behind is inert but does nothing to the tab order,
     so without this, tabbing walks out of the dialog into the page under it. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href]',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "sending") return;

    const trimmedName = name.trim().replace(/\s+/g, " ");
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setError("Please enter your name.");
      nameRef.current?.focus();
      return;
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    setStatus("sending");
    setError(null);
    try {
      const res = await fetch(`${SITE.waitlistApi}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, email: trimmedEmail }),
      });

      /* 409 is treated as success but NOT shown differently. The API answers a
         repeat signup with the same 201 as a new one, deliberately — telling
         the page "that address is already on the list" would let anyone type a
         colleague's address into the form and be told whether that person had
         signed up. The status is still accepted here so the form keeps working
         against a backend that has not picked up that change yet. */
      if (res.ok || res.status === 409) {
        setEmail(trimmedEmail);
        setStatus("done");
        return;
      }

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setStatus("idle");
      setError(body?.error ?? "Something went wrong. Please try again.");
    } catch {
      /* fetch only rejects on a network-level failure — a 4xx or 5xx resolves,
         and is handled above. So this branch really is "we never got there". */
      setStatus("idle");
      setError("Couldn't reach the server. Check your connection and try again.");
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="wl-root" data-open={open ? "" : undefined} aria-hidden={!open}>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={close}
        /* The blur is the Tailwind utility, not a `backdrop-filter` in
           `.wl-scrim`. Lightning CSS rewrites a hand-written one to
           `-webkit-backdrop-filter` ONLY, and Chromium has since dropped that
           alias — the declaration reaches the browser and does nothing. The
           utility survives the same build intact, which is why the nav pill's
           frost still works and `.site-nav::before`'s no longer does. */
        className="wl-scrim backdrop-blur-[6px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subId}
        className="wl-panel"
      >
        <button type="button" onClick={close} className="wl-close" aria-label="Close">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M3.5 3.5l9 9M12.5 3.5l-9 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {status === "done" ? (
          <>
            <span className="wl-kicker">
              <span className="pulse-dot" aria-hidden="true" />
              You&rsquo;re on the list
            </span>

            <h2 id={titleId} className="wl-title">
              See you at the{" "}
              <span className="font-serif italic font-normal text-[1.04em] text-accent-text">
                open
              </span>
              .
            </h2>

            {/* aria-live so the outcome is announced, not just drawn: the
                heading changing under a screen reader is otherwise silent. */}
            <p id={subId} className="wl-sub" aria-live="polite">
              We&rsquo;ll email <strong className="font-medium text-ink">{email}</strong> the day
              Spield opens. One message, and nothing else.
            </p>

            <div className="wl-actions">
              <button type="button" onClick={close} className="wl-submit">
                Back to the site
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <span className="wl-kicker">
              <span className="pulse-dot" aria-hidden="true" />
              Join the waitlist
            </span>

            <h2 id={titleId} className="wl-title">
              Be here when the vault{" "}
              <span className="font-serif italic font-normal text-[1.04em] text-accent-text">
                opens
              </span>
              .
            </h2>

            <p id={subId} className="wl-sub">
              Leave your name and an address and we&rsquo;ll tell you the moment Spield goes
              live&nbsp;— one email, no newsletter.
            </p>

            <label className="wl-label" htmlFor={nameId}>
              Your name
            </label>
            <div className="wl-field">
              <input
                ref={nameRef}
                id={nameId}
                name="name"
                className="wl-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
                maxLength={80}
                required
              />
            </div>

            <label className="wl-label wl-label-2" htmlFor={emailId}>
              Your email
            </label>
            <div className="wl-field">
              <input
                id={emailId}
                name="email"
                type="email"
                className="wl-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ada@example.com"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                maxLength={254}
                aria-describedby={emailHintId}
                required
              />
            </div>
            <p id={emailHintId} className="wl-hint">
              Where we send the launch announcement.
            </p>

            {/* role="alert" rather than a live region: this only ever appears
                in response to something the person just did. */}
            {error ? (
              <p id={errorId} className="wl-error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="wl-actions">
              <button type="submit" className="wl-submit" disabled={status === "sending"}>
                {status === "sending" ? "Joining…" : "Join the waitlist"}
                {status === "sending" ? null : (
                  <span className="wl-arrow">
                    <ArrowRight size={15} />
                  </span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
