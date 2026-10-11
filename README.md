# The Slow Draft — Astro static site

A personal blog with essays, an about page, recommended resources and an RSS feed.
Built with **Astro 7** as a fully static site: `npm run build` writes plain HTML,
CSS and fonts — no server, no database, no runtime dependencies.

The site lives on **GitHub Pages** at **https://haydaycreates.github.io/**: every
merge to `main` is built and published by GitHub Actions, free and unlimited.
(Netlify is the retired former host; Cloudflare Pages is the documented future
move — see [DEPLOYMENT.md](DEPLOYMENT.md).)

The design is the same warm-paper look as before: the same stylesheet, the same
self-hosted typefaces, the same layout, verified page by page against the
original build.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:4321 — writing with live reload
npm run build      # → ./dist   (17 pages, ~1s)
npm run preview    # serve ./dist locally to check the real output
npm run verify     # build + writing desk (two suites) + link audit

npm run check:desk     # the desk's markdown, frontmatter and built page
npm run check:desk:ui  # a whole writing session, driven in a real DOM
npm run test:desk      # …and a real build of a post the desk committed
```

Requires **Node 22.12+** (Astro 7's minimum).

---

## Writing from the browser — the private desk at /write/

Your editor is a single page in the site itself: **`/write/`**. Open it on your
phone or laptop, paste a GitHub token once, and write. Pressing **Publish**
commits the markdown file straight to this repository; your host sees the commit,
rebuilds, and the post is live about a minute later.

There is **no server, no database and no CMS behind it** — the page is 30 KB of
bundled JavaScript that talks only to `api.github.com`, so it works on GitHub
Pages, Cloudflare Pages, Netlify or anywhere else without configuration.

### Why nobody else can write

- The page does nothing at all until a token is entered — a visitor who finds it
  sees a lock screen, and not one request leaves their browser.
- The token is *yours*, kept in your own browser (localStorage, or sessionStorage
  if you choose "this session only"). It is never stored in the repo, the build,
  a cookie or a server.
- Writing is authorised by GitHub, not by the page: the token only works for
  whoever owns it, and you can revoke it in one click.
- `/write/` is marked `noindex` in its own HTML, disallowed in `robots.txt`, and
  left out of the sitemap. (On hosts that support response headers it also gets
  an `X-Robots-Tag: noindex` header; GitHub Pages does not, and does not need
  to — the first two travel with the files.)

Set `writeLink: ''` in `src/site.config.js` if you would rather the header had no
"Write" button at all — the page still works at its address.

### One-time setup: a GitHub token (two minutes)

1. Open **GitHub → Settings → Developer settings → Fine-grained tokens →
   Generate new token** (<https://github.com/settings/personal-access-tokens/new>).
2. **Repository access:** "Only select repositories" → *this* repository.
3. **Permissions → Repository permissions → Contents:** `Read and write`.
   That single permission is all the desk needs.
4. Generate it, copy the `github_pat_…` string, and paste it into `/write/`.
   Choose **Keep on this device** for your own phone, **This session only**
   anywhere shared.

The desk currently points at `haydaycreates/haydaycreates.github.io`. If the
repository is ever forked or renamed again, update `writeDesk` in
`src/site.config.js` — owner, repo, branch, posts folder and media folder all
live there.

### What the desk does

| | |
|---|---|
| **Library** | every post, marked Live or Draft, with filter chips |
| **Write / Preview** | one pane on a phone, side by side on a wide screen |
| **Pen menu** | the nine pens, six highlighters and nine typefaces your stylesheet already defines |
| **Toolbar** | bold, italic, heading, quote, list, link |
| **Photos** | upload from the camera roll straight into `public/uploads/` |
| **Autosave** | unfinished writing is kept on the device, and offered back next visit |
| **Drafts** | saved with `draft: true`, so the build leaves them off the site entirely |
| **Rename** | changing the address moves the file, so a post never appears twice |
| **Protected `main`** | falls back to committing on a branch and gives you a pull-request link |
| **Live check** | after publishing it watches for the new page and tells you when it is up |

### Verification built in

```bash
npm run check:desk      # markdown preview, frontmatter round trips, base64, built page
npm run check:desk:ui   # 9 simulated sessions: unlock, write, publish, draft, rename,
                        # protected branch, autosave recovery, lock — in a real DOM
npm run test:desk       # the above, plus a real `astro build` of a desk-written post
```

`check:desk` and `check:desk:ui` both run inside `npm run verify`, so CI fails if
the editor ever stops writing files the site can build.

A minute or two after you press **Publish**, the commit reaches `main`, GitHub
Actions rebuilds the site, and the post appears on the home page, the blog
index, the tag page, the RSS feed and the sitemap.

(The old Decap dashboard at `/admin/` has been removed from the repository —
`/write/` replaced it, and it added ~6.6 MB to every deploy while needing
Netlify Identity and Git Gateway to work.)

### What the desk writes

| Folder | What it holds | From the desk |
|---|---|---|
| `src/content/blog/*.md` | one file per post | **create, edit, rename, delete** |
| `public/uploads/*` | cover and inline images | **upload from the camera roll** |
| `src/content/resources/*.md` | your recommended links | edit in the repository |
| `src/content/pages/*.md` | the About and Resources copy | edit in the repository |

Every post field the schema validates is in the editor: title, date, updated,
summary, tags, featured, draft, cover image and the markdown body. New posts start
as **drafts** (`draft: true`), so a half-finished post never reaches the live
site — flip the switch to *Published* when it is ready.

The desk writes the same frontmatter shape as the rest of the folder
(`title: "…"`, `date: "YYYY-MM-DD"`, `tags: ["a", "b"]`) and it *reads* anything
the old dashboard left behind, including js-yaml's folded multi-line values.

---

## Writing a post

Create a markdown file in `src/content/blog/`. The filename becomes the URL:
`src/content/blog/my-new-post.md` → `/blog/my-new-post/`.

```markdown
---
title: "The headline readers will see"
date: 2026-10-05
tags: ["writing", "habits"]
summary: "One or two sentences used on cards, in search results and in the RSS feed."
featured: false       # true puts it in the big slot on the home page
draft: false          # true keeps it out of the build entirely
cover: "/uploads/a-photo.jpg"   # optional
---

Your post starts here. Everything the old editor could do still works, because
the renderer understands the same markup:

- **bold**, *italic*, ~~strikethrough~~, `inline code`
- lists, tables, quotes, dividers and links
- fenced code blocks with a language
- raw HTML for the pen colours:

A <span class="c-terracotta">terracotta clause</span>, a
<span class="c-blue">blue aside</span>, a <mark class="hl-yellow">highlight</mark>
and a switch of typeface: <span class="f-playfair">Playfair</span>.
```

Every field is validated when you build. A typo in the frontmatter or a bad URL
stops the build with a message naming the file, instead of shipping a broken page.

**Drafts** (`draft: true`) never reach the output — no page, no feed entry, no
sitemap listing. Flip the flag when the post is ready.

### The nine typefaces and the pens

The full palette is in `public/styles.css`; these are the class names the old
writing desk produced, and they work exactly the same here:

| | |
|---|---|
| Pens | `c-ink` `c-terracotta` `c-blue` `c-green` `c-plum` `c-amber` `c-crimson` `c-indigo` `c-teal` |
| Highlighters | `hl-yellow` `hl-mint` `hl-sky` `hl-rose` `hl-lavender` `hl-peach` |
| Typefaces | `f-lora` `f-merriweather` `f-playfair` `f-inter` `f-poppins` `f-jetbrains` `f-serif` `f-sans` `f-mono` |

Site-wide typography (which face the body and headings use, and the reading
size) lives in `src/site.config.js` under `typography`.

---

## What lives where

```
haydaycreates.github.io/
├── astro.config.mjs          build settings (site URL, outDir, markdown engine)
├── package.json              three dependencies: astro, its markdown engine, jsdom (tests)
├── netlify.toml              legacy Netlify settings — delete once Netlify is retired
├── public/
│   ├── uploads/              images uploaded from the writing desk
│   ├── fonts/                10 self-hosted woff2 files (Lora, Merriweather,
│   │                         Playfair Display, Inter, Poppins, JetBrains Mono)
│   ├── fonts.css             generated @font-face rules
│   ├── styles.css            the whole design — warm paper theme, pens, fonts
│   ├── site.js               nav, newsletter form, copy-link, blog search
│   └── favicon.svg
├── scripts/
│   ├── migrate-from-db.mjs        the migration that produced src/content/*
│   ├── test-write-desk.mjs        the desk's markdown, frontmatter and built page
│   ├── test-desk-session.mjs      a full writing session driven through a real DOM
│   ├── check-links.mjs            every local link, font path and asset in the build
│   └── compare-with-dynamic.py    page-by-page fidelity check (see below)
└── src/
    ├── content.config.ts     the content model — blog, resources, pages
    ├── content/
    │   ├── blog/             one markdown file per post
    │   ├── resources/        one file per recommended link
    │   └── pages/            about.md, resources.md
    ├── site.config.js        masthead, hero, author, newsletter, typography, writeDesk
    ├── layouts/BaseLayout.astro
    ├── components/           Header, Footer, Newsletter, PostCard
    ├── lib/
    │   ├── fonts.js          the typeface library
    │   ├── format.js         dates, icons, social links
    │   └── desk/             the writing desk — no dependencies, browser and Node
    │       ├── desk.js           the editor: views, autosave, publish
    │       ├── github.js         GitHub's Contents API, token storage, error text
    │       ├── markdown.js       the live preview renderer
    │       └── frontmatter.js    reading and writing the top of a post
    └── pages/
        ├── index.astro           home: hero, featured, latest, about, resources
        ├── blog/[...page].astro  /blog/ with 9-per-page pagination
        ├── blog/[slug].astro     the post page
        ├── blog/tag/[tag].astro  a page per topic
        ├── write.astro           /write/ — the private desk (noindex)
        ├── about.astro
        ├── resources.astro
        ├── 404.astro
        └── rss.xml.js, sitemap.xml.js, robots.txt.js
```

---

## Migrating more posts from the old app

The original dynamic app (writing desk + `data/db.json`) is untouched at
`../blog`. If you add posts there and want them here:

```bash
npm run migrate                      # reads ../blog/data/db.json
npm run migrate -- --from /path/to/db.json
npm run migrate -- --force           # overwrite files that already exist
```

It writes posts, resources and both prose pages, and refreshes
`src/site.config.js`. Existing files are kept unless you pass `--force`, so
local edits are safe.

**Or skip the old app entirely** — a markdown file in `src/content/blog/` is all a
post ever needed.

---

## The newsletter form

A static site has no server to collect addresses, so `src/site.config.js` offers
two honest options:

```js
newsletter: {
  heading: 'Letters, occasionally',
  blurb: '…',
  endpoint: '',        // ← paste a form service URL here
  mode: 'mailto',
}
```

- **Leave `endpoint` empty** (the default): the form hands the address to your
  inbox through the visitor's own mail app. No third party, works immediately.
- **Set `endpoint`** to a form service — Buttondown, Formspree, Mailchimp,
  ConvertKit — and the form POSTs `{"email": "…"}` there instead, showing
  "Subscribing…" and a thank-you note.

---

## Search, tags and pagination

- **Search** is a browser-side filter over the posts already on the page (with a
  `?q=` in the address bar so the state is shareable). No index to maintain.
- **Tags** are real pages: `/blog/tag/writing/`, generated from the posts.
- **Pagination** appears automatically past 9 posts per page
  (`postsPerPage` in `src/site.config.js`).

---

## Verifying the port

`scripts/compare-with-dynamic.py` fetches every page from the old dynamic app and
compares it against the built HTML: visible text, class names, and counts of
cards, tags and links. With the old app running on port 3010 it reports:

```
PASS  /                                 text ✓  classes ✓
PASS  /blog                             text ✓  classes ✓
PASS  /about                            text ✓  classes ✓
PASS  /resources                        text ✓  classes ✓
PASS  /blog/the-pen-menu-and-how-to-use-it   text ✓  classes ✓
… ALL PAGES MATCH
```

---

## Deploying

The site deploys itself: every merge to `main` runs
`.github/workflows/deploy-github-pages.yml`, which builds, verifies and
publishes to **GitHub Pages**. The one-time setup (three settings in the
repository's Settings pages), retiring the old Netlify host, and the optional
future move to Cloudflare Pages are walked through in
**[DEPLOYMENT.md](DEPLOYMENT.md)**. The short version:

1. Rename the repository to `haydaycreates.github.io` (**Settings → General**).
2. **Settings → Pages → Source:** *GitHub Actions*.
3. **Settings → Secrets and variables → Actions:** variable `DEPLOY_TO_PAGES` = `true`.
4. Merge to `main` — the site is live at https://haydaycreates.github.io/ about
   a minute later, and every future merge updates it, free and unlimited.
5. Make a fine-grained GitHub token with **Contents: Read and write** on this
   repository, paste it into `/write/`, and start writing. No host settings, no
   Identity, no OAuth worker — the desk is the same on every host.

Any other host works too — build once and hand over the folder:

```bash
SITE_URL=https://yourdomain.com npm run build   # → dist/, plain static files
```

- **Cloudflare Pages** — connect the repo: build `npm run build`, output `dist`,
  environment variable `NODE_VERSION=22.12.0` (DEPLOYMENT.md has the steps)
- **Vercel** — framework preset Astro, output directory `dist`
- **Any host** — copy `dist/` with `rsync`/`scp`; nothing needs to run

Every push and pull request also runs `.github/workflows/build-and-verify.yml`,
which builds the site, exercises the writing desk in a DOM, and fails the run if
a post's frontmatter is wrong, the editor stops working, or a link is broken.

---

## Notes on behaviour changes from the dynamic app

- Publish is now a commit: the writing desk at `/write/` writes markdown into the
  repo and the host rebuilds. Your words are in git with a full history, and the
  deploy is the review step.
- The **view counter** on posts is gone (nothing to count with), as is the
  subscriber list — a static site has nowhere to keep them. The newsletter form
  hands addresses to your inbox or to a form service; see below.
- The About page's *"I usually write about"* chips are drawn from your three
  favourite posts, matching the old templates. Swap `favourites` for `posts` in
  `src/pages/about.astro` to list every topic you have ever used.
- Raw HTML in markdown is passed straight through, as before. One difference: the
  old renderer escaped a stray `<` in prose (`5 &lt; 10`), the new engine passes
  it through — write `&lt;` if you need a literal less-than sign in a sentence.
