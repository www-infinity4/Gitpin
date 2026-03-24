/**
 * github.js — Gitpin GitHub API client
 *
 * Wraps the public GitHub REST API (v3).
 * No authentication required for public data (60 req/hr unauthenticated).
 * If a GITHUB_TOKEN is stored in localStorage under 'gitpin_token', it
 * is sent as a Bearer token to raise the rate limit to 5,000 req/hr.
 */

const GitHubAPI = (() => {
  const BASE = 'https://api.github.com';

  /**
   * Build common request headers.
   * @returns {HeadersInit}
   */
  function _headers() {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const token = localStorage.getItem('gitpin_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  /**
   * Perform a GET request to the GitHub API.
   * @param {string} path  - API path, e.g. "/search/repositories?q=…"
   * @returns {Promise<any>}
   */
  async function _get(path) {
    const resp = await fetch(`${BASE}${path}`, { headers: _headers() });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Search repositories by query string.
   * @param {string} query     - GitHub search query (e.g. "react stars:>1000")
   * @param {string} sort      - "stars" | "forks" | "updated"
   * @param {number} perPage   - results per page (max 100)
   * @returns {Promise<{items: Repo[], total_count: number}>}
   */
  async function searchRepos(query, sort = 'stars', perPage = 30) {
    const q = encodeURIComponent(query);
    const data = await _get(
      `/search/repositories?q=${q}&sort=${sort}&order=desc&per_page=${perPage}`
    );
    return data;
  }

  /**
   * Fetch trending/popular repositories (past 30 days, sorted by stars).
   * The GitHub API has no official "trending" endpoint; we approximate it
   * by finding repos created in the last 30 days with many stars.
   * @param {string} language  - optional language filter (e.g. "javascript")
   * @param {string} sort      - "stars" | "forks" | "updated"
   * @param {number} perPage
   * @returns {Promise<{items: Repo[], total_count: number}>}
   */
  async function getTrending(language = '', sort = 'stars', perPage = 30) {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const dateStr = since.toISOString().split('T')[0];

    let q = `created:>${dateStr} stars:>10`;
    if (language) q += ` language:${language}`;

    return searchRepos(q, sort, perPage);
  }

  /**
   * Get the file/directory tree for a repository (flat recursive list).
   * Falls back to the Contents API root listing for very large repos.
   * @param {string} owner
   * @param {string} repo
   * @param {string} [branch]  - branch/sha (defaults to repo default branch)
   * @returns {Promise<TreeNode[]>}  array of {path, type, sha, url} objects
   */
  async function getRepoTree(owner, repo, branch = '') {
    // First, get the repo default branch if not provided
    let ref = branch;
    if (!ref) {
      const repoData = await _get(`/repos/${owner}/${repo}`);
      ref = repoData.default_branch || 'main';
    }

    try {
      const data = await _get(
        `/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`
      );
      if (data.truncated) {
        // Tree is too large — fall back to root directory listing
        return getContents(owner, repo, '');
      }
      return data.tree.filter((n) => n.type === 'blob' || n.type === 'tree');
    } catch {
      // Fallback: list root contents
      return getContents(owner, repo, '');
    }
  }

  /**
   * Get contents of a path in a repository (directory listing or file).
   * @param {string} owner
   * @param {string} repo
   * @param {string} path   - empty string for root
   * @returns {Promise<ContentItem | ContentItem[]>}
   */
  async function getContents(owner, repo, path = '') {
    const encodedPath = path
      ? '/' + path.split('/').map(encodeURIComponent).join('/')
      : '';
    return _get(`/repos/${owner}/${repo}/contents${encodedPath}`);
  }

  /**
   * Fetch and decode the raw text content of a file.
   * Accepts a ContentItem object (from getContents) or a download_url string.
   * @param {ContentItem|string} fileOrUrl
   * @returns {Promise<string>}  decoded file text
   */
  async function getFileContent(fileOrUrl) {
    // If given a ContentItem with a download_url, use raw URL to avoid base64
    const url =
      typeof fileOrUrl === 'string'
        ? fileOrUrl
        : fileOrUrl.download_url || null;

    if (url) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.text();
    }

    // Fall back to base64 decoding if no download_url
    const item =
      typeof fileOrUrl === 'object' ? fileOrUrl : await _get(fileOrUrl);
    if (item.encoding === 'base64') {
      return atob(item.content.replace(/\n/g, ''));
    }
    throw new Error('Cannot decode file content');
  }

  /**
   * Get basic information about a single repository.
   * @param {string} owner
   * @param {string} repo
   * @returns {Promise<Repo>}
   */
  function getRepo(owner, repo) {
    return _get(`/repos/${owner}/${repo}`);
  }

  return { searchRepos, getTrending, getRepoTree, getContents, getFileContent, getRepo };
})();
