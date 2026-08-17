import logoInk from '@/assets/logo-ink.png';
import logoOnstage from '@/assets/logo-onstage.png';

/**
 * The Spield mark.
 *
 * The artwork is a bare glyph on transparency rather than a badge, so each
 * theme needs its own ink: the white one disappears on paper and the black one
 * disappears on the dark canvas. Both are rendered and CSS shows one — the
 * same `.brand-mark` mechanism, and the same two source files, as the
 * marketing site's `BrandMark`, so the two hosts show an identical logo.
 *
 * The swap keys off `[data-theme]`, not `prefers-color-scheme`, because the
 * header's toggle is what actually drives the page.
 */
const BrandMark = ({ size = 26 }: { size?: number }) => (
  <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
    <img className="logo-light" src={logoInk} alt="" width={size} height={size} />
    <img className="logo-dark" src={logoOnstage} alt="" width={size} height={size} />
  </span>
);

export default BrandMark;
