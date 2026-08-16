"use client";

import { useInView } from "@/lib/useInView";
import { BlendMark, StellarMark, UsdcMark } from "@/components/logos";

/**
 * What Spield is built on, at the seam between the hero and the argument.
 *
 * NOT A MARQUEE, deliberately. The old site scrolled these names in an infinite
 * loop, which is a device for a list too long to show at once — with a handful
 * it just announces that a handful was not enough. They fit on one row, so they
 * sit on one row.
 *
 * THREE ENTRIES, NOT FOUR. The old strip listed Soroban beside Stellar. That
 * name is retired: Stellar's own branding is "Stellar smart contracts" now, and
 * soroban.stellar.org redirects to developers.stellar.org — the word survives
 * only in the SDK and the developer docs, which is why no Soroban logo exists to
 * put here. Listing it as a separate ecosystem partner would be dating the page.
 * The corpus still teaches the term (the glossary entry, soroban-vs-evm) because
 * developers still search it; the ecosystem strip is not the place for it.
 *
 * Each name carries its role rather than standing alone. A bare logo wall asks
 * to be read as endorsement; naming the job each dependency does makes the same
 * point as a fact, which is the register the rest of the page is written in. The
 * roles use the same words as `lib/seo/facts.ts` (`yieldSource`, the USDC asset
 * role), so the page and the structured data cannot drift apart.
 *
 * The names link out. "Built on the Stellar ecosystem" is a claim about other
 * people's software, and a claim like that should be checkable in one click.
 */
const PARTNERS: {
  name: string;
  role: string;
  href: string;
  Mark: (p: { size?: number; className?: string }) => React.ReactElement;
  /** Optical size — see the note in components/logos.tsx. */
  size: number;
}[] = [
  {
    name: "Stellar",
    role: "Network & smart contracts",
    href: "https://stellar.org",
    Mark: StellarMark,
    /* the widest and lightest of the three — a two-stroke swoosh with a lot of
       air in it, so it needs the most box to carry the same weight */
    size: 24,
  },
  {
    name: "Blend",
    role: "Yield source",
    href: "https://blend.capital",
    Mark: BlendMark,
    /* the largest of the three despite being the smallest artwork: it is an
       illustrative mark (a jar), not a flat geometric one, and detail costs
       legibility at strip size in a way a two-stroke swoosh never pays */
    size: 27,
  },
  {
    name: "USDC",
    role: "Settlement asset",
    href: "https://www.circle.com/usdc",
    Mark: UsdcMark,
    /* a solid disc: the heaviest mark per pixel, so it is set smallest or it
       reads as a bullet point beside the other two */
    size: 19,
  },
];

export default function Partners() {
  /* Its own trigger: `.sheet` is thousands of pixels tall, so riding an
     ancestor's `.in` would fire this before it is anywhere near the viewport. */
  const ref = useInView<HTMLElement>(0.25);
  const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

  return (
    <section
      ref={ref}
      aria-label="Built on the Stellar ecosystem"
      /* pt clears the sheet's 32px lip so the strip reads as the first thing
         inside the panel rather than as something crowding its edge.

         pb was originally near-zero on the theory that the mechanism section
         below brings its own generous top padding. It does not bring enough:
         that section opens on 80px, so the seam measured 90px against 120px
         and 260px elsewhere, and the strip read as attached to the argument
         below it rather than as its own beat. */
      className="relative z-2 mx-auto max-w-[1220px] px-[clamp(20px,4vw,48px)] pt-[clamp(52px,7vh,92px)] pb-[clamp(24px,4vh,56px)]"
    >
      <p
        className="io text-center font-mono text-[10.5px] font-medium tracking-[0.18em] uppercase text-subtle"
        style={d(0)}
      >
        Built on the Stellar ecosystem
      </p>

      {/* gap-px over a `--line` background paints the hairlines BETWEEN cells
          and nowhere else: the children cover everything but the gaps, so there
          is no outer box to compete with the sheet's own rounded lip. Two
          columns on a phone, four from `sm` up.

          Narrower than the 1220px the other sections run to, on purpose. Across
          the full measure each name sits alone in ~305px of empty cell and the
          row reads as four separate things; pulled in, the four read as one
          statement — which is what a "built on" strip is. */}
      <ul className="mx-auto mt-[clamp(18px,3vh,30px)] grid max-w-[760px] grid-cols-1 gap-px bg-line sm:grid-cols-3">
        {PARTNERS.map(({ name, role, href, Mark, size }, i) => (
          <li key={name} className="io bg-canvas" style={d(90 + i * 80)}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col items-center gap-[7px] px-4 py-[clamp(16px,2.4vh,24px)] transition-colors duration-250 hover:bg-surface"
            >
              {/* Mark and name lift together on hover — two elements easing
                  separately reads as a glitch at this size.

                  The marks are desaturated at rest rather than recoloured. Only
                  Stellar's is monochrome artwork; USDC and Blend are full-colour
                  and Blend's cannot be flattened to one fill at all. A CSS
                  filter treats all three alike whatever they are made of, and
                  greyed-back it lets them sit inside the paper palette instead
                  of three foreign brand colours shouting over it. Hover returns
                  the real thing, one at a time, which is when accuracy matters
                  and when the visitor has asked for it. */}
              <span className="flex items-center gap-[9px] text-muted transition-colors duration-250 group-hover:text-ink">
                <Mark
                  size={size}
                  className="opacity-70 grayscale transition-[filter,opacity] duration-250 group-hover:opacity-100 group-hover:grayscale-0"
                />
                <span className="font-display text-[clamp(15.5px,1.5vw,19px)] font-bold tracking-[-0.02em]">
                  {name}
                </span>
              </span>
              <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-subtle">
                {role}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
