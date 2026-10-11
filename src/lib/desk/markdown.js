/**
 * A small markdown renderer for the writing desk's live preview.
 *
 * The published page is rendered by Astro's markdown engine at build time; this
 * is the browser-side approximation shown while you type. It covers the subset
 * this blog actually uses — headings, paragraphs, lists, quotes, code, links,
 * images, tables, rules — and deliberately passes raw HTML straight through, so
 * the site's own inline styles keep working in the preview:
 *
 *   <span class="c-terracotta">terracotta</span>
 *   <mark class="hl-yellow">highlight</mark>
 *   <span class="f-playfair">Playfair</span>
 *
 * No dependencies: it runs in the browser bundle and in Node (for the tests).
 */

/* --------------------------------- helpers -------------------------------- */

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Only these tags are treated as block-level HTML and passed through verbatim. */
const BLOCK_TAG =
  /^<\/?(?:address|article|aside|blockquote|details|div|dl|dd|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|iframe|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul|img|picture|source|video|audio|span|mark|br|sup|sub)\b/i;

const INLINE_TAG = /^<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i;

/**
 * Inline rendering.
 *
 * Code spans and HTML tags are lifted out first so that escaping and emphasis
 * rules cannot touch them, then the plain text between them is escaped and
 * decorated, and finally the lifted pieces are put back.
 */
function inline(text) {
  const held = [];
  const hold = (html) => {
    held.push(html);
    return `\u0000${held.length - 1}\u0000`;
  };

  let source = String(text);

  /* Code spans — contents are escaped, never interpreted. */
  source = source.replace(/(`+)([\s\S]*?)\1/g, (_m, _ticks, code) =>
    hold(`<code>${escapeHtml(code.trim())}</code>`)
  );

  /* Explicit autolinks: <https://example.com> */
  source = source.replace(/<((?:https?|mailto):[^\s<>]+)>/g, (_m, url) => {
    const href = escapeHtml(url);
    return hold(`<a href="${href}" rel="noopener">${href}</a>`);
  });

  /* Raw HTML tags survive — the blog uses spans and marks for its pen colours.
     Scripts and styles are the exception: the preview shows them escaped, so
     nothing can run in the editor no matter what is pasted into the body. */
  source = source.replace(/<\/?[a-z][^<>]*>/gi, (tag) =>
    /^<\/?(?:script|style)\b/i.test(tag) ? hold(escapeHtml(tag)) : INLINE_TAG.test(tag) ? hold(tag) : tag
  );

  /* Everything left is text: escape it, then apply the inline rules. */
  let out = escapeHtml(source);

  /* Images before links — the leading "!" would otherwise be swallowed. */
  out = out.replace(/!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+&quot;([^&]*)&quot;)?\s*\)/g, (_m, alt, src, title) =>
    `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">`
  );

  out = out.replace(/\[([^\]]+)\]\(\s*([^\s)]+)(?:\s+&quot;([^&]*)&quot;)?\s*\)/g, (_m, label, href) => {
    const external = /^(https?:)?\/\//i.test(href) || href.startsWith('mailto:');
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });

  /* Bare web addresses become links, as they do on the published page. */
  out = out.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+[^\s<).,;:!?'"])/g, (_m, before, url) =>
    `${before}<a href="${url}" target="_blank" rel="noopener">${url}</a>`
  );

  out = out
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/(\*|_)(?=\S)([^*\n]*?\S)\1/g, '<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');

  /* Two trailing spaces (or a backslash) mean a hard line break. */
  out = out.replace(/( {2,}|\\)\n/g, '<br>\n');

  return out.replace(/\u0000(\d+)\u0000/g, (_m, index) => held[Number(index)]);
}

/* ---------------------------------- lists --------------------------------- */

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

/**
 * Renders one list block. `lines` are the raw lines belonging to the list,
 * starting at column 0 of the outermost items.
 *
 * A list is "loose" when blank lines separate its items — then each item is a
 * paragraph. Tight lists keep their items bare, which is what the published page
 * does, so the preview's spacing matches.
 */
function renderList(lines) {
  const items = [];
  let current = null;
  let indent = 0;

  for (const line of lines) {
    const match = LIST_ITEM.exec(line);
    if (match && match[1].length <= indent) {
      if (current) items.push(current);
      indent = match[1].length;
      current = { marker: match[2], ordered: /\d/.test(match[2]), text: [match[3]], loose: false };
    } else if (current) {
      if (!line.trim()) current.loose = true;
      /* Continuation lines and nested lists keep their relative indentation. */
      current.text.push(line.slice(Math.min(indent + 2, line.length - line.trimStart().length)));
    } else {
      /* A stray line before the first item — keep it rather than lose writing. */
      current = { marker: '-', ordered: false, text: [line], loose: false };
      items.push(current);
    }
  }
  if (current) items.push(current);

  const loose = items.some((item) => item.loose);
  const ordered = Boolean(items[0]?.ordered);
  const start = ordered ? parseInt(items[0].marker, 10) || 1 : 1;

  const body = items
    .map((item) => {
      const first = inline(item.text[0] ?? '');
      const rest = item.text.slice(1);
      /* A blank line directly under an item belongs to the item's own spacing,
         not to a second paragraph of its text. */
      while (rest.length && !rest[0].trim()) rest.shift();
      const inner = rest.length ? blocks(rest.join('\n')) : '';

      if (!inner) return loose ? `<li><p>${first}</p></li>` : `<li>${first}</li>`;
      const opening = loose ? `<p>${first}</p>` : first;
      return `<li>${opening}\n${inner}</li>`;
    })
    .join('\n');

  return ordered
    ? `<ol${start !== 1 ? ` start="${start}"` : ''}>\n${body}\n</ol>`
    : `<ul>\n${body}\n</ul>`;
}

/* --------------------------------- blocks --------------------------------- */

/**
 * The block-level pass. Returns HTML for a chunk of markdown with no
 * surrounding fence or quote context.
 */
export function blocks(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    /* Blank line — paragraph separator. */
    if (!line.trim()) {
      i += 1;
      continue;
    }

    /* Fenced code block. */
    const fence = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const length = fence[1].length;
      const language = fence[2];
      const code = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker}{${length},}\\s*$`).test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; /* the closing fence */
      out.push(
        `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(
          code.join('\n')
        )}</code></pre>`
      );
      continue;
    }

    /* Heading. */
    const heading = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].replace(/[ \t]+#+[ \t]*$/, ''))}</h${level}>`);
      i += 1;
      continue;
    }

    /* Horizontal rule. */
    if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    /* Blockquote — strip one level of ">" and recurse. */
    if (/^ {0,3}>/.test(line)) {
      const quoted = [];
      while (i < lines.length && (/^ {0,3}>/.test(lines[i]) || (lines[i].trim() && quoted.length))) {
        if (/^ {0,3}>/.test(lines[i])) quoted.push(lines[i].replace(/^ {0,3}> ?/, ''));
        else if (!lines[i].trim()) break;
        else quoted.push(lines[i]);
        i += 1;
      }
      out.push(`<blockquote>\n${blocks(quoted.join('\n'))}\n</blockquote>`);
      continue;
    }

    /* Table (GFM): a header row followed by a |---|---| row. */
    if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || '')) {
      const cells = (row) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => inline(cell.trim()));
      const header = cells(line);
      const align = (lines[i + 1] || '')
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => {
          const c = cell.trim();
          if (c.startsWith(':') && c.endsWith(':')) return 'center';
          if (c.endsWith(':')) return 'right';
          return '';
        });
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      const cell = (tag, value, index) =>
        `<${tag}${align[index] ? ` style="text-align:${align[index]}"` : ''}>${value ?? ''}</${tag}>`;
      out.push(
        [
          '<table>',
          `<thead><tr>${header.map((value, index) => cell('th', value, index)).join('')}</tr></thead>`,
          `<tbody>${rows
            .map((row) => `<tr>${header.map((_h, index) => cell('td', row[index], index)).join('')}</tr>`)
            .join('')}</tbody>`,
          '</table>',
        ].join('\n')
      );
      continue;
    }

    /* List. Bullets and numbers are separate lists: a numbered list after a
       blank line starts a new one rather than joining the bullets above it. */
    if (LIST_ITEM.test(line)) {
      const firstOrdered = /\d/.test(LIST_ITEM.exec(line)[2]);
      const listLines = [];

      while (i < lines.length) {
        const candidate = lines[i];
        const item = LIST_ITEM.exec(candidate);

        if (item) {
          const sameKind = /\d/.test(item[2]) === firstOrdered;
          /* A different kind of marker at column 0 begins the next list. */
          if (listLines.length && !sameKind && item[1].length === 0) break;
          listLines.push(candidate);
          i += 1;
        } else if (!candidate.trim()) {
          /* Keep the blank line only if the list continues after it. */
          const next = lines[i + 1] ?? '';
          const nextItem = LIST_ITEM.exec(next);
          const continues =
            (nextItem && (/\d/.test(nextItem[2]) === firstOrdered || nextItem[1].length > 0)) ||
            /^\s{2,}\S/.test(next);
          if (!continues) break;
          listLines.push(candidate);
          i += 1;
        } else if (/^\s{2,}/.test(candidate)) {
          /* An indented line belongs to the item above it. */
          listLines.push(candidate);
          i += 1;
        } else break;
      }

      out.push(renderList(listLines));
      continue;
    }

    /* Raw block HTML — passed through until a blank line. */
    if (BLOCK_TAG.test(line.trim())) {
      const html = [];
      while (i < lines.length && lines[i].trim()) {
        html.push(lines[i]);
        i += 1;
      }
      out.push(html.join('\n'));
      continue;
    }

    /* Paragraph: gather until a blank line or the start of another block. */
    const paragraph = [];
    while (i < lines.length) {
      const candidate = lines[i];
      if (
        !candidate.trim() ||
        /^ {0,3}(#{1,6}[ \t]|>|(`{3,}|~{3,}))/i.test(candidate) ||
        /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(candidate) ||
        LIST_ITEM.test(candidate)
      ) {
        break;
      }
      paragraph.push(candidate);
      i += 1;
    }
    if (paragraph.length) out.push(`<p>${inline(paragraph.join('\n'))}</p>`);
  }

  return out.join('\n');
}

/**
 * Renders markdown to HTML for the preview pane.
 * The result is meant to sit inside an element with class "prose", so it picks
 * up exactly the typography the published post uses.
 *
 * Raw HTML is allowed (the blog styles its own spans and marks), but whole
 * <script> and <style> elements are dropped and lone tags are shown escaped:
 * the preview is a convenience, and a pasted snippet should never run in it.
 */
export function renderMarkdown(source = '') {
  const safe = String(source).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  return blocks(safe);
}

/** Rough word count, used for the reading-time estimate in the editor. */
export function countWords(source = '') {
  const text = String(source)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-|]/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/<[^>]*>/g, ' ');
  const words = text.split(/\s+/).filter(Boolean);
  return words.length;
}

export default renderMarkdown;
