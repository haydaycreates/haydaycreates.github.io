/**
 * Frontmatter: reading and writing the top of a post.
 *
 * The desk has to understand files written two ways — by hand, and by older
 * tools that serialised with js-yaml, so long values can come out folded over
 * several lines. It writes one canonical shape, which is the shape the rest of
 * src/content/blog/ already uses:
 *
 *   ---
 *   title: "My new post"
 *   date: "2026-10-05"
 *   tags: ["writing", "notes"]
 *   summary: "One or two sentences."
 *   featured: false
 *   draft: true
 *   ---
 *
 * Everything here is plain JavaScript with no dependencies, so it runs both in
 * the browser bundle and in Node (scripts/test-write-desk.mjs).
 */

/** The fields the desk edits, in the order they are written to the file. */
export const FIELDS = [
  'title',
  'date',
  'updated',
  'tags',
  'summary',
  'featured',
  'draft',
  'cover',
];

/* --------------------------------- parsing -------------------------------- */

/** "a quoted string" | 'single' | plain → JavaScript string */
function readScalar(raw) {
  const value = raw.trim();
  if (!value) return '';

  if (/^".*"$/s.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }
  if (/^'.*'$/s.test(value)) return value.slice(1, -1).replace(/''/g, "'");

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return '';
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

  return value;
}

/** ["a", "b"] → ['a', 'b']   (inline flow sequence) */
function readFlowSequence(value) {
  const inner = value.trim().slice(1, -1).trim();
  if (!inner) return [];
  const items = [];
  let current = '';
  let quote = '';
  for (const char of inner) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ',') {
      items.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  items.push(current);
  return items.map((item) => readScalar(item)).filter((item) => item !== '');
}

/**
 * Splits a markdown file into its frontmatter data and its body.
 *
 * Handles the YAML subset frontmatter actually uses: scalars, inline and block
 * sequences, and block scalars (`>-`, `|`) which is what js-yaml writes for a
 * long summary.
 */
export function parsePost(source = '') {
  const text = String(source).replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { data: {}, body: text.replace(/^---\n/, '') };

  const data = {};
  const lines = match[1].split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const entry = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(line);
    if (!entry) continue; /* nested mappings are not part of this content model */

    const key = entry[1];
    let value = (entry[2] ?? '').trim();

    /* Block scalar: >- > | |- and friends — gather the indented lines below. */
    if (/^[>|][+-]?\d*$/.test(value)) {
      const folded = value.startsWith('>');
      const gathered = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        i += 1;
        gathered.push(lines[i].replace(/^\s{2}/, ''));
      }
      while (gathered.length && !gathered[gathered.length - 1].trim()) gathered.pop();
      data[key] = folded
        ? gathered
            .join(' ')
            .replace(/\s{2,}/g, (gap) => (gap.includes('  ') ? '\n' : ' '))
            .trim()
        : gathered.join('\n');
      continue;
    }

    /* Inline sequence: tags: ["a", "b"] */
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = readFlowSequence(value);
      continue;
    }

    /* Block sequence on the following lines:
         tags:
           - a
           - b                                              */
    if (!value && /^\s*-\s+/.test(lines[i + 1] || '')) {
      const items = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        i += 1;
        items.push(readScalar(lines[i].replace(/^\s*-\s+/, '')));
      }
      data[key] = items;
      continue;
    }

    /* A plain scalar, possibly folded over several indented lines — which is
       what js-yaml (and therefore the old dashboard) writes for a long summary:

         summary: A summary long enough that js-yaml would rather fold it
           across two lines than keep it on one.

       Folded lines join with a single space, exactly as YAML says. */
    const parts = [value];
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (!/^\s/.test(next) || !next.trim()) break;
      if (/^\s*-\s+/.test(next)) break;
      if (/^\s*[A-Za-z0-9_-]+:(\s|$)/.test(next)) break;
      i += 1;
      parts.push(next.trim());
    }
    data[key] = readScalar(parts.join(' '));
  }

  return { data, body: text.slice(match[0].length) };
}

/* ------------------------------- serialising ------------------------------ */

/** A YAML double-quoted scalar — JSON quoting is a valid YAML subset. */
const quote = (value) => JSON.stringify(String(value ?? ''));

/** "My New Post!" → "my-new-post" — the filename, and therefore the URL. */
export function slugify(title = '') {
  return String(title)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** 2026-10-05, in the reader's own timezone — what `date` expects. */
export function today() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Normalises whatever the date field holds into YYYY-MM-DD. */
export function normalizeDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return iso[0];
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? '' : parsed.toISOString().slice(0, 10);
}

/**
 * Builds the post data object from the editor's fields, applying the defaults
 * the Astro schema would apply anyway. Nothing optional is written unless it is
 * set, so a finished post's frontmatter stays short.
 */
export function toPostData(fields = {}) {
  const tags = Array.isArray(fields.tags)
    ? fields.tags
    : String(fields.tags ?? '')
        .split(',')
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter(Boolean);

  const data = {
    title: String(fields.title ?? '').trim(),
    date: normalizeDate(fields.date) || today(),
    tags: [...new Set(tags)],
    summary: String(fields.summary ?? '').trim(),
    featured: Boolean(fields.featured),
    draft: Boolean(fields.draft),
  };

  const updated = normalizeDate(fields.updated);
  if (updated) data.updated = updated;
  const cover = String(fields.cover ?? '').trim();
  if (cover) data.cover = cover;

  return data;
}

/** Renders post data as a YAML frontmatter block, in FIELDS order. */
export function serializeFrontmatter(data = {}) {
  const lines = ['---'];

  for (const key of FIELDS) {
    if (!(key in data)) continue;
    const value = data[key];

    if (Array.isArray(value)) {
      if (!value.length) continue; /* an empty tags list carries no information */
      lines.push(`${key}: [${value.map(quote).join(', ')}]`);
      continue;
    }
    if (typeof value === 'boolean') {
      /* `draft: false` is the schema's default and the rest of the repository
         leaves it out, so a published post carries no draft line at all. */
      if (key === 'draft' && !value) continue;
      lines.push(`${key}: ${value}`);
      continue;
    }
    const text = String(value ?? '').trim();
    if (!text) continue;
    lines.push(`${key}: ${quote(text)}`);
  }

  /* Any field outside the known set (written by an older editor, say) is kept. */
  for (const [key, value] of Object.entries(data)) {
    if (FIELDS.includes(key)) continue;
    if (value === '' || value === null || value === undefined) continue;
    if (Array.isArray(value)) lines.push(`${key}: [${value.map(quote).join(', ')}]`);
    else if (typeof value === 'boolean') lines.push(`${key}: ${value}`);
    else lines.push(`${key}: ${quote(value)}`);
  }

  lines.push('---');
  return `${lines.join('\n')}\n`;
}

/** The complete file the desk commits: frontmatter, a blank line, then the body. */
export function buildPostFile(data, body = '') {
  const text = String(body ?? '').replace(/^\n+/, '').replace(/\s+$/, '');
  return `${serializeFrontmatter(data)}\n${text}\n`;
}

/** Reads a post file into the fields the editor binds to. */
export function toEditorFields(source = '') {
  const { data, body } = parsePost(source);
  return {
    title: typeof data.title === 'string' ? data.title : '',
    date: normalizeDate(data.date) || today(),
    updated: normalizeDate(data.updated),
    summary: typeof data.summary === 'string' ? data.summary : '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    featured: Boolean(data.featured),
    draft: Boolean(data.draft),
    cover: typeof data.cover === 'string' ? data.cover : '',
    body,
  };
}
