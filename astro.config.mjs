import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import { site } from './src/site.config.js';

/**
 * The Slow Draft — static build settings.
 *
 * Output goes to `dist/` — the directory the GitHub Pages workflow uploads,
 * and the directory Netlify and Cloudflare Pages expect by default, so no
 * host needs any extra configuration.
 */

/**
 * Where the site's own URL comes from, in order of precedence:
 *
 *   1. SITE_URL      — the GitHub Pages workflow sets this to the site's real
 *                      address; you can also set it by hand to override
 *                      everything (e.g. a custom domain before DNS moves)
 *   2. URL           — Netlify's built-in variable, used while the old Netlify
 *                      deploy is still live
 *   3. CF_PAGES_URL  — Cloudflare Pages' equivalent, for the future move
 *   4. site.url      — the value in src/site.config.js, used locally
 */
const SITE_URL =
  process.env.SITE_URL ||
  process.env.URL ||
  process.env.CF_PAGES_URL ||
  site.url;

export default defineConfig({
  /* Absolute URLs in RSS, the sitemap and canonical tags.
     Edit site.url in src/site.config.js, or set SITE_URL when building. */
  site: SITE_URL,

  server: ({ command }) => ({
    /* `astro preview` is often viewed through a proxy or tunnel whose
       hostname Vite's host check rejects. Preview only, accept any host —
       `astro dev` on localhost stays strict. */
    ...(command === 'preview' ? { allowedHosts: true } : {}),
  }),

  /* Every host here publishes `dist/`. */
  outDir: './dist',

  markdown: {
    /**
     * Astro 7's markdown engine (satteri). Smart punctuation is turned off so
     * quotes, dashes and ellipses render exactly as typed — the same behaviour
     * as the renderer the dynamic site used. GFM (tables, strikethrough,
     * autolinks) stays on by default.
     */
    processor: satteri({ features: { smartPunctuation: false } }),

    /* Code blocks stay unstyled for the stylesheet to paint — no Shiki spans. */
    syntaxHighlight: false,
  },

  build: {
    /* /blog/post-name/index.html — the same URLs the dynamic site served. */
    format: 'directory',
  },

  devToolbar: { enabled: false },
});
