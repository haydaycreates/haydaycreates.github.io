#!/usr/bin/env node
/**
 * Tests the private writing desk at /write/.
 *
 * The desk has no server, so the contract worth proving is the same one the CMS
 * test proves: "anything the editor writes, Astro builds". The desk serialises
 * frontmatter itself and renders its own preview, so this checks both halves —
 * the markdown preview, the frontmatter it reads and writes, the base64 the
 * GitHub API is given, and finally a real build of a desk-written post.
 *
 *   npm run check:desk          fast: the editor's own logic + the built page
 *   npm run test:desk           …plus a real build of posts the desk wrote
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
import { toBase64, fromBase64, DeskError } from '../src/lib/desk/github.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blogDir = path.join(root, 'src/content/blog');
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

function cleanup() {
  for (const file of written) {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
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
