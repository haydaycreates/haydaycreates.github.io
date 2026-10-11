/**
 * Site settings — migrated from the original app's data/db.json.
 *
 * This file is the single source of truth for everything that is not a post:
 * the masthead, the home page hero, the newsletter block, the footer, and the
 * site-wide typography. Edit it and rebuild — no code changes needed.
 */

export const site = {
  title: "The Slow Draft",
  tagline: "Essays on writing, building things, and paying attention.",

  hero: {
    kicker: "A personal blog",
    heading: "Notes from the slow lane of the internet.",
    intro: "Long-ish thoughts on writing, craft, and the small systems that keep a creative life running. New pieces land here every couple of weeks — you can also get them by email.",
  },

  author: {
    name: "Chirag Yadav",
    role: "Student · Active reader",
    photo: "",
    email: "hello@example.com",
    /* the About page opening, shown trimmed on the home page */
    shortBio: "I'm Chirag — a student, and an active reader. This site is where I keep what I'm learning: notes from the books I'm reading, essays about writing and attention, and the occasional thing I build while I'm figuring things ",
  },

  social: {
    twitter: "",
    github: "",
    linkedin: "",
  },

  newsletter: {
    heading: "Letters, occasionally",
    blurb: "One short email when something new goes up. No spam, no selling your address, unsubscribe in one click.",
    /**
     * Leave endpoint empty and the form hands the address to the writer's inbox
     * through the visitor's own mail app. Fill it in with a form service such as
     * Buttondown (https://buttondown.email/api/emails/embed-subscribe/<user>)
     * or Formspree and the form POSTs there instead.
     */
    endpoint: '',
    mode: 'mailto',
  },

  footerNote: "Written by hand, published from a small editor.",

  /* Site-wide typography — ids come from src/lib/fonts.js */
  typography: {
    body: "lora",
    heading: "playfair",
    size: "medium",
  },

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
   * Where the writing desk reads and commits your posts.
   *
   * This is the whole backend: a static page, GitHub's Contents API, and the
   * token you paste in. Change `owner`/`repo` if you fork the site, or `branch`
   * if you write to somewhere other than main.
   *
   *   postsDir — the folder Astro reads, so the desk writes where the build looks
   *   mediaDir — cover images land here and are served from /uploads/…
   */
  writeDesk: {
    owner: 'haydaycreates',
    repo: 'haydaycreates.github.io',
    branch: 'main',
    postsDir: 'src/content/blog',
    mediaDir: 'public/uploads',
  },

  /* Absolute URL used in RSS, the sitemap and canonical tags.
     SITE_URL=https://yourdomain.com npm run build overrides this. */
  url: "https://haydaycreates.github.io",
};

export default site;
