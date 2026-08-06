import Image from "next/image";

/**
 * The Spield mark, used in the nav and the footer.
 *
 * The artwork is a bare glyph on transparency rather than a badge, so
 * each theme needs its own ink: `main` is white (for the dark plate),
 * `maininverted` is black (for the light one). Both render and CSS
 * shows one — the swap keys off [data-theme], not prefers-color-scheme,
 * because the toggle is what actually drives the page.
 *
 * The sources are 4388px squares; next/image is what keeps a 26px logo
 * from shipping most of a megabyte of PNG.
 */
export default function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <Image
        className="logo-light"
        src="/logo/spieldlogomaininverted.png"
        alt=""
        width={size}
        height={size}
      />
      <Image
        className="logo-dark"
        src="/logo/spieldlogomain.png"
        alt=""
        width={size}
        height={size}
      />
    </span>
  );
}
