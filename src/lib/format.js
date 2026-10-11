/**
 * Formatting helpers — the same output the dynamic site produced, so dates,
 * reading times and excerpts read identically.
 */

import { normalizeSocial } from './desk/settings.js';

/* Dates are stored as plain YYYY-MM-DD, so they are formatted in UTC to keep
   the same day on every build machine. */
export function fmtDate(value) {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export function isoDate(value) {
  const d = toDate(value);
  return d ? d.toISOString() : '';
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d) ? null : d;
}

/** Markdown body → plain text (for excerpts, word counts and reading time). */
export function plainText(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|[a-z]+);/gi, ' ')
    .replace(/[#*_`~>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(markdown) {
  const text = plainText(markdown);
  return text ? text.split(/\s+/).length : 0;
}

export function readingTime(markdown) {
  return Math.max(1, Math.round(wordCount(markdown) / 220));
}

/** Card / meta description for an entry: its summary, else the first words. */
export function excerptOf(entry, max = 180) {
  const summary = entry?.data?.summary;
  if (summary && summary.trim()) return summary.trim();
  const text = plainText(entry?.body);
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

export const postUrl = (slug) => `/blog/${slug}/`;

/** Tag → URL segment: "creative work" → "creative-work" */
export function tagSlug(tag) {
  return String(tag || '')
    .toLowerCase()
    .replace(/['"’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tag';
}

/** [{ tag, slug, count }] sorted by popularity, then alphabetically. */
export function tagCounts(posts) {
  const map = new Map();
  for (const post of posts) {
    for (const tag of post.data.tags || []) {
      if (!map.has(tag)) map.set(tag, { tag, slug: tagSlug(tag), count: 0 });
      map.get(tag).count += 1;
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/* ------------------------------- inline icons ------------------------------ */

export const ICONS = {
  rss: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14.5 6.5 3 3"/></svg>',
  globe: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3Z"/></svg>',
};

/* -------------------------------- site pieces ----------------------------- */

/**
 * The social row for the footer and the About card: every link the owner kept
 * in settings (a list of { id, label, url } — the legacy { twitter, github,
 * linkedin } object is still understood), then Email, then RSS.
 */
export function socialItems(site) {
  const items = [];
  for (const link of normalizeSocial(site.social)) {
    if (link.url) items.push({ label: link.label || 'Link', href: link.url, icon: '' });
  }
  if (site.author?.email) items.push({ label: 'Email', href: `mailto:${site.author.email}`, icon: ICONS.mail });
  items.push({ label: 'RSS', href: '/rss.xml', icon: ICONS.rss });
  return items;
}

export const monogram = (name) => (String(name || 'A').trim().charAt(0) || 'A');
