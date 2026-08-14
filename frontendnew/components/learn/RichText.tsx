import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The markdown-lite the content model is authored in, as React elements.
 *
 * The old site serialised these to an HTML string and injected it with
 * dangerouslySetInnerHTML — it had to, because the same blocks were
 * rendered twice (React for the SPA, a Node script for the crawlers) and
 * a shared string serializer was the only way to be sure the two agreed.
 * Server rendering collapses that into one path, so the content can be
 * real elements: no injected HTML, no escaping to get wrong, and
 * internal links become <Link> and prefetch like the rest of the site.
 *
 * The grammar is deliberately four things — **bold**, *italic*, `code`,
 * [label](href) — and stays four things. Every block type in the model
 * is a real type; anything that wants richer structure should become a
 * block rather than more syntax to parse here.
 */

/** Split on the four inline forms, innermost last so nesting resolves. */
const TOKEN = /(\[[^\]]+\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;

export function RichText({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const m of text.matchAll(TOKEN)) {
    const i = m.index;
    if (i > last) out.push(text.slice(last, i));
    const tok = m[0];

    if (m[1]) {
      const cut = tok.indexOf("](");
      const label = tok.slice(1, cut);
      const href = tok.slice(cut + 2, -1);
      out.push(<Anchor key={key++} href={href} label={label} />);
    } else if (m[2]) {
      out.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    } else if (m[3]) {
      out.push(
        <strong key={key++}>
          <RichText text={tok.slice(2, -2)} />
        </strong>,
      );
    } else {
      out.push(
        <em key={key++}>
          <RichText text={tok.slice(1, -1)} />
        </em>,
      );
    }
    last = i + tok.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Anchor({ href, label }: { href: string; label: string }) {
  const external = /^https?:\/\//.test(href);
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        <RichText text={label} />
      </a>
    );
  }
  /* mailto:, tel: and bare #anchors are not routes — Link would try to
     prefetch them */
  if (!href.startsWith("/")) {
    return (
      <a href={href}>
        <RichText text={label} />
      </a>
    );
  }
  return (
    <Link href={href}>
      <RichText text={label} />
    </Link>
  );
}
