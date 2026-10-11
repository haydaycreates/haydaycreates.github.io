/**
 * Site settings.
 *
 * Two layers, merged here:
 *
 *   src/data/settings.json      everything the owner edits — the masthead, the
 *                               hero, the author, social links, the newsletter
 *                               block, the footer note and the typography.
 *                               The Settings view at /write/ reads and commits
 *                               this file; edit it here or there, not both.
 *   SETTINGS_DEFAULTS           the fallback shape, in src/lib/desk/settings.js
 *                               — any key settings.json leaves out.
 *
 * What remains below the merge is the technical configuration the desk does
 * not edit: pagination, the Write button, where the desk commits, and the
 * absolute site URL. Change those here and rebuild.
 */

import stored from './data/settings.json';
import { mergeSettings, SETTINGS_PATH, RESOURCES_DIR } from './lib/desk/settings.js';

export const site = {
  /* title, tagline, hero, author, social, newsletter, footerNote, typography */
  ...mergeSettings(stored),

  /* Posts per page on /blog/ (pagination appears once you exceed it). */
  postsPerPage: 9,

  /**
   * The nav's "Write" button. It points at the private writing desk at /write/,
   * which commits markdown to your repository using a GitHub token kept in your
   * own browser. Anyone else who opens that page sees a lock screen and can
   * change nothing.
   * Set it to '' to hide the button entirely.
   */
  writeLink: '/write/',

  /**
   * Where the writing desk reads and commits.
   *
   * This is the whole backend: a static page, GitHub's Contents API, and the
   * token you paste in. Change `owner`/`repo` if you fork the site, or `branch`
   * if you write to somewhere other than main.
   *
   *   postsDir     — the folder Astro reads posts from, so the desk writes
   *                  where the build looks
   *   mediaDir     — cover images and the portrait land here, served /uploads/…
   *   resourcesDir — the recommended links the Settings view edits
   *   settingsPath — the owner-editable settings the Settings view commits
   */
  writeDesk: {
    owner: 'haydaycreates',
    repo: 'haydaycreates.github.io',
    branch: 'main',
    postsDir: 'src/content/blog',
    mediaDir: 'public/uploads',
    resourcesDir: RESOURCES_DIR,
    settingsPath: SETTINGS_PATH,
  },

  /* Absolute URL used in RSS, the sitemap and canonical tags.
     SITE_URL=https://yourdomain.com npm run build overrides this. */
  url: 'https://haydaycreates.github.io',
};

export default site;
