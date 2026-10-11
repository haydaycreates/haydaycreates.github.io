#!/usr/bin/env node
/**
 * Tests the private writing desk at /write/.
 *
 * The desk has no server, so the contract worth proving is the same one the CMS
 * test proves: "anything the editor writes, Astro builds". The desk serialises
 * frontmatter itself and renders its own preview, so this checks both halves —
 * the markdown preview, the frontmatter it reads and writes, the settings JSON
 * its Settings view commits, the resource files its Resources editor writes,
 * the base64 the GitHub API is given, and finally a real build of everything
 * the desk can commit.
 *
 *   npm run check:desk          fast: the editor's own logic + the built page
 *   npm run test:desk           …plus a real build of everything the desk can
 *                               commit — posts, settings.json and resources
 *   node scripts/test-write-desk.mjs --build --keep   build and leave dist alone
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';

import { renderMarkdown, countWords } from '../src/lib/desk/markdown.js';
import {
  parsePost,
  toEditorFields,
  toPostData,
  buildPostFile,
  serializeFrontmatter,
  slugify,
  normalizeDate,
  today,
} from '../src/lib/desk/frontmatter.js';
import {
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
} from '../src/lib/desk/settings.js';
import { FONTS, TEXT_SIZES, byId } from '../src/lib/fonts.js';
import { toBase64, fromBase64, DeskError } from '../src/lib/desk/github.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blogDir = path.join(root, 'src/content/blog');
const resourcesDir = path.join(root, 'src/content/resources');
const settingsFile = path.join(root, 'src/data/settings.json');
const outDir = path.join(root, 'dist');

const fullBuild = process.argv.includes('--build');
const problems = [];
let checks = 0;

const ok = (label) => {
  checks += 1;
  console.log(`  ✓  ${label}`);
};
const fail = (label, detail = '') => {
  problems.push(detail ? `${label} — ${detail}` : label);
  console.log(`  ✗  ${label}${detail ? `  (${detail})` : ''}`);
};
const expect = (condition, label, detail = '') => (condition ? ok(label) : fail(label, detail));

console.log('');
console.log('  The writing desk — markdown preview');
console.log('  -----------------------------------');

/* --------------------------------- markdown -------------------------------- */

{
  const html = renderMarkdown([
    '## A heading',
    '',
    'A paragraph with **bold**, *italic*, `code`, ~~struck~~ and a [link](https://example.com).',
    '',
    '- one',
    '- two',
    '  - nested',
    '',
    '1. first',
    '2. second',
    '',
    '> A quotation, with a second line.',
    '',
    '```js',
    'const x = 1 < 2;',
    '```',
    '',
    'A <span class="c-terracotta">terracotta clause</span> and a <mark class="hl-yellow">highlight</mark>.',
    '',
    '![A cover](/uploads/cover.jpg)',
    '',
    '| Left | Right |',
    '| --- | ---: |',
    '| a | b |',
    '',
    '---',
    '',
    'Escaped: 5 < 6 & 7 > 3',
  ].join('\n'));

  expect(/<h2>A heading<\/h2>/.test(html), 'headings render');
  expect(/<strong>bold<\/strong>/.test(html), 'bold renders');
  expect(/<em>italic<\/em>/.test(html), 'italic renders');
  expect(/<code>code<\/code>/.test(html), 'inline code renders');
  expect(/<del>struck<\/del>/.test(html), 'strikethrough renders');
  expect(/<a href="https:\/\/example\.com"[^>]*>link<\/a>/.test(html), 'links render');
  expect(/<ul>[\s\S]*<li>[\s\S]*<ul>[\s\S]*nested/.test(html), 'nested lists render');
  expect(/<ol>[\s\S]*<li>[\s\S]*first/.test(html), 'ordered lists render');
  expect(/<blockquote>/.test(html), 'quotations render');
  expect(/<pre><code class="language-js">const x = 1 &lt; 2;<\/code><\/pre>/.test(html), 'code fences escape their contents');
  expect(html.includes('<span class="c-terracotta">terracotta clause</span>'), 'the site’s pen colours survive');
  expect(html.includes('<mark class="hl-yellow">highlight</mark>'), 'the highlighter survives');
  expect(/<img src="\/uploads\/cover\.jpg" alt="A cover"/.test(html), 'images render');
  expect(/<table>[\s\S]*<th[^>]*>Left<\/th>[\s\S]*<td[^>]*>a<\/td>/.test(html), 'tables render');
  expect(/<hr>/.test(html), 'rules render');
  expect(html.includes('5 &lt; 6 &amp; 7 &gt; 3'), 'stray angle brackets in prose are escaped');
  expect(!/<script/i.test(renderMarkdown('A <script>alert(1)</script> line')), 'script tags are not passed through as HTML elements');
  expect(countWords('One two three') === 3, 'word count is sane');
}

/* -------------------------------- frontmatter ------------------------------- */

console.log('');
console.log('  Frontmatter — reading every post already in the repository');
console.log('  ----------------------------------------------------------');

{
  const posts = fs.readdirSync(blogDir).filter((name) => name.endsWith('.md'));
  let roundTrips = 0;

  for (const name of posts) {
    const source = fs.readFileSync(path.join(blogDir, name), 'utf8');
    const first = parsePost(source);
    if (!first.data.title) {
      fail(`${name} parsed`, 'no title came back');
      continue;
    }
    /* Read it, write it the desk's way, read that again: nothing may be lost. */
    const rewritten = buildPostFile(first.data, first.body);
    const second = parsePost(rewritten);
    const sameTitle = second.data.title === first.data.title;
    const sameDate = String(second.data.date).slice(0, 10) === String(first.data.date).slice(0, 10);
    const sameTags = JSON.stringify(second.data.tags ?? []) === JSON.stringify(first.data.tags ?? []);
    const sameBody = second.body.trim() === first.body.trim();
    if (sameTitle && sameDate && sameTags && sameBody) roundTrips += 1;
    else fail(`${name} round trip`, `title:${sameTitle} date:${sameDate} tags:${sameTags} body:${sameBody}`);
  }
  expect(roundTrips === posts.length, `all ${posts.length} existing posts survive a read → write → read round trip`);
}

console.log('');
console.log('  Frontmatter — the shapes the old dashboard could leave behind');
console.log('  --------------------------------------------------------------');

{
  /* The old dashboard serialised with js-yaml, which folds long values over several lines. */
  const folded = yaml.dump({
    title: 'A post with a very long summary',
    date: new Date(Date.UTC(2026, 9, 5)),
    summary: 'A summary long enough that js-yaml would rather fold it across two lines than keep it on one.',
    tags: ['writing', 'testing'],
    draft: true,
  });
  const parsed = parsePost(`---\n${folded}---\n\nThe body.\n`);
  expect(parsed.data.title === 'A post with a very long summary', 'a js-yaml file reads correctly');
  expect(/A summary long enough/.test(parsed.data.summary) && !parsed.data.summary.includes('\n'), 'a folded summary comes back as one line');
  expect(parsed.data.date === '2026-10-05', 'a YAML date becomes YYYY-MM-DD');
  expect(JSON.stringify(parsed.data.tags) === '["writing","testing"]', 'a block tag list reads correctly');
  expect(parsed.data.draft === true, 'a draft stays a draft');
  expect(parsed.body.trim() === 'The body.', 'the body is separated cleanly');

  /* Block sequences, literal blocks, no frontmatter at all. */
  expect(parsePost('Just words.\n').body === 'Just words.\n', 'a file with no frontmatter is all body');
  expect(parsePost('---\ntitle: Untitled\ntags:\n  - a\n  - b\n---\nBody\n').data.tags.length === 2, 'a dashed tag list reads correctly');

  /* What the desk writes. */
  const built = buildPostFile(
    toPostData({
      title: 'Hello, world',
      date: '2026-10-05',
      tags: 'writing, notes, writing',
      summary: 'A first post.',
      featured: true,
      draft: false,
      cover: '/uploads/hello.jpg',
    }),
    'Body text.\n'
  );
  expect(built.startsWith('---\ntitle: "Hello, world"\n'), 'the file starts with a frontmatter block');
  expect(built.includes('tags: ["writing", "notes"]'), 'tags are de-duplicated and written inline');
  expect(built.includes('featured: true'), 'booleans are written bare');
  expect(!built.includes('draft:'), 'a published post does not carry draft: false');
  expect(built.includes('cover: "/uploads/hello.jpg"'), 'a cover image is written');
  expect(built.endsWith('Body text.\n'), 'the body ends with a single newline');
  expect(parsePost(built).data.title === 'Hello, world', 'what the desk writes, the desk can read');

  expect(slugify('Why I Write Before I Check My Phone!') === 'why-i-write-before-i-check-my-phone', 'slugs are kebab-case');
  expect(slugify('Café notes — 2026') === 'cafe-notes-2026', 'accents and dashes fold away');
  expect(normalizeDate('2026-10-05T09:00:00.000Z') === '2026-10-05', 'timestamps normalise to a date');
  expect(normalizeDate('') === '', 'an empty date stays empty');
  expect(/^\d{4}-\d{2}-\d{2}$/.test(today()), 'today() is a date the schema accepts');
  expect(toEditorFields(built).tags.length === 2, 'toEditorFields fills the form');
  expect(serializeFrontmatter({}) === '---\n---\n', 'empty frontmatter is still valid');
}

/* ---------------------------------- settings ------------------------------- */

console.log('');
console.log('  Settings — merging over the defaults');
console.log('  ------------------------------------');

{
  const defaults = mergeSettings({});
  expect(JSON.stringify(defaults) === JSON.stringify(SETTINGS_DEFAULTS), 'no overrides merges to exactly the defaults');
  expect(Array.isArray(defaults.social) && defaults.social.length === SOCIAL_PRESETS.length, 'the four known networks are listed by default');

  const renamed = mergeSettings({ title: 'Renamed', hero: { heading: 'A new heading' } });
  expect(renamed.title === 'Renamed' && renamed.tagline === SETTINGS_DEFAULTS.tagline, 'a scalar override replaces just itself');
  expect(renamed.hero.heading === 'A new heading' && renamed.hero.kicker === SETTINGS_DEFAULTS.hero.kicker, 'a partial object merge keeps its siblings');

  const oneSocial = mergeSettings({ social: [{ label: 'Mastodon', url: 'https://mastodon.social/@me' }] });
  expect(oneSocial.social.length === 1, 'a saved social list replaces the defaults instead of extending them');

  const legacy = mergeSettings({ social: { twitter: 'https://x.com/slow', github: 'https://github.com/slow' } });
  expect(legacy.social.find((link) => link.id === 'x')?.url === 'https://x.com/slow', 'the old { twitter } shape reads into the X row');
  expect(legacy.social.find((link) => link.id === 'github')?.url === 'https://github.com/slow', 'and the old github key into the GitHub row');
  expect(legacy.social.length === 4, 'the other presets stay available');

  const withCustom = normalizeSocial({ twitter: '', custom: [{ label: 'Bluesky', url: 'https://bsky.app/profile/me' }] });
  expect(withCustom.some((link) => link.label === 'Bluesky'), 'custom links survive the legacy shape too');

  const dropped = mergeSettings({ social: [{ id: '', label: '', url: '' }, { label: 'X', url: 'https://x.com/a' }] });
  expect(dropped.social.length === 1, 'a social row with neither label nor url is dropped');

  const typo = mergeSettings({ typography: { body: 'comic-sans', heading: null, size: 'huge' } });
  expect(typo.typography.body === 'lora' && typo.typography.heading === 'playfair' && typo.typography.size === 'medium', 'unknown typefaces and sizes fall back to the defaults');
  expect(normalizeTypography({ body: 'inter', heading: 'poppins', size: 'large' }).body === 'inter', 'a valid pick is kept');
}

console.log('');
console.log('  Settings — serialising what the desk commits');
console.log('  --------------------------------------------');

{
  const text = serializeSettings(mergeSettings({ title: 'Round Trip', author: { email: 'me@example.com' } }));
  const parsed = parseSettings(text);
  expect(parsed.ok && parsed.data.title === 'Round Trip', 'what the desk writes, the desk can read');
  expect(parsed.data.author.email === 'me@example.com', 'nested values survive the round trip');
  expect(text.endsWith('\n') && !text.endsWith('\n\n'), 'the file ends with exactly one newline');
  expect(
    serializeSettings({ tagline: 'B', title: 'A' }) === serializeSettings({ title: 'A', tagline: 'B' }),
    'the key order is stable, so an unchanged save is an unchanged file'
  );
  expect(parseSettings('').ok && parseSettings('').empty, 'an empty settings file is valid — it just means defaults');
  expect(!parseSettings('{broken').ok, 'broken JSON is reported, not thrown');
  expect(!parseSettings('[]').ok, 'a JSON array is refused');

  const padded = parseSettings(serializeSettings({ title: '  Padded  ' })).data.title;
  expect(padded === 'Padded', 'values are trimmed on the way into the file');

  const state = { hero: { heading: 'before' } };
  setByPath(state, 'hero.heading', 'after');
  expect(getByPath(state, 'hero.heading') === 'after', 'the form writes through key paths');
  setByPath(state, 'typography.size', 'large');
  expect(getByPath(state, 'typography.size') === 'large', 'and creates the objects it passes through');

  expect(validateSettings(mergeSettings({})).length === 0, 'the defaults pass validation');
  expect(validateSettings({ title: ' ' }).some((problem) => /title/i.test(problem)), 'a site with no title is refused');
  expect(validateSettings({ author: { email: 'nope' } }).some((problem) => /email/i.test(problem)), 'a malformed email is refused — subscriptions could not arrive');
  expect(validateSettings({ social: [{ label: 'X', url: 'x.com/me' }] }).length > 0, 'a social link without https:// is refused');
  expect(validateSettings({ newsletter: { endpoint: 'buttondown.example' } }).length > 0, 'a malformed endpoint is refused');
  expect(validateSettings({ author: { email: '' }, newsletter: { endpoint: '' } }).length === 0, 'empty email and endpoint are fine — the mailto flow tolerates both');
}

/* --------------------------------- resources ------------------------------- */

console.log('');
console.log('  Resources — the files the Settings view edits');
console.log('  ---------------------------------------------');

{
  const file = buildResourceFile({
    title: 'A Desk-Written Resource',
    url: 'https://example.com/desk',
    category: 'Testing',
    description: 'Written by the desk, quoted like the rest.',
    order: 7,
  });
  expect(file.startsWith('---\ntitle: "A Desk-Written Resource"\n'), 'a resource file starts with frontmatter');
  expect(/^order: 7$/m.test(file), 'order is written as a bare number — z.number() would refuse a quoted one');
  expect(file.includes('url: "https://example.com/desk"'), 'the link is written');
  expect(file.endsWith('---\n') && !file.includes('\n\n'), 'the file is frontmatter and nothing else');

  const fields = toResourceFields(file);
  expect(fields.title === 'A Desk-Written Resource' && fields.url === 'https://example.com/desk', 'what the desk writes, the desk can read');
  expect(fields.category === 'Testing' && fields.order === 7, 'category and order come back intact');
  expect(toResourceFields(file.replace(/^order: 7$/m, 'order: "7"')).order === 7, 'a quoted order still reads as a number');
  expect(toResourceFields('---\ntitle: "x"\n---\n').category === 'General', 'a missing category falls back to General');

  expect(resourceSlug('Quiet Tools!') === 'quiet-tools', 'resource filenames are kebab-case');
  expect(validateResource({ title: 'No link' }).length === 1, 'a resource without a link is refused');
  expect(validateResource({ title: 'Good', url: 'https://example.com' }).length === 0, 'a complete resource passes');
  expect(validateResource({ title: 'Bad', url: 'javascript:alert(1)' }).length === 1, 'a javascript: URL is refused');

  /* Every resource already in the repository must survive the desk's round trip. */
  const existing = fs.existsSync(resourcesDir)
    ? fs.readdirSync(resourcesDir).filter((name) => name.endsWith('.md'))
    : [];
  let roundTrips = 0;
  for (const name of existing) {
    const first = toResourceFields(fs.readFileSync(path.join(resourcesDir, name), 'utf8'));
    const second = toResourceFields(buildResourceFile(first));
    if (
      first.title && /^https?:\/\//.test(first.url) && Number.isInteger(first.order) &&
      second.title === first.title && second.url === first.url &&
      second.category === first.category && second.order === first.order
    ) roundTrips += 1;
    else fail(`${name} round trip`, JSON.stringify(first));
  }
  expect(roundTrips === existing.length, `all ${existing.length} existing resources survive a read → write → read round trip`);
}

/* --------------------------- the settings in the repo ---------------------- */

console.log('');
console.log('  Settings — the file in your repository');
console.log('  --------------------------------------');

{
  expect(fs.existsSync(settingsFile), 'src/data/settings.json exists');
  const text = fs.readFileSync(settingsFile, 'utf8');
  const parsed = parseSettings(text);
  expect(parsed.ok, 'src/data/settings.json parses', parsed.error || '');
  if (parsed.ok) {
    expect(serializeSettings(parsed.data) === text, 'it is stored in the desk’s canonical form, so saves diff cleanly');
    const merged = mergeSettings(parsed.data);
    expect(Boolean(merged.title.trim()), 'the site has a title');
    expect(Boolean(byId(merged.typography.body)) && Boolean(byId(merged.typography.heading)), 'the typefaces are ids the font library knows');
    expect(TEXT_SIZES.includes(merged.typography.size), 'the reading size is one of small, medium, large');
    expect(merged.social.every((link) => typeof link.label === 'string' && typeof link.url === 'string'), 'every social link is a { id, label, url } row');
    expect(validateSettings(merged).length === 0, 'the stored settings pass validation', validateSettings(merged).join(' / '));
  }

  /* The technical configuration stays in site.config.js and is not owner-editable. */
  const configSource = fs.readFileSync(path.join(root, 'src/site.config.js'), 'utf8');
  expect(configSource.includes('mergeSettings(stored)'), 'site.config.js merges settings.json over the defaults');
  expect(configSource.includes('settingsPath') && configSource.includes('resourcesDir'), 'the desk config carries the settings and resources paths');
}

/* ---------------------------------- base64 --------------------------------- */

console.log('');
console.log('  The bytes GitHub is sent');
console.log('  ------------------------');

{
  const text = 'Curly quotes — em dashes — and emoji ❧ ✓';
  expect(fromBase64(toBase64(new TextEncoder().encode(text))) === text, 'a post survives the base64 round trip');

  const bytes = new Uint8Array([0, 1, 254, 255, 137, 80, 78, 71]);
  const back = Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0));
  expect(JSON.stringify([...back]) === JSON.stringify([...bytes]), 'binary image bytes survive the round trip');

  const big = new Uint8Array(250_000).fill(65); /* 250 KB — chunked, not recursive */
  expect(atob(toBase64(big)).length === big.length, 'a large upload is encoded without blowing the stack');

  const error = new DeskError('GitHub refused this step.', { status: 403, hint: 'Contents: Read and write' });
  expect(error instanceof Error && error.hint.includes('Contents'), 'errors carry a hint a writer can act on');
}

/* -------------------------------- the page --------------------------------- */

console.log('');
console.log('  The built desk page');
console.log('  -------------------');

{
  const page = path.join(outDir, 'write', 'index.html');
  if (!fs.existsSync(page)) {
    console.log('  ·  dist/write/index.html is not built yet — run `npm run build` first');
  } else {
    const html = fs.readFileSync(page, 'utf8');
    expect(/<meta name="robots" content="noindex, nofollow">/.test(html), '/write/ is marked noindex');
    expect(html.includes('data-desk-config='), 'the desk knows which repository to write to');
    expect(!html.includes('data-subscribe-form') && !html.includes('site-foot'), 'the desk page carries no newsletter and no footer');
    expect(/<script type="module" src="\/_astro\/write[^"]+\.js">/.test(html), 'the editor is bundled locally');
    const remote = [...html.matchAll(/<script[^>]+src="(https?:[^"]+)"/g)].map((match) => match[1]);
    expect(remote.length === 0, 'no remote script is loaded by the desk', remote.join(', '));
    expect(html.includes('GitHub token'), 'the lock screen asks for a token');

    /* The lock screen speaks to visitors first, and folds the token form away. */
    expect(/This page is for the owner/.test(html), 'the lock screen tells visitors whose page it is');
    const lockHtml = html.slice(html.indexOf('data-view="lock"'), html.indexOf('data-view="library"'));
    expect(lockHtml.includes('data-back-to-site') && lockHtml.includes('href="/"'), 'visitors get a way back to the site');
    expect(lockHtml.includes('href="/blog/"'), 'and a nudge toward the reading they came for');
    expect(
      lockHtml.includes('data-owner-details') &&
        lockHtml.indexOf('data-lock-form') > lockHtml.indexOf('data-owner-details'),
      'the token form sits inside the owner’s fold'
    );
    const lockSettings = parseSettings(fs.readFileSync(settingsFile, 'utf8'));
    if (lockSettings.ok && mergeSettings(lockSettings.data).author.email) {
      expect(/data-request-access/.test(lockHtml) && /mailto:/.test(lockHtml), 'with an email in settings, visitors can request access');
    }

    /* The Settings view ships in the same page. */
    expect(html.includes('data-view="settings"'), 'the desk page carries a settings view');
    expect(html.includes('data-settings-save'), 'with a save button');
    for (const heading of ['Site identity', 'About you', 'Social links', 'Appearance', 'Newsletter', 'Resources']) {
      expect(html.includes(heading), `the settings view has a “${heading}” section`);
    }
    expect(html.includes('src/data/settings.json') && html.includes('src/content/resources'), 'the desk knows where settings and resources live');
    expect(/data-social-add="custom"/.test(html), 'custom social links can be added');
    expect(/data-setting="typography\.body"/.test(html) && /data-setting="typography\.size"/.test(html), 'the appearance pickers are bound');
    expect(html.includes('data-type-preview'), 'the appearance section has a live preview');

    const sitemap = fs.existsSync(path.join(outDir, 'sitemap.xml'))
      ? fs.readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8')
      : '';
    expect(sitemap && !sitemap.includes('/write/'), '/write/ is not in the sitemap');

    const robots = fs.existsSync(path.join(outDir, 'robots.txt'))
      ? fs.readFileSync(path.join(outDir, 'robots.txt'), 'utf8')
      : '';
    expect(robots.includes('Disallow: /write/'), 'robots.txt keeps crawlers off the desk');

    const home = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    expect(/class="btn btn-ghost btn-sm nav-write" href="\/write\/"/.test(home), 'the nav Write button points at the desk');

    const bundle = fs.readdirSync(path.join(outDir, '_astro')).find((name) => name.startsWith('write.') && name.endsWith('.js'));
    const size = bundle ? fs.statSync(path.join(outDir, '_astro', bundle)).size : 0;
    expect(bundle && size > 10_000 && size < 200_000, `the desk bundle is small (${Math.round(size / 1024)} KB)`);
  }
}

/* ------------------------------- the real build ----------------------------- */

const written = [];
let settingsBackup = null;

function cleanup() {
  for (const file of written) {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  }
  if (settingsBackup !== null) {
    try { fs.writeFileSync(settingsFile, settingsBackup); } catch { /* restore failed — say so loudly */ }
    settingsBackup = null;
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

if (fullBuild) {
  console.log('');
  console.log('  A real build of what the desk commits');
  console.log('  -------------------------------------');

  /* Exactly what pressing Publish produces: fields → data → file. */
  const CASES = [
    {
      name: 'published from a phone',
      fields: {
        title: 'Written from the desk',
        date: '2026-10-05',
        summary: 'Committed by the browser editor, with a cover image and two tags.',
        tags: 'writing, testing',
        featured: false,
        draft: false,
        cover: '/uploads/desk-cover.jpg',
      },
      body: [
        'A paragraph typed in the desk, with **bold** and a [link](https://example.com).',
        '',
        '## A section',
        '',
        '- one',
        '- two',
        '',
        '> A quotation.',
        '',
        'A <span class="c-terracotta">terracotta clause</span> and a <mark class="hl-yellow">highlight</mark>.',
        '',
        '![Inline](/uploads/desk-cover.jpg)',
        '',
      ].join('\n'),
    },
    {
      name: 'saved as a draft',
      fields: { title: 'A draft in the desk', date: '2026-10-05', tags: 'testing', draft: true },
      body: 'Half a thought.\n',
    },
  ];

  for (const testCase of CASES) {
    const slug = slugify(testCase.fields.title);
    const file = path.join(blogDir, `${slug}.md`);
    if (fs.existsSync(file)) {
      fail(testCase.name, `${slug}.md already exists — refusing to overwrite it`);
      continue;
    }
    fs.writeFileSync(file, buildPostFile(toPostData(testCase.fields), testCase.body));
    written.push(file);
  }

  /* A cover image, so the build can be checked end to end. */
  const uploads = path.join(root, 'public/uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const cover = path.join(uploads, 'desk-cover.jpg');
  if (!fs.existsSync(cover)) {
    fs.writeFileSync(cover, Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
    written.push(cover);
  }

  /* A resource file, exactly as the Settings view's Resources editor commits it. */
  const testResource = path.join(resourcesDir, 'desk-test-resource.md');
  if (!fs.existsSync(testResource)) {
    fs.writeFileSync(testResource, buildResourceFile({
      title: 'Desk Test Resource',
      url: 'https://example.com/desk-test',
      category: 'Testing',
      description: 'Committed by the desk test, deleted straight after.',
      order: 99,
    }));
    written.push(testResource);
  }

  /* A settings override, exactly as Save settings commits it — the original is
     kept in memory and restored by cleanup(), whatever happens. */
  if (fs.existsSync(settingsFile)) {
    settingsBackup = fs.readFileSync(settingsFile, 'utf8');
    fs.writeFileSync(settingsFile, serializeSettings(mergeSettings({
      ...JSON.parse(settingsBackup),
      title: 'The Slow Draft (desk test)',
      hero: { heading: 'A hero written by the desk test.' },
      author: { aboutHeading: 'An About heading from settings.' },
      typography: { body: 'inter', heading: 'poppins', size: 'large' },
    })));
  }

  if (!problems.length) {
    process.stdout.write(`\n  Wrote ${written.length} files the way the desk does. Building… `);
    try {
      execFileSync('npx', ['astro', 'build'], { cwd: root, stdio: 'pipe' });
      console.log('ok\n');
    } catch (error) {
      console.log('FAILED\n');
      console.error(String(error.stdout || '').split('\n').slice(-25).join('\n'));
      console.error(String(error.stderr || '').split('\n').slice(-25).join('\n'));
      process.exit(1);
    }

    const live = CASES[0];
    const slug = slugify(live.fields.title);
    const page = path.join(outDir, 'blog', slug, 'index.html');
    const html = fs.existsSync(page) ? fs.readFileSync(page, 'utf8') : '';

    expect(html.length > 0, `the desk-written post built to /blog/${slug}/`);
    expect(html.includes(live.fields.title), 'its title is on the page');
    expect(/<h2[^>]*>A section<\/h2>/.test(html), 'its headings rendered');
    expect(/<li>/.test(html), 'its list rendered');
    expect(/<blockquote>/.test(html), 'its quotation rendered');
    expect(html.includes('c-terracotta'), 'the pen colour survived');
    expect(html.includes('hl-yellow'), 'the highlight survived');
    expect(html.includes('/uploads/desk-cover.jpg'), 'the cover image is referenced');
    expect(/href="\/blog\/tag\//.test(html), 'its tags got tag pages');

    const rss = fs.readFileSync(path.join(outDir, 'rss.xml'), 'utf8');
    const sitemap = fs.readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8');
    expect(rss.includes(slug), 'it reached rss.xml');
    expect(sitemap.includes(slug), 'it reached sitemap.xml');

    const draftSlug = slugify(CASES[1].fields.title);
    expect(!fs.existsSync(path.join(outDir, 'blog', draftSlug)), 'the draft stayed out of the build');
    expect(!rss.includes(draftSlug) && !sitemap.includes(draftSlug), 'the draft reached neither feed nor sitemap');

    /* The settings the desk committed, built into the site. */
    const home = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    expect(home.includes('The Slow Draft (desk test)'), 'the settings title reached the home page');
    expect(home.includes('A hero written by the desk test.'), 'the hero heading came from settings.json');
    expect(/font-inter/.test(home) && /size-large/.test(home), 'the appearance picks became body classes');
    expect(home.includes('Poppins'), 'the heading typeface became a CSS variable');
    expect(rss.includes('The Slow Draft (desk test)'), 'the settings title reached rss.xml');

    const about = fs.readFileSync(path.join(outDir, 'about', 'index.html'), 'utf8');
    expect(about.includes('An About heading from settings.'), 'the About heading override reached /about/');

    const resourcesPage = fs.readFileSync(path.join(outDir, 'resources', 'index.html'), 'utf8');
    expect(resourcesPage.includes('Desk Test Resource'), 'the desk-written resource reached /resources/');
    expect(resourcesPage.includes('https://example.com/desk-test'), 'with its link');

    cleanup();
    written.length = 0;
    if (!process.argv.includes('--keep')) {
      process.stdout.write('  Rebuilding from your real content… ');
      try {
        execFileSync('npx', ['astro', 'build'], { cwd: root, stdio: 'pipe' });
        console.log('ok');
      } catch {
        console.log('FAILED (run `npm run build` before deploying)');
      }
    }
  }
}

/* ---------------------------------- report --------------------------------- */

console.log('');
if (problems.length) {
  for (const problem of problems) console.log(`  BROKEN  ${problem}`);
  console.log(`\n  ${problems.length} problem(s) in the writing desk\n`);
  process.exit(1);
}

console.log(`  ${checks} checks passed.${fullBuild ? ' Everything the desk writes, Astro builds.' : ' Run `npm run test:desk` for the full build round trip.'}`);
console.log('  The writing desk is safe to publish from.\n');
