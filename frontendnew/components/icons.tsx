/** Shared inline SVG icons — stroke/fill follow `currentColor`. */

export function ArrowRight({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="arrow" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ArrowDown({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4v16M6 14l6 6 6-6" />
    </svg>
  );
}

/** Padlock whose shackle closes via the `.locked` body class (see globals.css). */
export function DriftLock() {
  return (
    <span className="drift-lock inline-flex self-center mr-1.75 opacity-90" aria-hidden="true">
      <svg viewBox="0 0 22 27" className="block w-3.25 h-auto">
        <path className="shackle" d="M6 12V8.5a5 5 0 0 1 10 0V12" />
        <rect className="body" x="3" y="12" width="16" height="12" rx="3.5" />
      </svg>
    </span>
  );
}

export function SunIcon() {
  return (
    <svg
      className="icon-sun" width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg
      className="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  );
}
