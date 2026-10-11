#!/usr/bin/env node
/**
 * A full writing session, run in a real DOM.
 *
 * The desk has no server to test, so this is the next best thing to sitting down
 * with it: the built /write/ page is loaded into jsdom, GitHub is replaced by an
 * in-memory repository, and a writer unlocks the desk, opens a post, writes a new
 * one with the pen menu, publishes it, saves a draft, renames a post, hits a
 * protected branch and locks up again.
 *
 * What it proves:
 *   · a visitor with no token sees a lock screen and nothing is fetched at all
 *   · unlocking, listing, editing and committing all send the right requests
 *   · the markdown the desk commits is the markdown the site's schema expects
 *   · unfinished writing survives the page being closed, and comes back
 *
 *   npm run check:desk:ui      (needs `npm run build` first — it reads dist/)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { mountDesk } from '../src/lib/desk/desk.js';
import { buildPostFile, toPostData } from '../src/lib/desk/frontmatter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = path.join(root, 'dist/write/index.html');

if (!fs.existsSync(pagePath)) {
  console.error('\n  dist/write/index.html is missing — run `npm run build` first.\n');
  process.exit(1);
}

const PAGE_HTML = fs.readFileSync(pagePath, 'utf8');
const CONFIG = {
  owner: 'haydaycreates',
  repo: 'haydaycreates.github.io',
  branch: 'main',
  postsDir: 'src/content/blog',
  mediaDir: 'public/uploads',
};
const TOKEN = 'github_pat_TESTTOKEN';

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

/* --------------------------- an in-memory GitHub --------------------------- */

const SEED = {
  'src/content/blog/an-older-post.md': buildPostFile(
    toPostData({
      title: 'An older post',
      date: '2026-08-02',
      summary: 'Already on the site.',
      tags: 'writing',
      draft: false,
    }),
    'Published writing that the desk should be able to open and edit.\n'
  ),
  'src/content/blog/a-rough-draft.md': buildPostFile(
    toPostData({ title: 'A rough draft', date: '2026-09-20', tags: '', draft: true }),
    'Not finished.\n'
  ),
};

function createGitHub({ protectMain = false } = {}) {
  const files = new Map(Object.entries(SEED));
  const requests = [];
  let shaCounter = 0;
  const nextSha = () => `sha${(shaCounter += 1)}`.padEnd(40, '0');
  const commitSha = () => `c0ffee${(shaCounter += 1)}`.padEnd(40, '0');

  const respond = (data, status = 200) => ({
    ok: status < 400,
    status,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
    headers: new Map(),
  });

  async function fetchMock(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const target = new URL(url, 'https://api.github.com');
    const body = options.body ? JSON.parse(options.body) : null;
    const record = { method, url: target.href, path: decodeURIComponent(target.pathname), query: target.search, body, headers: options.headers || {} };
    requests.push(record);

    if (!url.startsWith('https://api.github.com')) {
      /* The desk polls the published post after committing; the site itself is
         not part of this test. */
      return respond({ status: 'not part of the test' }, 404);
    }

    const { path: pathname } = record;
    const repo = `/repos/${CONFIG.owner}/${CONFIG.repo}`;

    if (pathname === '/user') return respond({ login: 'chirag' });
    if (pathname === repo) {
      return respond({
        full_name: `${CONFIG.owner}/${CONFIG.repo}`,
        owner: { login: CONFIG.owner },
        private: false,
        default_branch: CONFIG.branch,
        permissions: { admin: false, push: true, pull: true },
      });
    }
    if (pathname === `${repo}/git/ref/heads/${CONFIG.branch}`) return respond({ object: { sha: 'basesha' } });
    if (pathname === `${repo}/git/refs` && method === 'POST') {
      return respond({ ref: body.ref, object: { sha: body.sha } }, 201);
    }

    if (pathname.startsWith(`${repo}/contents/`)) {
      const filePath = pathname.slice(`${repo}/contents/`.length);

      if (method === 'GET' && filePath === CONFIG.postsDir) {
        return respond(
          [...files.keys()]
            .filter((name) => name.startsWith(`${CONFIG.postsDir}/`))
            .map((name) => ({
              name: name.split('/').pop(),
              path: name,
              sha: 'listed-sha',
              size: files.get(name).length,
              type: 'file',
            }))
        );
      }

      if (method === 'GET') {
        if (!files.has(filePath)) return respond({ message: 'Not Found' }, 404);
        const content = files.get(filePath);
        return respond({
          name: filePath.split('/').pop(),
          path: filePath,
          sha: 'read-sha',
          content: Buffer.from(content, 'utf8').toString('base64'),
          encoding: 'base64',
        });
      }

      if (method === 'PUT') {
        if (protectMain && body.branch === CONFIG.branch) {
          return respond({ message: 'You are not allowed to push directly to this protected branch' }, 403);
        }
        if (files.has(filePath) && !body.sha) {
          return respond({ message: 'sha is required to update the file' }, 422);
        }
        files.set(filePath, Buffer.from(body.content, 'base64').toString('utf8'));
        record.branch = body.branch;
        return respond({
          content: { path: filePath, sha: nextSha() },
          commit: { sha: commitSha(), html_url: `https://github.com/${CONFIG.owner}/${CONFIG.repo}/commit/abc1234` },
        });
      }

      if (method === 'DELETE') {
        files.delete(filePath);
        return respond({ commit: { sha: commitSha() } });
      }
    }

    return respond({ message: `Unhandled in the test: ${method} ${pathname}` }, 404);
  }

  return { fetchMock, requests, files };
}

/* ------------------------------- the desk DOM ------------------------------ */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Autosave is debounced by 700 ms; wait past it. */
const settle = () => sleep(850);

function openDesk({ wide = false, storage = {}, protectMain = false } = {}) {
  const dom = new JSDOM(PAGE_HTML, {
    url: `https://theslowdraft.netlify.app/write/`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;

  /* jsdom has no matchMedia; the desk uses it to decide one pane or two. */
  window.matchMedia = (query) => ({
    matches: wide && /min-width/.test(query),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
  window.scrollTo = () => {};

  const github = createGitHub({ protectMain });

  /* The desk's modules reach for these as globals, exactly as a browser has them.
     Node 22 defines some of them (navigator) as getter-only, so assign by
     descriptor rather than plain assignment. */
  const define = (name, value) =>
    Object.defineProperty(global, name, { value, writable: true, configurable: true });
  define('window', window);
  define('document', window.document);
  define('localStorage', window.localStorage);
  define('sessionStorage', window.sessionStorage);
  define('navigator', window.navigator);
  define('fetch', github.fetchMock);

  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);

  const desk = window.document.getElementById('desk');
  mountDesk(desk);

  const $ = (selector) => desk.querySelector(selector);
  const $$ = (selector) => [...desk.querySelectorAll(selector)];
  const visible = (selector) => {
    const element = $(selector);
    return Boolean(element && !element.hidden);
  };
  const view = () => ['lock', 'library', 'editor', 'done'].find((name) => visible(`[data-view="${name}"]`));
  const type = (selector, value) => {
    const element = $(selector);
    element.value = value;
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const click = (selector) => $(selector).click();
  const submit = (selector) =>
    $(selector).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  return { window, desk, $, $$, visible, view, type, click, submit, github, settle };
}

async function unlock(session, token = TOKEN) {
  session.type('[data-token-input]', token);
  session.submit('[data-lock-form]');
  await sleep(30);
  await sleep(30);
}

const lastPut = (session) => [...session.github.requests].reverse().find((request) => request.method === 'PUT');
const decoded = (request) => Buffer.from(request.body.content, 'base64').toString('utf8');

/* ================================= scenarios =============================== */

async function scenarioVisitor() {
  console.log('\n  A visitor who is not you');
  console.log('  ------------------------');
  const session = openDesk();
  await sleep(20);

  expect(session.view() === 'lock', 'they land on the lock screen', session.view());
  expect(!session.visible('[data-view="library"]') && !session.visible('[data-view="editor"]'), 'the library and editor are not on screen');
  expect(session.github.requests.length === 0, 'nothing at all is fetched before a token exists', `${session.github.requests.length} requests`);
  expect(session.$('[data-repo-label]').textContent === `${CONFIG.owner}/${CONFIG.repo}`, 'the lock screen says which repository it writes to');
  expect(/Fine-grained/.test(session.$('.desk-help').textContent), 'the token recipe is on the page');
}

async function scenarioBadToken() {
  console.log('\n  A token that does not work');
  console.log('  --------------------------');
  const session = openDesk();

  /* Answer the way GitHub answers an expired or revoked token. */
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ message: 'Bad credentials' }),
    headers: new Map(),
  });

  await unlock(session, 'github_pat_expired');
  const note = session.$('[data-lock-note]');

  expect(session.view() === 'lock', 'a rejected token leaves you on the lock screen', session.view());
  expect(/rejected/i.test(note.textContent), 'it says the token was rejected', note.textContent);
  expect(/new fine-grained token/i.test(note.textContent), 'it says what to do about it', note.textContent);
  expect(note.classList.contains('is-error'), 'the message is styled as an error');
  expect(!session.window.localStorage.getItem('slowdraft.desk.token'), 'a bad token is not stored on the device');

  global.fetch = session.github.fetchMock;
}

async function scenarioLibrary() {
  console.log('\n  Unlocking and looking at the library');
  console.log('  ------------------------------------');
  const session = openDesk();
  await unlock(session);

  expect(session.view() === 'library', 'the library opens', session.view());
  expect(session.$('[data-signed-in]').textContent.includes('chirag'), 'it says who is signed in');
  expect(session.$('[data-counts]').textContent === '1 published · 1 draft', 'it counts posts and drafts', session.$('[data-counts]').textContent);
  expect(session.$$('[data-list] .desk-item').length === 2, 'both posts are listed');

  const chips = session.$$('[data-list] .chip').map((chip) => chip.textContent.trim()).sort();
  expect(chips.join(',') === 'Draft,Live', 'each post is marked Live or Draft', chips.join(','));
  expect(session.$('[data-list] .desk-item-view[href="/blog/an-older-post/"]'), 'a published post links to its page');

  const auth = session.github.requests.every((request) =>
    request.headers.Authorization === `Bearer ${TOKEN}`
  );
  expect(auth, 'every request carries your token as a Bearer header');
  expect(
    session.github.requests.every((request) => request.url.startsWith('https://api.github.com/')),
    'and every request goes only to api.github.com'
  );
  expect(session.window.localStorage.getItem('slowdraft.desk.token') === TOKEN, 'the token is kept on the device you chose');

  session.click('[data-filter="draft"]');
  expect(session.$$('[data-list] .desk-item').length === 1, 'the Drafts filter narrows the list');
  session.click('[data-filter="live"]');
  expect(session.$$('[data-list] .desk-item').length === 1, 'so does Published');
  session.click('[data-filter="all"]');
  return session;
}

async function scenarioOpenPost() {
  console.log('\n  Opening a post that is already published');
  console.log('  ----------------------------------------');
  const session = openDesk();
  await unlock(session);

  const button = session.$$('[data-list] .desk-item-open').find((item) =>
    item.textContent.includes('An older post')
  );
  button.click();
  await sleep(40);

  expect(session.view() === 'editor', 'the editor opens', session.view());
  expect(session.$('[data-field="title"]').value === 'An older post', 'the title is filled in');
  expect(session.$('[data-field="slug"]').value === 'an-older-post', 'so is the address');
  expect(session.$('[data-field="date"]').value === '2026-08-02', 'and the date');
  expect(session.$('[data-field="summary"]').value === 'Already on the site.', 'and the summary');
  expect(session.$('[data-field="tags"]').value === 'writing', 'and the tags');
  expect(/Published writing/.test(session.$('[data-field="body"]').value), 'and the body');
  expect(session.$('[data-mode="live"]').classList.contains('is-on'), 'it is marked Published');
  expect(session.$('[data-publish]').textContent === 'Save changes', 'the main button says Save changes', session.$('[data-publish]').textContent);
  expect(/^\d+ words · \d+ min read$/.test(session.$('[data-count]').textContent), 'the word count and reading time are showing', session.$('[data-count]').textContent);
}

async function scenarioPublish() {
  console.log('\n  Writing a new post on a phone and publishing it');
  console.log('  -----------------------------------------------');
  const session = openDesk();
  await unlock(session);
  session.click('[data-new]');
  await sleep(20);

  expect(session.view() === 'editor', 'the editor opens for a new post');
  expect(session.$('[data-mode="draft"]').classList.contains('is-on'), 'a new post starts as a draft');
  expect(session.$('[data-publish]').textContent === 'Save draft', 'so the main button says Save draft', session.$('[data-publish]').textContent);

  session.type('[data-field="title"]', 'Written from the desk');
  await sleep(20);
  expect(session.$('[data-field="slug"]').value === 'written-from-the-desk', 'the address follows the title');
  expect(session.$('[data-url-hint]').textContent === '/blog/written-from-the-desk/', 'and the page shows where it will live');

  /* The pen menu: select some words, tap a swatch. */
  const body = session.$('[data-field="body"]');
  body.value = 'A first sentence and a clause worth keeping.';
  body.dispatchEvent(new session.window.Event('input', { bubbles: true }));
  const phrase = 'a clause worth keeping';
  body.selectionStart = body.value.indexOf(phrase);
  body.selectionEnd = body.selectionStart + phrase.length;
  session.click('[data-pens-toggle]');
  expect(session.visible('[data-pens]'), 'the pen menu opens');
  expect(session.$$('[data-pen]').length === 9, 'nine pens', `${session.$$('[data-pen]').length}`);
  expect(session.$$('[data-mark]').length === 6, 'six highlighters', `${session.$$('[data-mark]').length}`);
  expect(session.$$('[data-font]').length === 9, 'nine typefaces', `${session.$$('[data-font]').length}`);
  session.click('[data-pen="c-terracotta"]');
  expect(
    body.value.includes('<span class="c-terracotta">a clause worth keeping</span>'),
    'the pen wraps the selected words in the site’s own HTML',
    body.value
  );
  expect(!session.visible('[data-pens]'), 'and closes the menu again');

  /* Toolbar: bold the opening words. */
  const opening = 'A first sentence';
  body.selectionStart = 0;
  body.selectionEnd = opening.length;
  session.click('[data-tool="bold"]');
  expect(body.value.startsWith(`**${opening}**`), 'the toolbar bolds a selection', body.value.slice(0, 30));

  /* Preview, then publish. */
  session.type('[data-field="summary"]', 'Committed from a browser, straight to git.');
  session.type('[data-field="tags"]', 'writing, testing, writing');
  session.click('[data-pane="preview"]');
  await sleep(20);
  expect(session.visible('[data-pane-view="preview"]'), 'the preview pane opens');
  expect(session.$('[data-preview-title]').textContent === 'Written from the desk', 'the preview shows the title');
  expect(session.$('[data-preview]').innerHTML.includes('c-terracotta'), 'the preview shows the pen colour');
  expect(session.$('[data-preview]').innerHTML.includes('<strong>A first sentence</strong>'), 'and the bold');
  session.click('[data-pane="write"]');

  session.click('[data-mode="live"]');
  expect(session.$('[data-publish]').textContent === 'Publish', 'switching to Published makes the button say Publish');

  session.click('[data-publish]');
  await sleep(60);

  const put = lastPut(session);
  expect(Boolean(put), 'the desk committed something');
  expect(
    put.path === `/repos/${CONFIG.owner}/${CONFIG.repo}/contents/src/content/blog/written-from-the-desk.md`,
    'to the right path in the repository',
    put.path
  );
  expect(put.body.branch === 'main', 'on the branch the site builds from');
  expect(put.body.message === 'Publish “Written from the desk”', 'with a readable commit message', put.body.message);

  const file = decoded(put);
  expect(file.startsWith('---\ntitle: "Written from the desk"\n'), 'the file starts with frontmatter');
  expect(!/^draft:/m.test(file), 'a published post carries no draft line');
  expect(file.includes('tags: ["writing", "testing"]'), 'tags are written once each');
  expect(file.includes('summary: "Committed from a browser, straight to git."'), 'the summary is there');
  expect(file.includes('<span class="c-terracotta">a clause worth keeping</span>'), 'the pen survived the trip');
  expect(file.includes('**A first sentence**'), 'and so did the bold');
  expect(file.endsWith('\n') && !file.endsWith('\n\n'), 'the file ends with exactly one newline');

  expect(session.view() === 'done', 'the desk says it is committed', session.view());
  expect(session.$('[data-done-title]').textContent === 'Written from the desk', 'with the title');
  expect(session.$('[data-done-sha]').textContent.length === 7, 'the short commit sha');
  expect(session.$('[data-done-post]').getAttribute('href') === '/blog/written-from-the-desk/', 'a link to the post');
  expect(!session.visible('[data-done-compare-row]'), 'and no pull-request row for a normal commit');
  expect(session.github.files.get('src/content/blog/written-from-the-desk.md') === file, 'the repository now holds exactly that file');
  expect(!session.window.localStorage.getItem('slowdraft.desk.wip'), 'the local copy of the draft is cleared once it is safe in git');

  /* The desk can open what it just wrote. */
  session.click('[data-done-library]');
  await sleep(60);
  expect(session.$$('[data-list] .desk-item').length === 3, 'the new post is in the library');
  return session;
}

async function scenarioDraftAndRename() {
  console.log('\n  Saving a draft, then renaming a post');
  console.log('  ------------------------------------');
  const session = openDesk();
  await unlock(session);

  /* A draft, saved from the default mode. */
  session.click('[data-new]');
  await sleep(20);
  session.type('[data-field="title"]', 'Something unfinished');
  session.type('[data-field="body"]', 'Half a thought, on a phone, in a queue.');
  await session.settle();
  session.click('[data-publish]'); /* the button reads "Save draft" */
  await sleep(60);

  let put = lastPut(session);
  let file = decoded(put);
  expect(put.body.message === 'Draft “Something unfinished”', 'the draft commit says Draft', put.body.message);
  expect(file.includes('draft: true'), 'the file is marked draft, so the build skips it');
  expect(session.view() === 'done' && !session.visible('[data-done-post]'), 'the done screen offers no link, because there is no page yet');

  /* Renaming an existing post moves the file rather than leaving two behind. */
  session.click('[data-done-library]');
  await sleep(60);
  const item = session.$$('[data-list] .desk-item-open').find((element) => element.textContent.includes('An older post'));
  item.click();
  await sleep(40);
  session.type('[data-field="slug"]', 'an-older-post-renamed');
  await sleep(20);
  expect(/Renaming moves the post/.test(session.$('[data-slug-note]').textContent), 'the desk warns that a rename moves the address');
  session.click('[data-publish]');
  await sleep(80);

  const writes = session.github.requests.filter((request) => request.method === 'PUT');
  const deletes = session.github.requests.filter((request) => request.method === 'DELETE');
  expect(writes.some((request) => request.path.endsWith('an-older-post-renamed.md')), 'the renamed file is written');
  expect(deletes.some((request) => request.path.endsWith('an-older-post.md')), 'and the old one is removed');
  expect(!session.github.files.has('src/content/blog/an-older-post.md'), 'so the post does not appear twice on the site');
  expect(session.github.files.get('src/content/blog/an-older-post-renamed.md')?.includes('title: "An older post"'), 'with the same writing inside');
  expect(lastPut(session).body.message === 'Update “An older post”', 'and an honest commit message', lastPut(session).body.message);
}

async function scenarioProtectedBranch() {
  console.log('\n  A repository whose main branch is protected');
  console.log('  -------------------------------------------');
  const session = openDesk({ protectMain: true });
  await unlock(session);
  session.click('[data-new]');
  await sleep(20);
  session.type('[data-field="title"]', 'Blocked on main');
  session.type('[data-field="body"]', 'The branch will not take a direct commit.');
  session.click('[data-mode="live"]');
  session.click('[data-publish]');
  await sleep(60);

  expect(session.visible('[data-fallback]'), 'the desk explains the refusal and offers a way through');
  expect(/protected|refused/i.test(session.$('[data-fallback-text]').textContent), 'in words a writer understands', session.$('[data-fallback-text]').textContent.slice(0, 80));

  session.click('[data-fallback-go]');
  await sleep(80);

  const refPost = session.github.requests.find((request) => request.method === 'POST' && request.path.endsWith('/git/refs'));
  expect(Boolean(refPost), 'it made a branch of your own');
  expect(refPost.body.ref.startsWith('refs/heads/desk/blocked-on-main-'), 'named after the post', refPost.body.ref);

  const branchPut = session.github.requests.filter((request) => request.method === 'PUT').pop();
  expect(branchPut.body.branch.startsWith('desk/blocked-on-main-'), 'and committed the post there');
  expect(session.view() === 'done', 'then reported what it did', session.view());
  expect(session.visible('[data-done-compare-row]'), 'with a link to open a pull request');
  expect(/compare\/main\.\.\.desk\//.test(session.$('[data-done-compare]').getAttribute('href')), 'pointing at the right comparison', session.$('[data-done-compare]').getAttribute('href'));
}

async function scenarioAutosaveAndReturn() {
  console.log('\n  A phone that locks mid-sentence');
  console.log('  -------------------------------');
  const session = openDesk();
  await unlock(session);
  session.click('[data-new]');
  await sleep(20);
  session.type('[data-field="title"]', 'A post interrupted');
  session.type('[data-field="body"]', 'The first line, and then the screen went dark.');
  await session.settle();

  expect(/Saved on this device/.test(session.$('[data-autosave]').textContent), 'the desk says it kept your words', session.$('[data-autosave]').textContent);
  const wip = session.window.localStorage.getItem('slowdraft.desk.wip');
  expect(Boolean(wip) && JSON.parse(wip).fields.body.includes('screen went dark'), 'the unfinished post is in local storage');

  /* Come back later: a fresh page, the same device storage. */
  const returned = openDesk({ storage: { 'slowdraft.desk.token': TOKEN, 'slowdraft.desk.wip': wip } });
  await sleep(60);

  expect(returned.view() === 'library', 'a saved token signs you straight back in', returned.view());
  expect(returned.visible('[data-resume]'), 'and offers the unfinished post back');
  expect(returned.$('[data-resume-title]').textContent === 'A post interrupted', 'by its title', returned.$('[data-resume-title]').textContent);

  returned.click('[data-resume]');
  await sleep(30);
  expect(returned.view() === 'editor', 'one tap reopens it');
  expect(returned.$('[data-field="body"]').value.includes('screen went dark'), 'with every word still there');

  /* Locking up removes the key from the device. */
  returned.click('[data-back]');
  await sleep(60);
  returned.click('[data-lock-now]');
  await sleep(20);
  expect(returned.view() === 'lock', 'Lock returns to the lock screen');
  expect(!returned.window.localStorage.getItem('slowdraft.desk.token'), 'and removes the token from the device');
}

async function scenarioWideScreen() {
  console.log('\n  The same desk on a wide screen');
  console.log('  ------------------------------');
  const session = openDesk({ wide: true });
  await unlock(session);
  session.click('[data-new]');
  await sleep(20);
  session.type('[data-field="title"]', 'Split view');
  session.type('[data-field="body"]', 'Written beside its own preview.');

  expect(session.$('[data-editor]').classList.contains('is-split'), 'the editor goes side by side');
  expect(session.visible('[data-pane-view="write"]') && session.visible('[data-pane-view="preview"]'), 'both panes are on screen');
  await session.settle();
  expect(session.$('[data-preview]').innerHTML.includes('Written beside'), 'the preview keeps up as you type');
  expect(session.$('[data-preview]').innerHTML.startsWith('<p>'), 'and renders paragraphs, not raw markdown');
}

async function scenarioSessionOnly() {
  console.log('\n  A shared phone: this session only');
  console.log('  ---------------------------------');
  const session = openDesk();
  session.$('[name="remember"][value="session"]').checked = true;
  await unlock(session);
  expect(session.view() === 'library', 'the desk unlocks');
  expect(session.window.sessionStorage.getItem('slowdraft.desk.token') === TOKEN, 'the token went to session storage');
  expect(!session.window.localStorage.getItem('slowdraft.desk.token'), 'and not to the device — closing the tab forgets it');
}

/* ================================== run =================================== */

(async function run() {
  console.log('');
  console.log('  The writing desk — a full session in a real DOM');
  console.log('  ===============================================');

  const scenarios = [
    scenarioVisitor,
    scenarioBadToken,
    scenarioOpenPost,
    scenarioPublish,
    scenarioDraftAndRename,
    scenarioProtectedBranch,
    scenarioAutosaveAndReturn,
    scenarioWideScreen,
    scenarioSessionOnly,
  ];

  for (const scenario of scenarios) {
    try {
      await scenario();
    } catch (error) {
      fail(`${scenario.name} crashed`, error.message);
      console.error(error.stack?.split('\n').slice(0, 4).join('\n'));
    }
  }

  console.log('');
  if (problems.length) {
    for (const problem of problems) console.log(`  BROKEN  ${problem}`);
    console.log(`\n  ${problems.length} problem(s) in the writing desk session\n`);
    process.exit(1);
  }
  console.log(`  ${checks} checks passed across ${scenarios.length} sessions.`);
  console.log('  Unlock, write, publish, draft, rename, recover — the desk does all of it.\n');
  process.exit(0);
})();
