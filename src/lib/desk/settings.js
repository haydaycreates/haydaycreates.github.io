/**
 * Site settings — everything about the site that is not a post.
 *
 * The owner-editable settings live in `src/data/settings.json`, a small JSON
 * file in the repository. This module holds the defaults they merge over, the
 * merge itself, and the read/write helpers both sides need:
 *
 *   · the build  — src/site.config.js merges settings.json over the defaults
 *                  and every page reads the result
 *   · the desk   — the Settings view at /write/ reads the same file through
 *                  GitHub's Contents API, edits it in the browser, and commits
 *                  it back in one commit
 *
 * Like the rest of src/lib/desk/, this is plain JavaScript with no
 * dependencies, so it runs in the browser bundle and in Node (the test
 * scripts) unchanged.
 */

import { parsePost, slugify } from './frontmatter.js';
import { byId, TEXT_SIZES } from '../fonts.js';

/** Where the owner's settings live, relative to the repository root. */
export const SETTINGS_PATH = 'src/data/settings.json';

/** Where the resources the Settings view edits live. */
export const RESOURCES_DIR = 'src/content/resources';

/* --------------------------------- defaults ------------------------------- */

/**
 * The networks every site gets a row for, whether or not they are filled in.
 * Custom links are welcome too — the desk adds them with an empty `id`.
 */
export const SOCIAL_PRESETS = [
  { id: 'x', label: 'X', placeholder: 'https://x.com/yourname' },
  { id: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourname' },
  { id: 'github', label: 'GitHub', placeholder: 'https://github.com/yourname' },
  { id: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/yourname' },
];

/**
 * The fallback shape. Anything `src/data/settings.json` does not mention —
 * or a repository that has no settings file at all yet — falls back to this.
 */
export const SETTINGS_DEFAULTS = {
  title: 'The Slow Draft',
  tagline: 'Essays on writing, building things, and paying attention.',

  hero: {
    kicker: 'A personal blog',
    heading: 'Notes from the slow lane of the internet.',
    intro:
      'Long-ish thoughts on writing, craft, and the small systems that keep a creative life running. New pieces land here every couple of weeks — you can also get them by email.',
  },

  author: {
    name: '',
    role: '',
    email: '',
    photo: '',
    /** Overrides the heading in src/content/pages/about.md when set. */
    aboutHeading: '',
    /** The About page opening, shown trimmed on the home page. */
    shortBio: '',
  },

  social: SOCIAL_PRESETS.map(({ id, label }) => ({ id, label, url: '' })),

  newsletter: {
    heading: 'Letters, occasionally',
    blurb: 'One short email when something new goes up. No spam, no selling your address, unsubscribe in one click.',
    /**
     * Empty endpoint = the mailto flow: the subscribe form hands the address
     * to the author's inbox through the visitor's own mail app. Set it to a
     * form service (Buttondown, Formspree, …) and the form POSTs there.
     */
    endpoint: '',
    mode: 'mailto',
  },

  footerNote: 'Written by hand, published from a small editor.',

  /* Typeface ids come from src/lib/fonts.js; sizes are small | medium | large. */
  typography: {
    body: 'lora',
    heading: 'playfair',
    size: 'medium',
  },
};

/* --------------------------------- merging -------------------------------- */

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Deep merge: plain objects merge key by key, everything else (strings,
 * numbers, arrays) replaces. Arrays replace rather than concatenate so a
 * saved social list is exactly the list the owner left behind.
 */
export function deepMerge(base, overrides) {
  if (!isPlainObject(base)) return overrides === undefined ? base : overrides;
  if (!isPlainObject(overrides)) return overrides === undefined ? base : overrides;
  const out = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out;
}

/**
 * Social links have changed shape once already: site.config.js used to carry
 * `{ twitter, github, linkedin }`. Both shapes read into the canonical list of
 * `{ id, label, url }` entries, so an old settings file still works.
 */
export function normalizeSocial(value) {
  if (Array.isArray(value)) {
    return value
      .filter(isPlainObject)
      .map((entry) => ({
        id: String(entry.id ?? '').trim(),
        label: String(entry.label ?? '').trim(),
        url: String(entry.url ?? '').trim(),
      }))
      .filter((entry) => entry.label || entry.url);
  }
  if (isPlainObject(value)) {
    const legacy = [
      { id: 'x', label: 'X', url: String(value.twitter ?? value.x ?? '').trim() },
      { id: 'instagram', label: 'Instagram', url: String(value.instagram ?? '').trim() },
      { id: 'github', label: 'GitHub', url: String(value.github ?? '').trim() },
      { id: 'linkedin', label: 'LinkedIn', url: String(value.linkedin ?? '').trim() },
    ];
    const custom = Array.isArray(value.custom) ? normalizeSocial(value.custom) : [];
    return [...legacy, ...custom].filter((entry) => entry.label || entry.url);
  }
  return [];
}

/** Unknown typefaces and sizes fall back to the defaults rather than breaking. */
export function normalizeTypography(value) {
  const fallback = SETTINGS_DEFAULTS.typography;
  const t = isPlainObject(value) ? value : {};
  return {
    body: byId(t.body) ? String(t.body) : fallback.body,
    heading: byId(t.heading) ? String(t.heading) : fallback.heading,
    size: TEXT_SIZES.includes(t.size) ? String(t.size) : fallback.size,
  };
}

/**
 * The one function both the build and the desk use: defaults merged with
 * whatever the owner has saved, normalised into the canonical shape.
 */
export function mergeSettings(overrides) {
  const source = isPlainObject(overrides) ? overrides : {};
  const merged = deepMerge(SETTINGS_DEFAULTS, source);
  merged.social = normalizeSocial('social' in source ? source.social : SETTINGS_DEFAULTS.social);
  merged.typography = normalizeTypography(merged.typography);
  merged.newsletter.mode = String(merged.newsletter.mode || 'mailto');
  return merged;
}

/* ------------------------------ reading, writing --------------------------- */

/** JSON text → `{ ok, data }`. An empty file is valid: it just means defaults. */
export function parseSettings(text) {
  const source = String(text ?? '').trim();
  if (!source) return { ok: true, data: {}, empty: true };
  try {
    const data = JSON.parse(source);
    if (!isPlainObject(data)) return { ok: false, error: 'the file is not a JSON object', data: {} };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message, data: {} };
  }
}

/** Trims what the owner typed and drops social rows that say nothing. */
export function sanitizeSettings(settings) {
  const merged = mergeSettings(settings);
  const trimDeep = (value) => {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.map(trimDeep);
    if (isPlainObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimDeep(v)]));
    }
    return value;
  };
  const clean = trimDeep(merged);
  clean.social = normalizeSocial(clean.social);
  clean.typography = normalizeTypography(clean.typography);
  return clean;
}

/**
 * Settings → the exact JSON text the desk commits, in a stable key order so
 * two saves that change nothing produce no diff at all.
 */
export function serializeSettings(settings) {
  const s = sanitizeSettings(settings);
  const ordered = {
    title: s.title,
    tagline: s.tagline,
    hero: { kicker: s.hero.kicker, heading: s.hero.heading, intro: s.hero.intro },
    author: {
      name: s.author.name,
      role: s.author.role,
      email: s.author.email,
      photo: s.author.photo,
      aboutHeading: s.author.aboutHeading,
      shortBio: s.author.shortBio,
    },
    social: s.social.map(({ id, label, url }) => ({ id, label, url })),
    newsletter: {
      heading: s.newsletter.heading,
      blurb: s.newsletter.blurb,
      endpoint: s.newsletter.endpoint,
      mode: s.newsletter.mode,
    },
    footerNote: s.footerNote,
    typography: { body: s.typography.body, heading: s.typography.heading, size: s.typography.size },
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * Problems worth stopping a save for. Returns a list of sentences; an empty
 * list means the settings are safe to commit.
 */
export function validateSettings(settings) {
  const s = mergeSettings(settings);
  const problems = [];

  if (!String(s.title).trim()) problems.push('The site needs a title.');
  if (s.author.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.author.email)) {
    problems.push(`“${s.author.email}” does not look like an email address — subscriptions cannot reach you.`);
  }
  for (const link of s.social) {
    if (link.url && !/^https?:\/\/\S+$/i.test(link.url)) {
      problems.push(`The ${link.label || 'social'} link “${link.url}” should start with https://.`);
    }
  }
  if (s.newsletter.endpoint && !/^https?:\/\/\S+$/i.test(s.newsletter.endpoint)) {
    problems.push('The newsletter endpoint should be an https:// URL, or empty for the mailto flow.');
  }
  return problems;
}

/* --------------------------------- key paths ------------------------------ */

/** getByPath({hero:{heading:'x'}}, 'hero.heading') → 'x' */
export function getByPath(object, path) {
  return String(path)
    .split('.')
    .reduce((value, key) => (value == null ? undefined : value[key]), object);
}

/** setByPath(state, 'hero.heading', 'y') — mutates and returns the object. */
export function setByPath(object, path, value) {
  const keys = String(path).split('.');
  let node = object;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key];
  }
  node[keys[keys.length - 1]] = value;
  return object;
}

/* -------------------------------- resources ------------------------------- */

/**
 * Resources are markdown files in src/content/resources/ with five
 * frontmatter fields. They are edited one file per commit — the Contents API
 * writes single files — so the desk commits each add, edit, delete and reorder
 * as it happens.
 */
export const RESOURCE_FIELDS = ['title', 'url', 'category', 'description', 'order'];

/** A resource file's text → the fields the editor binds to. */
export function toResourceFields(source = '') {
  const { data } = parsePost(source);
  const order = Number(data.order);
  return {
    title: typeof data.title === 'string' ? data.title : '',
    url: typeof data.url === 'string' ? data.url : '',
    category: typeof data.category === 'string' && data.category.trim() ? data.category.trim() : 'General',
    description: typeof data.description === 'string' ? data.description : '',
    order: Number.isFinite(order) ? order : 0,
  };
}

/**
 * The fields → the file the desk commits. Strings are JSON-quoted (a valid
 * YAML subset); `order` is written bare, because the content schema declares
 * it a number and `order: "3"` would fail the build.
 */
export function buildResourceFile(fields = {}) {
  const quote = (value) => JSON.stringify(String(value ?? ''));
  const order = Number(fields.order);
  const lines = [
    '---',
    `title: ${quote(fields.title)}`,
    `url: ${quote(fields.url)}`,
    `category: ${quote(fields.category || 'General')}`,
  ];
  const description = String(fields.description ?? '').trim();
  if (description) lines.push(`description: ${quote(description)}`);
  lines.push(`order: ${Number.isFinite(order) ? Math.max(0, Math.round(order)) : 0}`);
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

/** "Quiet Tools" → "quiet-tools" — the resource filename. */
export function resourceSlug(title, fallback = 'resource') {
  return slugify(title) || fallback;
}

/** Problems that make a resource unbuildable; empty means safe to commit. */
export function validateResource(fields = {}) {
  const problems = [];
  if (!String(fields.title ?? '').trim()) problems.push('Give the resource a title.');
  const url = String(fields.url ?? '').trim();
  if (!url) problems.push('Give the resource a link.');
  else if (!/^https?:\/\/\S+$/i.test(url)) problems.push(`“${url}” should start with https://.`);
  return problems;
}

export default {
  SETTINGS_PATH,
  RESOURCES_DIR,
  SETTINGS_DEFAULTS,
  SOCIAL_PRESETS,
  mergeSettings,
  normalizeSocial,
  normalizeTypography,
  parseSettings,
  sanitizeSettings,
  serializeSettings,
  validateSettings,
  getByPath,
  setByPath,
  toResourceFields,
  buildResourceFile,
  resourceSlug,
  validateResource,
};
