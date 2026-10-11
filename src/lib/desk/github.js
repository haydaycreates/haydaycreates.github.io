/**
 * Talking to GitHub from the browser.
 *
 * The writing desk has no server of its own — it commits your markdown straight
 * to the repository using GitHub's REST API and the token you keep in your own
 * browser. Nothing else sees that token: it is only ever sent to api.github.com,
 * only from this page, and only after you paste it.
 *
 * Everything here uses the repository "Contents" endpoints, which need exactly
 * one fine-grained permission — Contents: Read and write — and support files up
 * to 100 MB, so cover images upload through the same door as the post itself.
 *
 * Your host (GitHub Pages, Cloudflare Pages, Netlify) notices the new commit on
 * main and rebuilds; that is the whole publishing pipeline.
 */

export const GITHUB_API = 'https://api.github.com';

/** An error with a sentence a writer can act on, not a stack trace. */
export class DeskError extends Error {
  constructor(message, { status = 0, hint = '', step = '' } = {}) {
    super(message);
    this.name = 'DeskError';
    this.status = status;
    this.hint = hint;
    this.step = step;
  }
}

/* --------------------------------- base64 --------------------------------- */

/** Uint8Array → base64, in chunks so a large image cannot blow the stack. */
export function toBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes));
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 → text, decoded as UTF-8 so curly quotes and em dashes survive. */
export function fromBase64(base64) {
  const binary = atob(String(base64).replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* -------------------------------- the client ------------------------------ */

/** Turns a GitHub error response into something worth reading. */
function explain(status, body, step, response) {
  const message = body?.message || `GitHub replied ${status}`;
  const required = response?.headers?.get?.('X-Accepted-GitHub-Permissions') || '';

  if (status === 401) {
    return new DeskError('GitHub rejected that token.', {
      status,
      step,
      hint: 'It may be expired, revoked, or copied incompletely. Generate a new fine-grained token and try again.',
    });
  }
  if (status === 403 && /rate limit/i.test(message)) {
    return new DeskError('GitHub rate limit reached.', {
      status,
      step,
      hint: 'Authenticated requests are limited to 5,000 an hour. Wait a little and try again — your writing is still saved in this browser.',
    });
  }
  if (status === 403) {
    return new DeskError(`GitHub refused this step${step ? ` (${step})` : ''}.`, {
      status,
      step,
      hint: required
        ? `The token needs the "${required}" permission on this repository.`
        : 'The token needs Contents: Read and write on this repository, and main may be protected.',
    });
  }
  if (status === 404) {
    return new DeskError(step === 'repo' ? 'That repository is not visible to this token.' : 'Not found.', {
      status,
      step,
      hint:
        step === 'repo'
          ? 'Check the owner and repository name in src/site.config.js, and that the token was granted access to this repository specifically.'
          : 'The file or branch may have been renamed or deleted on GitHub.',
    });
  }
  if (status === 409) {
    return new DeskError('That file changed on GitHub since you opened it.', {
      status,
      step,
      hint: 'Reload the post to pick up the newer version, then re-apply your changes.',
    });
  }
  if (status === 422) {
    return new DeskError(`GitHub could not save this${step ? ` (${step})` : ''}.`, {
      status,
      step,
      hint: /too large/i.test(message)
        ? 'The file is over GitHub’s 100 MB limit — use a smaller image.'
        : message,
    });
  }

  return new DeskError(message, { status, step, hint: body?.documentation_url || '' });
}

/**
 * @param {string} token  a GitHub personal access token (fine-grained or classic)
 * @param {{owner: string, repo: string, branch: string, postsDir: string, mediaDir: string}} config
 */
export function createGitHubClient(token, config) {
  const { owner, repo, branch } = config;
  const slug = `${owner}/${repo}`;

  async function request(path, { method = 'GET', body, accept = 'application/vnd.github+json', raw = false } = {}) {
    let response;
    try {
      response = await fetch(`${GITHUB_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new DeskError('Could not reach api.github.com.', {
        step: path,
        hint: 'Check the connection, or an ad blocker / privacy extension that may be cutting the request off.',
      });
    }

    if (raw) {
      if (!response.ok) throw await explain(response.status, await safeJson(response), path, response);
      return response.text();
    }

    const payload = await safeJson(response);
    if (!response.ok) throw explain(response.status, payload, path, response);
    return payload;
  }

  const safeJson = async (response) => {
    try {
      return await response.json();
    } catch {
      return null;
    }
  };

  const encoded = (filePath) => filePath.split('/').map(encodeURIComponent).join('/');

  return {
    token,
    config,
    slug,

    /** Signs in: confirms the token works, can see the repo, and can push. */
    async verify() {
      /* `GET /user` is best-effort — some fine-grained tokens cannot read it,
         and the repository check below is the one that actually matters. */
      const user = await request('/user').catch(() => null);
      const info = await request(`/repos/${slug}`, { }).catch((error) => {
        if (error instanceof DeskError && error.status === 404) {
          throw explain(404, { message: 'Repository not visible to this token' }, 'repo');
        }
        throw error;
      });

      const canWrite = Boolean(info?.permissions?.push);
      if (!canWrite) {
        throw new DeskError('That token can read this repository but not write to it.', {
          status: 403,
          step: 'repo',
          hint: 'Recreate it with Contents: Read and write, and make sure your own repository is ticked under Repository access.',
        });
      }

      return {
        login: user?.login || info?.owner?.login || 'you',
        repo: info?.full_name || slug,
        private: Boolean(info?.private),
        defaultBranch: info?.default_branch || branch,
        canWrite,
      };
    },

    /** Every markdown file in the posts folder, newest name first. */
    async listPosts(dir = config.postsDir) {
      const entries = await request(`/repos/${slug}/contents/${encoded(dir)}?ref=${encodeURIComponent(branch)}`);
      return (Array.isArray(entries) ? entries : [])
        .filter((entry) => entry.type === 'file' && /\.mdx?$/i.test(entry.name))
        .map((entry) => ({ name: entry.name, path: entry.path, sha: entry.sha, size: entry.size }));
    },

    /** Reads one file, returning its text and the sha needed to update it. */
    async readFile(filePath) {
      const info = await request(`/repos/${slug}/contents/${encoded(filePath)}?ref=${encodeURIComponent(branch)}`);
      if (info?.content === undefined) {
        /* Larger than the JSON endpoint returns — ask for the raw bytes instead. */
        const text = await request(`/repos/${slug}/contents/${encoded(filePath)}?ref=${encodeURIComponent(branch)}`, {
          accept: 'application/vnd.github.raw+json',
          raw: true,
        });
        return { text, sha: info?.sha || '' };
      }
      return { text: fromBase64(info.content), sha: info.sha };
    },

    /** Creates or updates a file in one commit — a markdown string or raw bytes. */
    async writeFile(filePath, content, message, { sha = '', target = branch } = {}) {
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      const payload = {
        message,
        content: toBase64(bytes),
        branch: target,
        ...(sha ? { sha } : {}),
      };
      const result = await request(`/repos/${slug}/contents/${encoded(filePath)}`, {
        method: 'PUT',
        body: payload,
      });
      return {
        sha: result?.content?.sha || '',
        commit: result?.commit?.sha || '',
        url: result?.commit?.html_url || `https://github.com/${slug}/commits/${target}`,
      };
    },

    /** Removes a file — used when a post is renamed, so no duplicate is left. */
    async deleteFile(filePath, sha, message, { target = branch } = {}) {
      const result = await request(`/repos/${slug}/contents/${encoded(filePath)}`, {
        method: 'DELETE',
        body: { message, sha, branch: target },
      });
      return { commit: result?.commit?.sha || '' };
    },

    /**
     * Best-effort branch creation, for repositories whose main branch is
     * protected and will not accept a direct commit. Needs Contents write;
     * if GitHub refuses, the desk falls back to telling you what to click.
     */
    async createBranch(name, fromSha) {
      return request(`/repos/${slug}/git/refs`, {
        method: 'POST',
        body: { ref: `refs/heads/${name}`, sha: fromSha },
      });
    },

    async branchSha(target = branch) {
      const ref = await request(`/repos/${slug}/git/ref/heads/${encodeURIComponent(target)}`);
      return ref?.object?.sha || '';
    },

    /** A URL to open the file on github.com — handy after any error. */
    fileUrl(filePath, target = branch) {
      return `https://github.com/${slug}/blob/${target}/${filePath}`;
    },

    compareUrl(head) {
      return `https://github.com/${slug}/compare/${branch}...${head}?expand=1`;
    },
  };
}

/* ------------------------------- token storage ---------------------------- */

const TOKEN_KEY = 'slowdraft.desk.token';

/**
 * Where the token lives. localStorage keeps it on this device (a phone you
 * write on every day); sessionStorage forgets it the moment the tab closes.
 * It never leaves the browser except as an Authorization header to GitHub.
 */
export function saveToken(token, { persist = true } = {}) {
  try {
    const store = persist ? window.localStorage : window.sessionStorage;
    store.setItem(TOKEN_KEY, token);
    if (persist) window.sessionStorage.removeItem(TOKEN_KEY);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Private browsing can refuse storage — the session still works in memory. */
  }
}

export function loadToken() {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) || window.localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function clearToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function tokenIsPersisted() {
  try {
    return Boolean(window.localStorage.getItem(TOKEN_KEY));
  } catch {
    return false;
  }
}
