#!/usr/bin/env node
/**
 * Post-build asset audit.
 *
 * A static site breaks quietly: one wrong path and a font, stylesheet or image
 * simply does not load, and nothing errors anywhere. This walks the built HTML
 * and checks that every local reference actually exists on disk — pages, CSS,
 * JavaScript, fonts (including the ones referenced inside fonts.css), uploaded
 * images and the CMS config.
 *
 *   npm run check:links
 *
 * Exits non-zero on the first broken reference, so CI can gate a deploy on it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist');

if (!fs.existsSync(outDir)) {
  console.error('\n  dist/ does not exist — run `npm run build` first.\n');
  process.exit(1);
}

/* ------------------------------- gather files ----------------------------- */

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

const files = walk(outDir);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const relative = (file) => path.relative(outDir, file) || 'index.html';

/* -------------------------------- resolve a URL --------------------------- */

const SKIP_SCHEMES = /^(https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i;

/**
 * "/blog/my-post/"  → dist/blog/my-post/index.html
 * "/styles.css"     → dist/styles.css
 * "/"               → dist/index.html
 */
function resolveUrl(url) {
  const clean = url.split('#')[0].split('?')[0];
  if (!clean) return { ok: true, note: 'fragment' };
  const rel = clean.replace(/^\//, '');
  const candidates = [];

  if (clean.endsWith('/') || rel === '') {
    candidates.push(path.join(outDir, rel, 'index.html'));
  } else {
    candidates.push(path.join(outDir, rel));
    candidates.push(path.join(outDir, rel, 'index.html'));
    if (!path.extname(rel)) candidates.push(path.join(outDir, `${rel}.html`));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return { ok: true, file: candidate };
  }
  return { ok: false, tried: candidates.map((c) => path.relative(outDir, c)) };
}

/* --------------------------------- check HTML ----------------------------- */

const problems = [];
let checked = 0;
const byKind = new Map();

const ATTR_RE = /(?:href|src|poster)\s*=\s*"([^"]+)"/gi;

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = ATTR_RE.exec(html))) {
    const url = match[1].trim();
    if (!url || SKIP_SCHEMES.test(url)) continue;

    checked++;
    const result = resolveUrl(url);
    const ext = path.extname(url.split('?')[0]) || '(page)';
    byKind.set(ext, (byKind.get(ext) || 0) + 1);

    if (!result.ok) {
      problems.push(`${relative(file)}  →  ${url}   (looked for ${result.tried.join(' or ')})`);
    }
  }
}

/* ---------------------- fonts referenced inside stylesheets --------------- */

const CSS_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
const cssFiles = files.filter((f) => f.endsWith('.css'));
let fontRefs = 0;

for (const file of cssFiles) {
  const css = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = CSS_URL_RE.exec(css))) {
    const url = match[1].trim();
    if (SKIP_SCHEMES.test(url)) continue;
    fontRefs++;
    const result = resolveUrl(url);
    if (!result.ok) {
      problems.push(`${relative(file)}  →  ${url}   (a font or image the stylesheet expects)`);
    }
  }
}

/* ---------------------------------- report -------------------------------- */

const sizeOf = (dir) => {
  let total = 0;
  for (const file of walk(dir)) total += fs.statSync(file).size;
  return total;
};
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

console.log('');
console.log(`  pages            ${htmlFiles.length}`);
console.log(`  local links      ${checked} checked across those pages`);
console.log(`  stylesheet refs  ${fontRefs} checked (fonts and images)`);
console.log(`  total output     ${files.length} files, ${kb(sizeOf(outDir))}`);
console.log('');

const kinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(`  link kinds       ${kinds.map(([k, n]) => `${k} ×${n}`).join(', ')}`);
console.log('');

if (problems.length) {
  for (const problem of problems) console.log(`  BROKEN  ${problem}`);
  console.log(`\n  ${problems.length} broken reference(s) in the build\n`);
  process.exit(1);
}

console.log('  Every local link, font path and asset resolves. Safe to deploy.\n');
