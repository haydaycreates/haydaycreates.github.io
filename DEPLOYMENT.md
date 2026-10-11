# Deploying The Slow Draft

Everything here is free. The site's home is **GitHub Pages**: your writing lives
in a GitHub repository, GitHub Actions rebuilds the site on every merge to
`main`, and GitHub serves it at **https://haydaycreates.github.io/** — free,
unlimited deploys, no credits, no third-party host.

The private writing desk at `/write/` comes with it: open it on your phone,
paste your GitHub token once, and publish. The desk commits straight to the
repository; the merge to `main` is what rebuilds the site.

## How the pieces fit together

| Piece | What it does |
|---|---|
| `haydaycreates/haydaycreates.github.io` | the repository: posts, design, full history of every change |
| `.github/workflows/deploy-github-pages.yml` | on every merge to `main`: build → verify → publish to Pages |
| `.github/workflows/build-and-verify.yml` | on every push and pull request: build, exercise the desk, audit links |
| `/write/` — the writing desk | where you actually write; talks only to `api.github.com` |
| Netlify (`theslowdraft.netlify.app`) | the **old** host — retire it (below) so it stops costing credits |
| Cloudflare Pages | the optional future move — unlimited bandwidth, ten minutes |

Working locally is the same as ever:

```bash
npm install
npm run dev        # http://localhost:4321 — live reload while writing
npm run build      # → ./dist, the folder every host publishes
npm run verify     # build + the two desk suites + the link audit
```

Requires **Node 22.12+**. `npm run verify` should end with:

```
  55 checks passed. …The writing desk is safe to publish from.
  89 checks passed across 9 sessions.
  Every local link, font path and asset resolves. Safe to deploy.
```

---

## One-time GitHub Pages setup (three settings, two minutes)

All three live in the repository's **Settings** on github.com and need the
account owner — no tool or workflow can flip them for you.

### 1. Name the repository `haydaycreates.github.io`

**Settings → General → Repository name** → `haydaycreates.github.io` → **Rename**.

The name is what lets Pages serve the site at the clean root address
`https://haydaycreates.github.io/`. A repository with any other name would be
served in a subfolder (`…github.io/<repo-name>/`), and every root-absolute link
in the site (`/styles.css`, `/blog/`) would 404 there. GitHub automatically
redirects all old URLs — git remotes, pull requests and issue links included —
so renaming breaks nothing. `src/site.config.js` already points at the new name.

Later, a custom domain (step 4 below) can replace the `.github.io` address; the
repository name can stay as it is.

### 2. Set Pages to build with GitHub Actions

**Settings → Pages → Build and deployment → Source** → choose **GitHub Actions**.

If it currently says *Deploy from a branch*, that mode publishes raw repository
files and cannot build an Astro site — which is why Pages shows a 404 today.
Switching the source to **GitHub Actions** hands publishing to the workflow
already in the repository.

### 3. Switch the deploy workflow on

The deploy workflow waits for one repository variable, so it stays quiet until
Pages is actually ready:

**Settings → Secrets and variables → Actions** → *Variables* tab →
**New repository variable**

- **Name:** `DEPLOY_TO_PAGES`
- **Value:** `true`

### 4. Then get the code onto `main`

Merge the open pull request (or push `main` directly). Every merge to `main`
from then on runs **Deploy to GitHub Pages**: install → build → verify (desk
suites + link audit) → publish. The site appears at
**https://haydaycreates.github.io/** about a minute after the run goes green.

Watch a deploy: repository → **Actions** tab → *Deploy to GitHub Pages* → the
newest run. Green ticks mean live; a red step shows its log in one click.

### 5. Custom domain (optional, any time)

**Settings → Pages → Custom domain** → enter your domain → add the DNS record
GitHub shows you (a `CNAME` to `haydaycreates.github.io`). The deploy workflow
picks the new address up automatically — it builds with the site URL GitHub
passes in, so the RSS feed, sitemap and canonical tags follow the domain with no
configuration.

---

## Publish your first post (one-time token, two minutes)

The desk needs a GitHub token — made once, kept in your own browser, revocable
in one click.

1. Open **GitHub → Settings → Developer settings → Fine-grained tokens →
   Generate new token**: <https://github.com/settings/personal-access-tokens/new>
2. **Repository access:** *Only select repositories* → your site's repository.
3. **Permissions → Repository permissions → Contents:** `Read and write`.
   Nothing else is needed.
4. **Generate token** and copy the `github_pat_…` string.

Then write:

1. Go to `https://haydaycreates.github.io/write/` (or tap **Write** in the header).
2. Paste the token, choose *Keep on this device*, and press **Unlock the desk**.
3. **New post** → type a title (the address fills itself in) → write.
4. Leave the switch on **Draft** while you work — a draft is excluded from the
   build entirely. Tap **✎ Pens** for the colours, highlighters and typefaces.
5. Switch to **Published** and press **Publish**.

The desk commits the markdown file to `main`. The Pages workflow notices and
rebuilds; the page watches for the new post and tells you when it is live —
usually a minute or two on GitHub Actions, with its own page, an entry on the
blog index, a tag page and a place in the RSS feed.

Anyone else who opens `/write/` sees only the lock screen: without your token
the page cannot read or write a single file, and it makes no network request at
all.

---

## Day-to-day writing

**From your phone or laptop:** `https://haydaycreates.github.io/write/` → unlock
with your token (it is remembered on the device) → **New post** → write →
**Publish**. That is the whole loop. Tap **✎ Pens** for the nine pens, six
highlighters and nine typefaces; 🖼 uploads a photo from the camera roll into
`public/uploads/`.

**Half-finished?** Leave it on **Draft** and press **Save draft**. It is
committed to the repository but excluded from the build, so it exists nowhere on
the live site. Open it from the library later and switch it to **Published**.

**Straight from github.com (no desk):** open `src/content/blog/`, press
**Add file → Create new file**, write the frontmatter and body, and commit to
`main`. The Pages workflow rebuilds exactly the same way.

```markdown
---
title: "The headline"
date: "2026-10-05"
tags: ["writing", "habits"]
summary: "One or two sentences for cards and the feed."
draft: false
---

Your post starts here.
```

**From your laptop's terminal:** add a markdown file to `src/content/blog/`,
`git push`, done.

**Editing something already published:** open it from the library, change it,
press **Save changes**. Renaming the address moves the file, so a post never
ends up published twice. Because every change is a git commit, you can always
see what changed and undo it — **GitHub → Commits** is the full history of your
writing.

**Losing your phone, or a lost token:** nothing is lost. Your writing lives in
GitHub, and you can revoke the token at
<https://github.com/settings/personal-access-tokens> and make a new one in two
minutes.

### If the desk cannot reach GitHub

The desk says what went wrong in plain words — an expired token, a missing
permission, a protected branch, a rate limit — and it keeps your writing in the
browser meanwhile, so nothing is lost while you fix it.

- **"GitHub rejected that token"** → make a new fine-grained token (above) and
  unlock again.
- **"That token can read this repository but not write to it"** → the token needs
  *Contents: Read and write*.
- **"That repository is not visible to this token"** → the token was not granted
  this repository, or `writeDesk.owner` / `writeDesk.repo` in `src/site.config.js`
  does not match it (after any future rename, update them there).
- **"GitHub refused this step"** on a protected `main` → press **Commit to a
  branch** and merge the pull request it links to.
- **"Could not reach api.github.com"** → a network block, or a privacy extension
  stopping the request.

---

## Retire Netlify (so it stops costing credits)

The old host at `https://theslowdraft.netlify.app` still rebuilds on every merge
to `main`, and Netlify's free plan now charges **15 credits per production
deploy** out of **300 credits a month**. Once Pages is live, switch it off:

1. Netlify dashboard → your site → **Site configuration → Build & deploy →
   Continuous builds → Stop builds.**
2. That is the step that matters: no builds, no credits, nothing to unpublish —
   the site simply stops changing there.
3. Optional, when you are sure: **Site configuration → Danger Zone → Delete this
   site.**
4. Optional, after that: delete `netlify.toml` from the repository — it exists
   only for that host. (The noindex protection for `/write/` does not depend on
   it: the page carries a `noindex` meta tag and `robots.txt` disallows it
   everywhere.)

Nothing else in the site depends on Netlify — the desk never used Identity or
Git Gateway, and no code references the host.

---

## The future move: Cloudflare Pages (optional, ~10 minutes)

When you want unlimited bandwidth and a `*.pages.dev` (or custom) domain, the
move is small — the repository, the desk and the workflows all stay exactly as
they are.

1. Sign in at **https://dash.cloudflare.com** → **Workers & Pages → Create →
   Pages → Connect to Git** → choose the repository.
2. Build settings: **Framework preset** Astro, **Build command**
   `npm run build`, **Build output directory** `dist`.
3. **Environment variables → Add:** `NODE_VERSION` = `22.12.0` — required;
   Cloudflare's default Node is older than Astro 7 needs.
4. **Save and Deploy.** `CF_PAGES_URL` is read automatically, so the feed and
   sitemap use the new address from the first build. For a custom domain:
   Cloudflare's **Custom domains** tab, and everything follows it.
5. Keep GitHub Pages running or stop it (remove the `DEPLOY_TO_PAGES` variable)
   — your choice; the desk works identically either way, and it is the same
   GitHub token.

Free tier: 500 builds/month, unlimited requests and bandwidth. A personal blog
never comes close.

---

## Verify it is working end to end

Run through this once after the first Pages deploy. Every line should hold.

| # | Check | How |
|---|---|---|
| 1 | Site loads | `https://haydaycreates.github.io/` — the warm paper design, fonts loaded (headings in Playfair Display, body in Lora) |
| 2 | Every page works | Home, About, Resources, Blog, one post — no 404s |
| 3 | Feed and sitemap | `/rss.xml` shows your posts and the github.io address; `/sitemap.xml` lists every page |
| 4 | The desk is private | `/write/` shows the lock screen — and in a private window with no token, the browser's Network panel shows **no requests at all** |
| 5 | The desk unlocks | Paste your token → your library of posts appears, each marked Live or Draft |
| 6 | A post publishes | New post → switch to **Published** → **Publish** → the done screen counts down and the post appears on the live site a minute or two later |
| 7 | A draft stays private | Save a post as **Draft** → it appears nowhere on the site, and the deploy still succeeds |
| 8 | Images upload | Tap 🖼 in the toolbar and choose a photo → it is committed to `public/uploads/` and shows in the post |
| 9 | Writing survives | Write a line, close the tab, reopen `/write/` → the library offers the unfinished post back |
| 10 | CI is green | GitHub → **Actions** → the latest *Deploy to GitHub Pages* run has ticks next to every step |

If check 6 fails, open the failed run in the **Actions** tab — the log names the
step. The most common cause is a mistyped frontmatter field, which the *Build
and verify* run on the pull request would have caught first. If the desk itself
reports a GitHub error, the message names the permission that is missing.

---

## Costs, limits and what happens if you outgrow them

| | Free tier | What happens past it |
|---|---|---|
| GitHub Pages | Unlimited deploys; ~100 GB/month bandwidth (soft) | It is a personal blog — you will not get close |
| GitHub Actions | Unlimited minutes on public repositories | Private repos get 2,000 minutes/month; one build here uses about one |
| Netlify (legacy) | 300 credits/month, 15 per production deploy | Deploys pause — which is exactly why you retire it above |
| Cloudflare Pages (future) | 500 builds/month, unlimited bandwidth and requests | Static sites rarely reach it |
| The desk | Free — a page in your own site talking to GitHub | Nothing to outgrow |
| Fonts and images | Self-hosted in your repo | Nothing to outgrow |

**Your content is never locked in.** Posts are markdown files in your own git
repository, the fonts are files in the repository, and the design is one CSS
file. Moving to any other host means pointing that host at the same repository —
the README's *Deploying* section covers the generic case (Vercel, `rsync`,
anything that can serve a folder of static files).
