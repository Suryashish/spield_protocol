import { useState } from 'react';

/**
 * Network icons for the bridge, keyed by Allbridge `chainSymbol`.
 *
 * The Allbridge SDK exposes no logo URLs, so we map each supported chain to a CDN
 * SVG (Spot/Cryptocurrency-icons style) plus a branded fallback (colored disc with
 * the chain's initials) for when the image is missing or fails to load. This keeps
 * the bridge visually consistent without bundling image assets.
 */

type IconMeta = {
  /** Remote SVG url (best-effort). */
  src?: string;
  /** Short label drawn on the fallback disc. */
  short: string;
  /** Fallback disc background (brand-ish). */
  color: string;
};

// jsDelivr-hosted SVG logos (spothq/cryptocurrency-icons) by ticker.
const cdn = (ticker: string) =>
  `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${ticker}.svg`;

const ICONS: Record<string, IconMeta> = {
  ETH: { src: cdn('eth'), short: 'ETH', color: '#627EEA' },
  BSC: { src: cdn('bnb'), short: 'BNB', color: '#F3BA2F' },
  POL: { src: cdn('matic'), short: 'POL', color: '#8247E5' },
  ARB: { src: cdn('arb'), short: 'ARB', color: '#28A0F0' },
  AVA: { src: cdn('avax'), short: 'AVA', color: '#E84142' },
  CEL: { src: cdn('celo'), short: 'CEL', color: '#FCFF52' },
  OPT: { src: cdn('op'), short: 'OP', color: '#FF0420' },
  BAS: { short: 'BAS', color: '#0052FF' },
  SOL: { src: cdn('sol'), short: 'SOL', color: '#9945FF' },
  TRX: { src: cdn('trx'), short: 'TRX', color: '#EF0027' },
  SUI: { short: 'SUI', color: '#4DA2FF' },
  SRB: { src: cdn('xlm'), short: 'XLM', color: '#08B5E5' },
  STLR: { src: cdn('xlm'), short: 'XLM', color: '#08B5E5' },
  SNC: { short: 'SNC', color: '#FE6601' },
  UNI: { src: cdn('uni'), short: 'UNI', color: '#FF007A' },
  LIN: { short: 'LIN', color: '#121212' },
  ALG: { src: cdn('algo'), short: 'ALG', color: '#000000' },
  STX: { src: cdn('stx'), short: 'STX', color: '#5546FF' },
};

const meta = (chainSymbol: string): IconMeta =>
  ICONS[chainSymbol] ?? { short: chainSymbol.slice(0, 3), color: '#6B7280' };

/** Round network icon: remote logo with a colored-initials fallback. */
export const NetworkIcon = ({
  chainSymbol,
  size = 20,
}: {
  chainSymbol: string;
  size?: number;
}) => {
  const m = meta(chainSymbol);
  const [failed, setFailed] = useState(false);

  if (m.src && !failed) {
    return (
      <img
        src={m.src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: m.color,
        fontSize: Math.max(7, size * 0.34),
      }}
    >
      {m.short}
    </span>
  );
};
