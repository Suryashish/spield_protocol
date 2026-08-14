import { ILLUSTRATIVE_NOTE } from "@/lib/series";

/**
 * The marker that says a number is a worked example rather than a
 * reading off the chain.
 *
 * It is deliberately the page's own chrome and not a warning label:
 * mono, tracked, at the size of every other micro-caption, sitting
 * beside the figure it qualifies. What carries the meaning is the dot.
 * Live things on this page pulse on a filled dot — the ledger counter,
 * the section eyebrows — so this one is the same dot left hollow. Once
 * you have seen the pair you can read the page's honesty at a glance,
 * from across the room, without reading a word of it.
 *
 * `tone="stage"` is the version for the dark cards, where the paper
 * theme's --subtle would disappear.
 */
export default function Illustrative({
  label = "Illustrative",
  tone = "paper",
  className = "",
}: {
  /** override for places where a shorter word fits the line */
  label?: string;
  tone?: "paper" | "stage";
  className?: string;
}) {
  return (
    <span className={`illus illus-${tone} ${className}`.trim()} title={ILLUSTRATIVE_NOTE}>
      <span className="illus-dot" aria-hidden="true" />
      {label}
      {/* the full sentence, for anyone who cannot hover a tooltip */}
      <span className="sr-only"> — {ILLUSTRATIVE_NOTE}</span>
    </span>
  );
}
