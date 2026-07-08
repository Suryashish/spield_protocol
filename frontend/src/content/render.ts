/**
 * Pure, framework-free serializers shared by the React runtime and the
 * prerenderer. No React, no DOM — just string transforms — so the exact same
 * output ships to browsers and to crawlers.
 */
import type { ContentBlock } from './types';

/** Turn a heading/term into a URL-safe anchor slug. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Markdown-lite → HTML for inline text. Supports **bold**, *italic*, `code`,
 * and [label](href). Escapes everything else. Internal links (starting with /)
 * render as-is; external links get rel + target for safety.
 *
 * Links are swapped out for placeholders BEFORE span formatting so that emphasis
 * which wraps a link — e.g. `**[PT](/x) is fixed**` — is matched correctly, then
 * the finished <a> tags are swapped back in. The `LINK<n>xEND` placeholder holds
 * no markdown- or HTML-active characters, so it survives escaping and span
 * formatting untouched and its shape cannot occur in real prose.
 */
export function renderInline(text: string): string {
  const links: string[] = [];
  const withPlaceholders = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_all, label: string, href: string) => {
    const external = /^https?:\/\//.test(href);
    const attrs = external
      ? ` href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"`
      : ` href="${escapeHtml(href)}"`;
    // The label may itself contain emphasis; format it now.
    links.push(`<a${attrs}>${formatSpans(label)}</a>`);
    return `LINK${links.length - 1}xEND`;
  });
  // Format spans over the whole string (emphasis can span placeholders).
  let out = formatSpans(withPlaceholders);
  // Swap finished links back in.
  out = out.replace(/LINK(\d+)xEND/g, (_all, i: string) => links[Number(i)]);
  return out;
}

function formatSpans(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

/** Plain-text projection of a block — used for reading time, meta, and the
 *  answer text fed into schema/AI summaries. */
export function blockToText(block: ContentBlock): string {
  const strip = (t: string) => t.replace(/[*`_]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  switch (block.type) {
    case 'paragraph':
    case 'quote':
      return strip(block.text);
    case 'heading':
      return block.text;
    case 'list':
      return block.items.map(strip).join(' ');
    case 'keyTakeaways':
      return block.items.map(strip).join(' ');
    case 'answerBox':
      return `${block.question} ${strip(block.answer)}`;
    case 'callout':
      return strip(block.text);
    case 'steps':
      return block.steps.map((s) => `${s.title} ${strip(s.text)}`).join(' ');
    case 'faq':
      return block.items.map((i) => `${i.q} ${strip(i.a)}`).join(' ');
    case 'table':
      return [...block.headers, ...block.rows.flat()].map(strip).join(' ');
    case 'code':
      return '';
  }
}

export function readingMinutes(blocks: ContentBlock[]): number {
  const words = blocks.map(blockToText).join(' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/**
 * Serialize a content block to semantic, GEO-friendly HTML. Heading blocks get
 * anchor ids; the answer-first paragraph gets data-answer; FAQ blocks get the
 * itemscope markup that reinforces FAQPage schema.
 */
export function blockToHtml(block: ContentBlock): string {
  switch (block.type) {
    case 'heading': {
      const id = block.id || slugify(block.text);
      const Tag = `h${block.level}`;
      return `<${Tag} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${renderInline(
        block.text,
      )}</${Tag}>`;
    }
    case 'paragraph':
      return `<p${block.lead ? ' data-answer="true"' : ''}>${renderInline(block.text)}</p>`;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return `<${Tag}>${block.items.map((i) => `<li>${renderInline(i)}</li>`).join('')}</${Tag}>`;
    }
    case 'table': {
      const head = `<thead><tr>${block.headers
        .map((h) => `<th>${renderInline(h)}</th>`)
        .join('')}</tr></thead>`;
      const body = `<tbody>${block.rows
        .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      const cap = block.caption ? `<caption>${renderInline(block.caption)}</caption>` : '';
      return `<div class="table-wrap"><table>${cap}${head}${body}</table></div>`;
    }
    case 'callout':
      return `<aside class="callout callout-${block.variant}">${
        block.title ? `<p class="callout-title">${renderInline(block.title)}</p>` : ''
      }<p>${renderInline(block.text)}</p></aside>`;
    case 'keyTakeaways':
      return `<section class="key-takeaways" aria-label="Key takeaways"><h2 id="key-takeaways">Key takeaways</h2><ul>${block.items
        .map((i) => `<li>${renderInline(i)}</li>`)
        .join('')}</ul></section>`;
    case 'answerBox':
      return `<div class="answer-box" data-answer="true"><p class="answer-q">${renderInline(
        block.question,
      )}</p><p class="answer-a">${renderInline(block.answer)}</p></div>`;
    case 'quote':
      return `<blockquote><p>${renderInline(block.text)}</p>${
        block.cite ? `<cite>${renderInline(block.cite)}</cite>` : ''
      }</blockquote>`;
    case 'steps':
      return `<ol class="steps">${block.steps
        .map(
          (s) =>
            `<li><p class="step-title">${renderInline(s.title)}</p><p>${renderInline(s.text)}</p></li>`,
        )
        .join('')}</ol>`;
    case 'faq':
      return `<div class="faq-list" itemscope itemtype="https://schema.org/FAQPage">${block.items
        .map(
          (i) =>
            `<div class="faq-item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question"><h3 itemprop="name">${renderInline(
              i.q,
            )}</h3><div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer"><div itemprop="text"><p>${renderInline(
              i.a,
            )}</p></div></div></div>`,
        )
        .join('')}</div>`;
    case 'code':
      return `<pre><code${
        block.language ? ` class="language-${block.language}"` : ''
      }>${escapeHtml(block.code)}</code></pre>`;
  }
}

export function blocksToHtml(blocks: ContentBlock[]): string {
  return blocks.map(blockToHtml).join('\n');
}

/** Build a table-of-contents from H2/H3 headings for the article rail. */
export function buildToc(blocks: ContentBlock[]): { id: string; text: string; level: number }[] {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'heading' }> => b.type === 'heading' && b.level <= 3)
    .map((b) => ({ id: b.id || slugify(b.text), text: b.text, level: b.level }));
}
