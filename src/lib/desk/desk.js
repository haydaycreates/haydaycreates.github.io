/**
 * The writing desk.
 *
 * A private editor that lives inside your own static site. There is no server
 * and no database: the page reads and commits markdown straight to your GitHub
 * repository using a token that stays in your browser, and your host rebuilds
 * the site from that commit. Visitors who open /write/ see a lock screen and
 * nothing else — without your token the page cannot read or write anything.
 *
 * Built mobile-first: one pane at a time, thumb-sized buttons, writing kept safe
 * in localStorage so a locked phone or a reload never costs you a paragraph.
 * On a wide screen the preview sits beside the editor instead.
 */

import { renderMarkdown, countWords } from './markdown.js';
import {
  parsePost,
  toEditorFields,
  toPostData,
  buildPostFile,
  slugify,
  today,
} from './frontmatter.js';
import {
  createGitHubClient,
  DeskError,
  saveToken,
  loadToken,
  clearToken,
  tokenIsPersisted,
} from './github.js';

const WIP_KEY = 'slowdraft.desk.wip';
const AUTOSAVE_DELAY = 700;
const LIVE_CHECK_INTERVAL = 12000;
const LIVE_CHECK_ATTEMPTS = 25; /* about five minutes of rebuilding */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/* --------------------------------- helpers -------------------------------- */

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const readWip = () => {
  try {
    const raw = window.localStorage.getItem(WIP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeWip = (value) => {
  try {
    if (value) window.localStorage.setItem(WIP_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(WIP_KEY);
  } catch {
    /* Storage full or blocked — the editor still works, it just cannot remember. */
  }
};

const clockTime = () =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const readingTime = (words) => `${Math.max(1, Math.round(words / 220))} min read`;

/* ---------------------------------- app ----------------------------------- */

export function mountDesk(root) {
  if (!root) return;

  const config = JSON.parse(root.dataset.deskConfig || '{}');
  const postsDir = config.postsDir || 'src/content/blog';
  const mediaDir = config.mediaDir || 'public/uploads';
  const branch = config.branch || 'main';

  /** @type {ReturnType<typeof createGitHubClient>|null} */
  let client = null;
  let account = null;

  /* What is open in the editor. */
  const draft = {
    path: '', /* repo path of the post being edited ('' = new) */
    sha: '', /* the sha we last read, needed to update the file */
    slug: '',
    slugTouched: false,
    originalSlug: '',
    fields: emptyFields(),
    status: 'new',
  };

  function emptyFields() {
    return {
      title: '',
      date: today(),
      updated: '',
      summary: '',
      tags: [],
      featured: false,
      draft: true,
      cover: '',
      body: '',
    };
  }

  let library = [];
  let filter = 'all';
  let autosaveTimer = 0;
  let liveTimer = 0;

  /* --------------------------------- views -------------------------------- */

  const views = Object.fromEntries(
    $$('[data-view]', root).map((view) => [view.dataset.view, view])
  );

  function show(name) {
    for (const [key, view] of Object.entries(views)) {
      view.hidden = key !== name;
    }
    root.dataset.view = name;
    window.scrollTo(0, 0);
  }

  /* ------------------------------ lock screen ----------------------------- */

  const lockForm = $('[data-lock-form]', root);
  const tokenInput = $('[data-token-input]', root);
  const lockNote = $('[data-lock-note]', root);
  const repoLabel = $('[data-repo-label]', root);

  if (repoLabel) repoLabel.textContent = `${config.owner}/${config.repo}`;

  const say = (element, message, isError = false) => {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('is-error', isError);
    element.classList.toggle('is-good', !isError && Boolean(message));
  };

  $('[data-token-toggle]', root)?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const hidden = tokenInput.type === 'password';
    tokenInput.type = hidden ? 'text' : 'password';
    button.textContent = hidden ? 'Hide' : 'Show';
  });

  async function unlock(token, persist) {
    const submit = $('[data-lock-submit]', root);
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Checking with GitHub…';
    }
    say(lockNote, '');

    try {
      const candidate = createGitHubClient(token.trim(), config);
      account = await candidate.verify();
      client = candidate;
      saveToken(token.trim(), { persist });
      const signed = $('[data-signed-in]', root);
      if (signed) signed.textContent = `${account.login} · ${account.repo}`;
      await openLibrary();
    } catch (error) {
      const hint = error instanceof DeskError && error.hint ? ` ${error.hint}` : '';
      say(lockNote, `${error.message}${hint}`, true);
      client = null;
      account = null;
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Unlock the desk';
      }
    }
  }

  lockForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) {
      say(lockNote, 'Paste your GitHub token first.', true);
      return;
    }
    const persist = $('[name="remember"]:checked', root)?.value !== 'session';
    unlock(token, persist);
  });

  $('[data-lock-now]', root)?.addEventListener('click', () => {
    clearToken();
    client = null;
    account = null;
    tokenInput.value = '';
    stopLiveCheck();
    show('lock');
  });

  /* -------------------------------- library ------------------------------- */

  const listElement = $('[data-list]', root);
  const listEmpty = $('[data-list-empty]', root);
  const listNote = $('[data-list-note]', root);
  const resumeCard = $('[data-resume]', root);

  async function openLibrary() {
    show('library');
    listElement.innerHTML = '';
    say(listNote, 'Loading your posts…');
    renderResumeCard();

    try {
      const files = await client.listPosts();
      /* Read each file so the list can show drafts, dates and titles. Personal
         blogs are small; five at a time keeps GitHub happy. */
      library = await mapWithLimit(files, 5, async (file) => {
        try {
          const { text, sha } = await client.readFile(file.path);
          const { data } = parsePost(text);
          return {
            ...file,
            sha,
            slug: file.name.replace(/\.mdx?$/i, ''),
            title: String(data.title || file.name),
            date: String(data.date || '').slice(0, 10),
            draft: Boolean(data.draft),
            featured: Boolean(data.featured),
          };
        } catch {
          return { ...file, slug: file.name.replace(/\.mdx?$/i, ''), title: file.name, date: '', draft: false };
        }
      });

      library.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
      say(listNote, '');
      renderLibrary();
    } catch (error) {
      const hint = error instanceof DeskError && error.hint ? ` ${error.hint}` : '';
      say(listNote, `${error.message}${hint}`, true);
      listEmpty.hidden = true;
    }
  }

  function renderResumeCard() {
    const wip = readWip();
    if (!resumeCard) return;
    if (!wip || (!wip.fields?.body && !wip.fields?.title)) {
      resumeCard.hidden = true;
      return;
    }
    resumeCard.hidden = false;
    $('[data-resume-title]', resumeCard).textContent =
      wip.fields?.title || 'An untitled post';
    $('[data-resume-meta]', resumeCard).textContent =
      `${wip.status === 'new' ? 'New post' : 'Editing'} · saved locally ${wip.savedAt || ''}`;
  }

  resumeCard?.addEventListener('click', () => {
    const wip = readWip();
    if (!wip) return;
    restoreFromWip(wip);
    show('editor');
  });

  $('[data-new]', root)?.addEventListener('click', () => {
    startNewPost();
    show('editor');
  });

  $$('[data-filter]', root).forEach((button) =>
    button.addEventListener('click', () => {
      filter = button.dataset.filter;
      $$('[data-filter]', root).forEach((other) => other.classList.toggle('is-on', other === button));
      renderLibrary();
    })
  );

  function renderLibrary() {
    const wanted = library.filter((post) => {
      if (filter === 'live') return !post.draft;
      if (filter === 'draft') return post.draft;
      return true;
    });

    listElement.innerHTML = '';
    listEmpty.hidden = wanted.length > 0;
    if (!wanted.length) {
      $('[data-list-empty-text]', listEmpty).textContent =
        filter === 'draft'
          ? 'No drafts. Everything you have written is published.'
          : filter === 'live'
            ? 'Nothing published yet — write the first one.'
            : 'No posts in this repository yet.';
    }

    const counts = $('[data-counts]', root);
    if (counts) {
      const live = library.filter((post) => !post.draft).length;
      const drafts = library.length - live;
      counts.textContent = `${live} published · ${drafts} draft${drafts === 1 ? '' : 's'}`;
    }

    for (const post of wanted) {
      const item = document.createElement('li');
      item.className = 'desk-item';

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'desk-item-open';

      const title = document.createElement('span');
      title.className = 'desk-item-title';
      title.textContent = post.title;

      const meta = document.createElement('span');
      meta.className = 'desk-item-meta';
      meta.textContent = [post.date, `/blog/${post.slug}/`].filter(Boolean).join(' · ');

      const chip = document.createElement('span');
      chip.className = `chip ${post.draft ? 'chip-draft' : 'chip-live'}`;
      chip.textContent = post.draft ? 'Draft' : 'Live';

      main.append(title, meta);
      item.append(chip, main);

      const view = document.createElement('a');
      view.className = 'desk-item-view';
      view.href = `/blog/${post.slug}/`;
      view.target = '_blank';
      view.rel = 'noopener';
      view.textContent = 'View';
      if (post.draft) view.hidden = true; /* a draft has no page yet */
      item.append(view);

      main.addEventListener('click', () => openPost(post));
      listElement.append(item);
    }
  }

  /* --------------------------------- editor ------------------------------- */

  const editor = $('[data-editor]', root);
  const titleField = $('[data-field="title"]', root);
  const slugField = $('[data-field="slug"]', root);
  const dateField = $('[data-field="date"]', root);
  const summaryField = $('[data-field="summary"]', root);
  const tagsField = $('[data-field="tags"]', root);
  const coverField = $('[data-field="cover"]', root);
  const bodyField = $('[data-field="body"]', root);
  const featuredToggle = $('[data-field="featured"]', root);
  const stateLabel = $('[data-state]', root);
  const countLabel = $('[data-count]', root);
  const preview = $('[data-preview]', root);
  const previewTitle = $('[data-preview-title]', root);
  const previewMeta = $('[data-preview-meta]', root);
  const urlHint = $('[data-url-hint]', root);
  const publishButton = $('[data-publish]', root);
  const draftButton = $('[data-save-draft]', root);
  const detailsToggle = $('[data-details-toggle]', root);
  const detailsPanel = $('[data-details]', root);

  function startNewPost() {
    draft.path = '';
    draft.sha = '';
    draft.slug = '';
    draft.slugTouched = false;
    draft.originalSlug = '';
    draft.status = 'new';
    draft.fields = emptyFields();
    writeWip(null);
    syncForm();
    renderPreview();
    setState('New post');
  }

  async function openPost(post) {
    setState(`Opening “${post.title}”…`);
    show('editor');
    try {
      const { text, sha } = await client.readFile(post.path);
      const fields = toEditorFields(text);
      draft.path = post.path;
      draft.sha = sha;
      draft.slug = post.slug;
      draft.originalSlug = post.slug;
      draft.slugTouched = true; /* an existing post keeps its address */
      draft.status = 'edit';
      draft.fields = { ...fields, slug: post.slug };
      syncForm();
      renderPreview();
      setState(`Editing · ${post.date || ''}`.trim());
      autosave();
    } catch (error) {
      const hint = error instanceof DeskError && error.hint ? ` ${error.hint}` : '';
      setState('');
      showLibraryError(`${error.message}${hint}`);
    }
  }

  function showLibraryError(message) {
    show('library');
    say(listNote, message, true);
  }

  /** Puts the draft state into the form fields. */
  function syncForm() {
    const f = draft.fields;
    titleField.value = f.title || '';
    slugField.value = draft.slug || '';
    dateField.value = f.date || today();
    summaryField.value = f.summary || '';
    tagsField.value = (f.tags || []).join(', ');
    coverField.value = f.cover || '';
    bodyField.value = f.body || '';
    featuredToggle.checked = Boolean(f.featured);
    setMode(f.draft ? 'draft' : 'live');
    updateSlugLock();
    updateCounts();
  }

  /** Reads the form back into the draft state. */
  function readForm() {
    draft.fields.title = titleField.value;
    draft.fields.date = dateField.value;
    draft.fields.summary = summaryField.value;
    draft.fields.tags = tagsField.value
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean);
    draft.fields.cover = coverField.value.trim();
    draft.fields.body = bodyField.value;
    draft.fields.featured = featuredToggle.checked;
    if (draft.status === 'new' && !draft.slugTouched) {
      draft.slug = slugify(titleField.value);
      slugField.value = draft.slug;
    } else {
      draft.slug = slugField.value.trim().replace(/^\/+|\/+$/g, '');
    }
    updateSlugLock();
  }

  /**
   * The address is always editable — renaming an existing post is a real thing
   * to want — but the note underneath spells out what a rename does, because it
   * moves the published URL.
   */
  function updateSlugLock() {
    const note = $('[data-slug-note]', root);
    if (!note) return;
    if (draft.status === 'edit' && draft.slug !== draft.originalSlug) {
      note.textContent = `Renaming moves the post from /blog/${draft.originalSlug}/ to /blog/${draft.slug}/.`;
      note.classList.add('is-warn');
    } else {
      note.textContent = draft.slug
        ? `Will be published at /blog/${draft.slug}/`
        : 'The address is made from the title.';
      note.classList.remove('is-warn');
    }
    if (urlHint) urlHint.textContent = draft.slug ? `/blog/${draft.slug}/` : '/blog/…';
  }

  /**
   * Draft / Published segmented control.
   *
   * The main button always says what it is about to do: a draft is saved, an
   * unpublished post is published, an already-live post is simply updated.
   */
  function setMode(mode) {
    draft.fields.draft = mode === 'draft';
    $$('[data-mode]', root).forEach((button) => {
      const on = button.dataset.mode === mode;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    const alreadyLive = draft.status === 'edit' && !draft.fields.draft;
    if (publishButton) {
      publishButton.textContent =
        mode === 'draft' ? 'Save draft' : alreadyLive ? 'Save changes' : 'Publish';
    }
    /* The second button only earns its place when the post is already live-mode
       and there is a draft worth keeping instead. */
    if (draftButton) draftButton.hidden = mode === 'draft';
    if (draftButton) draftButton.textContent = 'Save as draft';
  }

  $$('[data-mode]', root).forEach((button) =>
    button.addEventListener('click', () => {
      readForm();
      setMode(button.dataset.mode);
      autosave();
    })
  );

  function updateCounts() {
    const words = countWords(bodyField.value);
    if (countLabel) countLabel.textContent = `${words} words · ${readingTime(words)}`;
  }

  function setState(text) {
    if (stateLabel) stateLabel.textContent = text;
  }

  /* ------------------------------ live preview ---------------------------- */

  const wide = window.matchMedia('(min-width: 960px)');

  function applyLayout() {
    editor?.classList.toggle('is-split', wide.matches);
    if (wide.matches) {
      $$('[data-pane]', root).forEach((button) => button.classList.remove('is-on'));
      $$('[data-pane-view]', root).forEach((pane) => {
        pane.hidden = false;
      });
      renderPreview();
    } else {
      const active = $('[data-pane].is-on', root)?.dataset.pane || 'write';
      $$('[data-pane-view]', root).forEach((pane) => {
        pane.hidden = pane.dataset.paneView !== active;
      });
    }
  }

  /* Older Safari and some test environments only have addListener. */
  if (wide.addEventListener) wide.addEventListener('change', applyLayout);
  else if (wide.addListener) wide.addListener(applyLayout);

  $$('[data-pane]', root).forEach((button) =>
    button.addEventListener('click', () => {
      $$('[data-pane]', root).forEach((other) => other.classList.toggle('is-on', other === button));
      $$('[data-pane-view]', root).forEach((pane) => {
        pane.hidden = pane.dataset.paneView !== button.dataset.pane;
      });
      if (button.dataset.pane === 'preview') renderPreview();
      bodyField.focus({ preventScroll: true });
    })
  );

  function renderPreview() {
    if (!preview) return;
    readFormQuietly();
    const words = countWords(draft.fields.body);
    if (previewTitle) previewTitle.textContent = draft.fields.title || 'Untitled';
    if (previewMeta) {
      previewMeta.textContent = [
        draft.fields.date,
        readingTime(words),
        draft.fields.draft ? 'Draft — not on the site yet' : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    preview.innerHTML = renderMarkdown(draft.fields.body);
  }

  /** Reads values without touching the slug (used while typing). */
  function readFormQuietly() {
    draft.fields.title = titleField.value;
    draft.fields.date = dateField.value;
    draft.fields.summary = summaryField.value;
    draft.fields.body = bodyField.value;
    draft.fields.cover = coverField.value.trim();
    draft.fields.featured = featuredToggle.checked;
  }

  /* -------------------------------- autosave ------------------------------ */

  function autosave() {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      readForm();
      writeWip({
        path: draft.path,
        sha: draft.sha,
        slug: draft.slug,
        originalSlug: draft.originalSlug,
        status: draft.status,
        fields: draft.fields,
        savedAt: clockTime(),
      });
      const stamp = $('[data-autosave]', root);
      if (stamp) stamp.textContent = `Saved on this device ${clockTime()}`;
      renderPreview();
      updateCounts();
    }, AUTOSAVE_DELAY);
  }

  function restoreFromWip(wip) {
    draft.path = wip.path || '';
    draft.sha = wip.sha || '';
    draft.slug = wip.slug || '';
    draft.originalSlug = wip.originalSlug || '';
    draft.status = wip.status || 'new';
    draft.fields = { ...emptyFields(), ...(wip.fields || {}) };
    draft.slugTouched = draft.status === 'edit';
    syncForm();
    renderPreview();
    setState(draft.status === 'new' ? 'New post · restored from this device' : 'Editing · restored from this device');
  }

  $$('[data-field]', root).forEach((field) => {
    field.addEventListener('input', () => {
      /* Typing in the address box means "I choose this address" — from now on
         the slug stays put instead of following the title, and the warning about
         moving a published post appears as you type it. */
      if (field === slugField) {
        draft.slugTouched = true;
        draft.slug = field.value.trim().replace(/^\/+|\/+$/g, '');
        updateSlugLock();
      }
      /* Typing a title shows the address it will get, straight away. */
      if (field === titleField && !draft.slugTouched) {
        draft.slug = slugify(field.value);
        slugField.value = draft.slug;
        updateSlugLock();
      }
      updateCounts();
      autosave();
    });
  });

  /* ------------------------------ text toolbar ---------------------------- */

  function surround(before, after, placeholder) {
    const start = bodyField.selectionStart;
    const end = bodyField.selectionEnd;
    const selected = bodyField.value.slice(start, end) || placeholder;
    bodyField.setRangeText(before + selected + after, start, end, 'select');
    bodyField.selectionStart = start + before.length;
    bodyField.selectionEnd = start + before.length + selected.length;
    bodyField.focus();
    autosave();
  }

  function prefixLines(prefix) {
    const value = bodyField.value;
    const start = bodyField.selectionStart;
    const end = bodyField.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const block = value.slice(lineStart, end).split('\n');
    const replaced = block.map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line)).join('\n');
    bodyField.setRangeText(replaced, lineStart, end, 'end');
    bodyField.focus();
    autosave();
  }

  const TOOLS = {
    bold: () => surround('**', '**', 'strong words'),
    italic: () => surround('*', '*', 'a quiet aside'),
    heading: () => prefixLines('## '),
    quote: () => prefixLines('> '),
    list: () => prefixLines('- '),
    link: () => surround('[', '](https://)', 'link text'),
  };

  $$('[data-tool]', root).forEach((button) =>
    button.addEventListener('click', () => TOOLS[button.dataset.tool]?.())
  );

  /* ------------------------------- the pen menu ---------------------------- */

  /* The same palette the stylesheet already defines, so a clause picked here
     looks identical on the published page. Wraps the selection — or a
     placeholder, if nothing is selected — in the site's own inline HTML. */
  const pensPanel = $('[data-pens]', root);
  const pensToggle = $('[data-pens-toggle]', root);

  pensToggle?.addEventListener('click', () => {
    const open = pensPanel.hidden;
    pensPanel.hidden = !open;
    pensToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  $$('[data-pen], [data-mark], [data-font]', root).forEach((button) =>
    button.addEventListener('click', () => {
      if (button.dataset.pen) {
        surround(`<span class="${button.dataset.pen}">`, '</span>', 'a clause in colour');
      } else if (button.dataset.mark) {
        surround(`<mark class="${button.dataset.mark}">`, '</mark>', 'highlighted');
      } else {
        surround(`<span class="${button.dataset.font}">`, '</span>', 'a change of voice');
      }
      pensPanel.hidden = true;
      pensToggle?.setAttribute('aria-expanded', 'false');
      renderPreview();
    })
  );

  /* ------------------------------ image upload ---------------------------- */

  const fileInput = $('[data-file-input]', root);
  let uploadTarget = 'cover';

  $$('[data-upload]', root).forEach((button) =>
    button.addEventListener('click', () => {
      uploadTarget = button.dataset.upload;
      fileInput.value = '';
      fileInput.click();
    })
  );

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      showNotice(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — please keep uploads under 10 MB.`, true);
      return;
    }

    readForm();
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const stem = draft.slug || slugify(draft.fields.title) || 'image';
    const name = `${stem}-${Date.now().toString(36)}.${extension}`;
    const path = `${mediaDir}/${name}`;
    const publicUrl = `/uploads/${name}`;

    showNotice(`Uploading ${file.name}…`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await client.writeFile(path, bytes, `Upload ${name}`, {});
      if (uploadTarget === 'cover') {
        coverField.value = publicUrl;
      } else {
        /* Drop the image where the cursor is, on lines of its own. */
        const caption = draft.fields.title || stem;
        const marker = `![${caption}](${publicUrl})`;
        const at = bodyField.selectionStart;
        bodyField.setRangeText(`\n\n${marker}\n\n`, at, at, 'end');
      }
      showNotice(`Uploaded — the file is in your repository at ${publicUrl}`);
      autosave();
    } catch (error) {
      const hint = error instanceof DeskError && error.hint ? ` ${error.hint}` : '';
      showNotice(`${error.message}${hint}`, true);
    }
  });

  const notice = $('[data-notice]', root);
  function showNotice(message, isError = false) {
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = !message;
    notice.classList.toggle('is-error', Boolean(isError));
  }

  /* ------------------------------ details panel --------------------------- */

  detailsToggle?.addEventListener('click', () => {
    const open = detailsPanel.hidden;
    detailsPanel.hidden = !open;
    detailsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    detailsToggle.textContent = open ? 'Hide post settings' : 'Post settings';
  });

  /* -------------------------------- publishing ---------------------------- */

  $('[data-back]', root)?.addEventListener('click', () => {
    readForm();
    if (draft.fields.title || draft.fields.body) autosaveNow();
    openLibrary();
  });

  function autosaveNow() {
    window.clearTimeout(autosaveTimer);
    readForm();
    writeWip({
      path: draft.path,
      sha: draft.sha,
      slug: draft.slug,
      originalSlug: draft.originalSlug,
      status: draft.status,
      fields: draft.fields,
      savedAt: clockTime(),
    });
  }

  draftButton?.addEventListener('click', () => commit('draft'));
  publishButton?.addEventListener('click', () => commit(draft.fields.draft ? 'draft' : 'live'));

  /**
   * The one action that matters.
   *
   *   mode 'draft' — commit with draft: true, so the build leaves it off the site
   *   mode 'live'  — commit with no draft line, and watch for the page to appear
   */
  async function commit(mode) {
    readForm();
    showNotice('');

    const title = draft.fields.title.trim();
    if (!title) {
      showNotice('Give the post a title first.', true);
      titleField.focus();
      return;
    }
    if (!draft.slug) {
      draft.slug = slugify(title);
      slugField.value = draft.slug;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.slug)) {
      showNotice('The address can only use lowercase letters, numbers and dashes.', true);
      slugField.focus();
      return;
    }
    if (!draft.fields.body.trim() && mode === 'live') {
      showNotice('There is nothing to publish yet — write a line, or save it as a draft.', true);
      bodyField.focus();
      return;
    }

    const willBeDraft = mode === 'draft';
    const data = toPostData({ ...draft.fields, draft: willBeDraft });
    const file = buildPostFile(data, draft.fields.body);
    const path = `${postsDir}/${draft.slug}.md`;
    const renamed = Boolean(draft.path) && draft.path !== path;

    setBusy(true, willBeDraft ? 'Saving the draft…' : 'Committing to your repository…');

    try {
      const quoted = `“${title}”`;
      const message =
        draft.status === 'new'
          ? `${willBeDraft ? 'Draft' : 'Publish'} ${quoted}`
          : willBeDraft
            ? `Keep ${quoted} as a draft`
            : `Update ${quoted}`;

      /* A rename writes the new file first, then removes the old one, so a
         failure half-way leaves the post readable rather than missing. */
      let result = await client.writeFile(path, file, message, {
        sha: renamed ? '' : draft.sha,
      });

      if (renamed) {
        try {
          await client.deleteFile(draft.path, draft.sha, `Remove “${title}” after renaming to ${draft.slug}`);
        } catch (error) {
          showNotice(
            `Saved at the new address, but the old file is still there. Delete ${draft.path} on GitHub so the post does not appear twice.`,
            true
          );
        }
      }

      draft.path = path;
      draft.sha = result.sha;
      draft.originalSlug = draft.slug;
      draft.status = 'edit';
      draft.fields.draft = willBeDraft;
      writeWip(null);
      setBusy(false);
      showDone({ title, slug: draft.slug, draft: willBeDraft, commit: result.commit, url: result.url });
    } catch (error) {
      setBusy(false);
      if (error instanceof DeskError && error.status === 403) {
        offerBranchFallback({ title, file, path, mode, message: error });
        return;
      }
      if (error instanceof DeskError && error.status === 422 && draft.status === 'new') {
        /* GitHub refuses to overwrite a file when no sha is supplied: that
           address is already taken by another post. */
        showNotice(
          `A post already lives at /blog/${draft.slug}/. Pick a different address, or open that post from the library and edit it there.`,
          true
        );
        slugField.focus();
        autosaveNow();
        return;
      }
      const hint = error instanceof DeskError && error.hint ? ` ${error.hint}` : '';
      showNotice(`${error.message}${hint}`, true);
      autosaveNow();
    }
  }

  function setBusy(busy, label) {
    [publishButton, draftButton].forEach((button) => {
      if (button) button.disabled = busy;
    });
    if (busy) setState(label || 'Working…');
    else if (draft.status === 'new') setState('New post');
  }

  /* ----------------------- when main will not accept it -------------------- */

  const fallbackPanel = $('[data-fallback]', root);

  function offerBranchFallback({ title, file, path, message }) {
    if (!fallbackPanel) {
      showNotice(`${message.message} ${message.hint}`, true);
      return;
    }
    fallbackPanel.hidden = false;
    $('[data-fallback-text]', fallbackPanel).textContent =
      `${message.message} ${message.hint || ''} Commit to a branch of your own instead, then merge it on GitHub.`.trim();

    $('[data-fallback-go]', fallbackPanel).onclick = async () => {
      const name = `desk/${draft.slug || slugify(title)}-${Date.now().toString(36)}`;
      setBusy(true, `Committing to ${name}…`);
      try {
        const baseSha = await client.branchSha(branch);
        await client.createBranch(name, baseSha);
        const result = await client.writeFile(path, file, `Publish “${title}”`, { sha: '', target: name });
        setBusy(false);
        fallbackPanel.hidden = true;
        showDone({
          title,
          slug: draft.slug,
          draft: false,
          commit: result.commit,
          url: result.url,
          branch: name,
          compare: client.compareUrl(name),
        });
      } catch (error) {
        setBusy(false);
        const hint = error instanceof DeskError && error.hint ? ` ${error.hint}` : '';
        showNotice(`${error.message} ${hint}`, true);
      }
    };

    $('[data-fallback-cancel]', fallbackPanel).onclick = () => {
      fallbackPanel.hidden = true;
    };

    showNotice('');
  }

  /* ---------------------------------- delete ------------------------------- */

  const deleteButton = $('[data-delete]', root);
  const deleteConfirm = $('[data-delete-confirm]', root);

  deleteButton?.addEventListener('click', () => {
    if (draft.status === 'new') {
      showNotice('This post has not been saved yet — go back and it is simply gone.', true);
      return;
    }
    deleteConfirm.hidden = false;
    deleteButton.hidden = true;
  });

  $('[data-delete-cancel]', root)?.addEventListener('click', () => {
    deleteConfirm.hidden = true;
    deleteButton.hidden = false;
  });

  $('[data-delete-go]', root)?.addEventListener('click', async () => {
    if (!draft.path) return;
    setBusy(true, 'Deleting…');
    try {
      await client.deleteFile(draft.path, draft.sha, `Delete “${draft.fields.title}”`);
      writeWip(null);
      setBusy(false);
      deleteConfirm.hidden = true;
      deleteButton.hidden = false;
      await openLibrary();
      say(listNote, 'Deleted. It disappears from the site on the next rebuild.');
    } catch (error) {
      setBusy(false);
      const hint = error instanceof DeskError && error.hint ? ` ${error.hint}` : '';
      showNotice(`${error.message}${hint}`, true);
    }
  });

  /* --------------------------------- done view ---------------------------- */

  const doneView = views.done;

  function showDone({ title, slug, draft: isDraft, commit: sha, url, branch: branchName, compare }) {
    if (!doneView) return;
    stopLiveCheck();

    $('[data-done-title]', doneView).textContent = title;
    $('[data-done-sha]', doneView).textContent = sha ? sha.slice(0, 7) : '';
    const commitLink = $('[data-done-commit]', doneView);
    if (commitLink) {
      commitLink.href = url || `https://github.com/${config.owner}/${config.repo}/commits/${branch}`;
      commitLink.hidden = !url;
    }

    const postLink = $('[data-done-post]', doneView);
    const postUrl = `/blog/${slug}/`;
    if (postLink) {
      postLink.href = postUrl;
      postLink.hidden = isDraft;
    }

    /* Only shown when main was protected and the post went to a branch instead. */
    const compareRow = $('[data-done-compare-row]', doneView);
    const compareLink = $('[data-done-compare]', doneView);
    if (compareRow) compareRow.hidden = !compare;
    if (compareLink) {
      compareLink.href = compare || '#';
      compareLink.textContent = branchName ? `Open a pull request for ${branchName}` : 'Open a pull request';
    }

    const status = $('[data-done-status]', doneView);
    const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(window.location.hostname);

    if (isDraft) {
      status.textContent =
        'Saved as a draft. It is in your repository but stays off the site — the build skips it entirely. Publish it any time from the library.';
    } else if (branchName) {
      status.textContent = `Committed to the branch ${branchName}. Merge the pull request and your host will rebuild.`;
    } else if (local) {
      status.textContent = `Committed to ${branch}. Your host rebuilds from that commit — run \`npm run dev\` locally to see it here.`;
    } else {
      status.textContent = `Committed to ${branch}. Your host is rebuilding now — this page will tell you when the post is live.`;
      startLiveCheck(postUrl, status);
    }

    show('done');
  }

  function startLiveCheck(postUrl, status) {
    let attempts = 0;
    const started = Date.now();

    const tick = async () => {
      attempts += 1;
      try {
        const response = await fetch(postUrl, { cache: 'reload', headers: { Accept: 'text/html' } });
        if (response.ok) {
          stopLiveCheck();
          const seconds = Math.round((Date.now() - started) / 1000);
          status.textContent = `It is live — the rebuild took about ${seconds} seconds.`;
          status.classList.add('is-good');
          $('[data-done-post]', doneView)?.focus();
          return;
        }
      } catch {
        /* the rebuild is mid-flight; keep asking */
      }
      if (attempts >= LIVE_CHECK_ATTEMPTS) {
        stopLiveCheck();
        status.textContent =
          'The commit is in your repository, but the new page has not appeared yet. Check your host’s deploy log — the build may still be running.';
        return;
      }
      status.textContent = `Committed to ${branch}. Rebuilding… (checked ${attempts}×)`;
      liveTimer = window.setTimeout(tick, LIVE_CHECK_INTERVAL);
    };

    liveTimer = window.setTimeout(tick, LIVE_CHECK_INTERVAL);
  }

  function stopLiveCheck() {
    window.clearTimeout(liveTimer);
    liveTimer = 0;
  }

  $('[data-done-again]', doneView)?.addEventListener('click', () => {
    startNewPost();
    show('editor');
    titleField.focus();
  });

  $('[data-done-library]', doneView)?.addEventListener('click', () => openLibrary());

  /* --------------------------------- start -------------------------------- */

  async function mapWithLimit(items, limit, task) {
    const results = new Array(items.length);
    let index = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        results[current] = await task(items[current], current);
      }
    });
    await Promise.all(workers);
    return results;
  }

  /* Never lose writing: save before the page goes away. */
  window.addEventListener('pagehide', () => {
    if (root.dataset.view === 'editor') autosaveNow();
  });

  applyLayout();
  updateCounts();

  const stored = loadToken();
  if (stored) {
    /* A token is already on this device: sign in quietly, and show which kind
       of storage it came from so the choice stays visible. */
    const persisted = tokenIsPersisted();
    $$('[name="remember"]', root).forEach((radio) => {
      radio.checked = persisted ? radio.value === 'device' : radio.value === 'session';
    });
    tokenInput.value = '';
    unlock(stored, persisted);
  } else {
    show('lock');
    tokenInput?.focus({ preventScroll: true });
  }
}

export default mountDesk;
