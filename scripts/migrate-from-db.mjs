#!/usr/bin/env node
/**
 * Migration: the old dynamic app's data/db.json → this Astro project.
 *
 *   npm run migrate                          # from ../blog/data/db.json
 *   npm run migrate -- --from /path/db.json  # or any other export
 *   npm run migrate -- --force               # overwrite existing posts
 *
 * Writes:
 *   src/content/blog/<slug>.md         one file per post (frontmatter + body)
 *   src/content/resources/<slug>.md    one file per recommended link
 *   src/content/pages/about.md         About page copy
 *   src/content/pages/resources.md     Resources page intro
 *   src/site.config.js                 site settings (identity, hero, footer…)
 *
 * Existing files are left alone unless --force is passed, so you can run this
 * again after adding posts to the old app without losing local edits.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const args = process.argv.slice(2);
const force = args.includes('--force');
const fromIndex = args.indexOf('--from');
const dbPath = fromIndex > -1 && args[fromIndex + 1]
  ? path.resolve(args[fromIndex + 1])
  : path.resolve(root, '..', 'blog', 'data', 'db.json');

/* ------------------------------- yaml output ------------------------------ */

/** JSON-quoted scalars are valid YAML and handle every special character. */
const yaml = (value) => JSON.stringify(value);

function frontmatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: [${value.map(yaml).join(', ')}]`;
      if (typeof value === 'number' || typeof value === 'boolean') return `${key}: ${value}`;
      return `${key}: ${yaml(value)}`;
    });
  return `---\n${lines.join('\n')}\n---\n`;
}

const slugify = (text, fallback = 'item') =>
  String(text || '')
    .toLowerCase()
    .replace(/['"’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;

const dateOnly = (value, fallbackYear = new Date()) => {
  const date = value ? new Date(value) : fallbackYear;
  return isNaN(date) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
};

function write(relPath, contents) {
  const target = path.join(root, relPath);
  if (fs.existsSync(target) && !force) {
    console.log(`  ·  kept    ${relPath}`);
    return false;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  console.log(`  ✓  wrote   ${relPath}`);
  return true;
}

/* ---------------------------------- run ---------------------------------- */

if (!fs.existsSync(dbPath)) {
  console.error(`\n  No database found at ${dbPath}\n`);
  console.error('  Point the script at an export:  npm run migrate -- --from ./db.json\n');
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const settings = db.settings || {};
const posts = db.posts || [];
const resources = db.resources || [];

console.log(`\n  Migrating from ${path.relative(process.cwd(), dbPath)}\n`);

/* ---- posts ---- */
let published = 0;
let drafts = 0;
for (const post of posts) {
  const slug = post.slug || slugify(post.title, 'post');
  const isDraft = post.status !== 'published';
  const body = post.content_md || '';
  const fm = frontmatter({
    title: post.title || 'Untitled',
    date: dateOnly(post.published_at || post.created_at),
    updated: post.updated_at ? dateOnly(post.updated_at) : undefined,
    tags: post.tags || [],
    summary: post.excerpt || '',
    cover: post.cover_image || '',
    featured: !!post.featured,
    draft: isDraft || undefined,
  });
  write(`src/content/blog/${slug}.md`, `${fm}\n${body.trim()}\n`);
  if (isDraft) drafts++; else published++;
}

/* ---- resources ---- */
const ordered = [...resources].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
ordered.forEach((resource, index) => {
  const slug = slugify(resource.title, `resource-${index + 1}`);
  const fm = frontmatter({
    title: resource.title,
    url: resource.url,
    category: resource.category || 'General',
    description: resource.description || '',
    order: index,
  });
  write(`src/content/resources/${slug}.md`, `${fm}\n`);
});

/* ---- the two prose pages ---- */
write('src/content/pages/about.md', `${frontmatter({
  eyebrow: 'About',
  heading: settings.about_heading || `Hello, I’m glad you’re here.`,
})}\n${(settings.about_body_md || '').trim()}\n`);

write('src/content/pages/resources.md', `${frontmatter({
  eyebrow: 'Resources',
  heading: 'Things worth your time',
})}\n${(settings.resources_intro_md || '').trim()}\n`);

/* ---- site settings ---- */
const plain = (markdown) =>
  String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_`~>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const aboutText = plain(settings.about_body_md || '');
const shortBio = aboutText.length > 220 ? aboutText.slice(0, 220) : aboutText;

const config = `/**
 * Site settings — migrated from the original app's data/db.json.
 *
 * This file is the single source of truth for everything that is not a post:
 * the masthead, the home page hero, the newsletter block, the footer, and the
 * site-wide typography. Edit it and rebuild — no code changes needed.
 */

export const site = {
  title: ${yaml(settings.site_title || 'The Slow Draft')},
  tagline: ${yaml(settings.site_tagline || '')},

  hero: {
    kicker: ${yaml(settings.hero_kicker || '')},
    heading: ${yaml(settings.hero_heading || '')},
    intro: ${yaml(settings.hero_intro || '')},
  },

  author: {
    name: ${yaml(settings.author_name || '')},
    role: ${yaml(settings.author_role || '')},
    photo: ${yaml(settings.author_photo || '')},
    email: ${yaml(settings.contact_email || '')},
    /* the About page opening, shown trimmed on the home page */
    shortBio: ${yaml(shortBio)},
  },

  social: {
    twitter: ${yaml(settings.twitter || '')},
    github: ${yaml(settings.github || '')},
    linkedin: ${yaml(settings.linkedin || '')},
  },

  newsletter: {
    heading: ${yaml(settings.newsletter_heading || 'Letters, occasionally')},
    blurb: ${yaml(settings.newsletter_blurb || '')},
    /**
     * Leave endpoint empty and the form hands the address to the writer's inbox
     * through the visitor's own mail app. Fill it in with a form service such as
     * Buttondown (https://buttondown.email/api/emails/embed-subscribe/<user>)
     * or Formspree and the form POSTs there instead.
     */
    endpoint: '',
    mode: 'mailto',
  },

  footerNote: ${yaml(settings.footer_note || '')},

  /* Site-wide typography — ids come from src/lib/fonts.js */
  typography: {
    body: ${yaml(settings.reading_font || 'lora')},
    heading: ${yaml(settings.heading_font || 'playfair')},
    size: ${yaml(settings.text_size || 'medium')},
  },

  /* Posts per page on /blog/ (pagination appears once you exceed it). */
  postsPerPage: 9,

  /**
   * The nav's "Write" button. It points at the private writing desk at /write/,
   * which commits markdown to the repository using a GitHub token kept in your
   * own browser. Set it to '' to hide the button entirely.
   */
  writeLink: '/write/',

  /* Absolute URL used in RSS, the sitemap and canonical tags.
     SITE_URL=https://yourdomain.com npm run build overrides this. */
  url: ${yaml(settings.site_url || 'https://the-slow-draft.example')},
};

export default site;
`;

const configPath = path.join(root, 'src/site.config.js');
if (!fs.existsSync(configPath) || force) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, config);
  console.log('  ✓  wrote   src/site.config.js');
} else {
  console.log('  ·  kept    src/site.config.js');
}

console.log(`
  Done. ${published} published post${published === 1 ? '' : 's'}, ${drafts} draft${drafts === 1 ? '' : 's'}, ${ordered.length} resource${ordered.length === 1 ? '' : 's'}.

  Next:  npm run build   (or npm run dev to write with live reload)
`);
