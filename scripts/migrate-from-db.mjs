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
 *   src/data/settings.json             site settings (identity, hero, footer…)
 *
 * Existing files are left alone unless --force is passed, so you can run this
 * again after adding posts to the old app without losing local edits.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serializeSettings } from '../src/lib/desk/settings.js';

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

/* The owner-editable settings live in src/data/settings.json now — the same
   file the desk's Settings view reads and commits — so that is what the
   migration refreshes. src/site.config.js keeps the technical configuration
   (pagination, writeDesk, url) and is left alone. */
write(
  'src/data/settings.json',
  serializeSettings({
    title: settings.site_title || 'The Slow Draft',
    tagline: settings.site_tagline || '',
    hero: {
      kicker: settings.hero_kicker || '',
      heading: settings.hero_heading || '',
      intro: settings.hero_intro || '',
    },
    author: {
      name: settings.author_name || '',
      role: settings.author_role || '',
      email: settings.contact_email || '',
      photo: settings.author_photo || '',
      aboutHeading: settings.about_heading || '',
      shortBio,
    },
    social: [
      { id: 'x', label: 'X', url: settings.twitter || '' },
      { id: 'instagram', label: 'Instagram', url: settings.instagram || '' },
      { id: 'github', label: 'GitHub', url: settings.github || '' },
      { id: 'linkedin', label: 'LinkedIn', url: settings.linkedin || '' },
    ],
    newsletter: {
      heading: settings.newsletter_heading || 'Letters, occasionally',
      blurb: settings.newsletter_blurb || '',
      endpoint: '',
      mode: 'mailto',
    },
    footerNote: settings.footer_note || '',
    typography: {
      body: settings.reading_font || 'lora',
      heading: settings.heading_font || 'playfair',
      size: settings.text_size || 'medium',
    },
  })
);

console.log(`
  Done. ${published} published post${published === 1 ? '' : 's'}, ${drafts} draft${drafts === 1 ? '' : 's'}, ${ordered.length} resource${ordered.length === 1 ? '' : 's'}.

  Next:  npm run build   (or npm run dev to write with live reload)
`);
