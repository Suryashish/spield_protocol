import type { ContentBlock } from "@/lib/content/types";
import { slugify } from "@/lib/content/render";
import { RichText } from "./RichText";

/**
 * The content model, rendered.
 *
 * Two things here are load-bearing beyond looking right.
 *
 * `data-answer` marks the paragraphs written to be lifted whole — the
 * answer box and any paragraph flagged `lead`. It is the same signal the
 * old site emitted and it costs nothing to keep.
 *
 * Headings carry stable ids derived from their text, which is what the
 * rail links to and what a citation deep-links to. They come from
 * `slugify`, not from the array index, so adding a section in the middle
 * of a guide does not silently break every link into it.
 */

export function Blocks({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </>
  );
}

function Block({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "heading": {
      const id = block.id || slugify(block.text);
      const Tag = `h${block.level}` as "h2" | "h3" | "h4";
      return (
        <Tag id={id}>
          <a className="anchor" href={`#${id}`} aria-label={`Link to “${block.text}”`}>
            #
          </a>
          <RichText text={block.text} />
        </Tag>
      );
    }

    case "paragraph":
      return (
        <p {...(block.lead ? { "data-answer": "true" } : {})}>
          <RichText text={block.text} />
        </p>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag>
          {block.items.map((item, i) => (
            <li key={i}>
              <RichText text={item} />
            </li>
          ))}
        </Tag>
      );
    }

    case "table":
      return (
        <div className="table-wrap">
          <table>
            {block.caption && (
              <caption>
                <RichText text={block.caption} />
              </caption>
            )}
            <thead>
              <tr>
                {block.headers.map((h, i) => (
                  <th key={i} scope="col">
                    <RichText text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>
                      <RichText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "callout":
      return (
        <aside className={`callout callout-${block.variant}`}>
          {block.title && (
            <p className="callout-title">
              <RichText text={block.title} />
            </p>
          )}
          <p>
            <RichText text={block.text} />
          </p>
        </aside>
      );

    case "keyTakeaways":
      return (
        <section className="takeaways" aria-labelledby="key-takeaways">
          <p className="takeaways-title" id="key-takeaways">
            Key takeaways
          </p>
          <ul>
            {block.items.map((item, i) => (
              <li key={i}>
                <RichText text={item} />
              </li>
            ))}
          </ul>
        </section>
      );

    case "answerBox":
      return (
        <div className="answer-box" data-answer="true">
          <p className="answer-q">
            <RichText text={block.question} />
          </p>
          <p className="answer-a">
            <RichText text={block.answer} />
          </p>
        </div>
      );

    case "quote":
      return (
        <blockquote>
          <p>
            <RichText text={block.text} />
          </p>
          {block.cite && (
            <cite>
              <RichText text={block.cite} />
            </cite>
          )}
        </blockquote>
      );

    case "steps":
      return (
        <ol className="steps">
          {block.steps.map((s, i) => (
            <li key={i}>
              <p className="step-title">
                <RichText text={s.title} />
              </p>
              <p>
                <RichText text={s.text} />
              </p>
            </li>
          ))}
        </ol>
      );

    case "faq":
      /* Rendered open, and rendered as real headings. The landing page
         collapses its FAQ because twelve rows there stand between the
         reader and the end of the page; inside a guide the questions are
         the page, and a reader this far down has already committed. */
      return (
        <div className="doc-faq">
          {block.items.map((item, i) => {
            const id = slugify(item.q);
            return (
              <div className="doc-faq-item" key={i}>
                <h3 className="doc-faq-q" id={id}>
                  <RichText text={item.q} />
                </h3>
                <p className="doc-faq-a">
                  <RichText text={item.a} />
                </p>
              </div>
            );
          })}
        </div>
      );

    case "code":
      return (
        <pre>
          <code className={block.language ? `language-${block.language}` : undefined}>
            {block.code}
          </code>
        </pre>
      );
  }
}
