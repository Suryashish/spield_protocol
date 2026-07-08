/**
 * Branded boot splash shown while a lazy route chunk (the dashboard) loads.
 *
 * It fills the viewport with the exact brand background (#020609) and a gently
 * pulsing logo, so the short wait while the heavy dApp bundle downloads reads as
 * "the app is opening" rather than a blank flash. Zero dependencies and inline
 * styles so it can render instantly as a Suspense fallback without pulling in any
 * of the code it's waiting for.
 */
export default function AppSplash() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#020609',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <img
        src="/logo-32.png"
        alt="Spield"
        width={44}
        height={44}
        style={{ animation: 'spieldSplashPulse 1.2s ease-in-out infinite' }}
      />
      <style>{`
        @keyframes spieldSplashPulse {
          0%, 100% { opacity: 0.45; transform: scale(0.96); }
          50%      { opacity: 1;    transform: scale(1.04); }
        }
      `}</style>
    </div>
  );
}
