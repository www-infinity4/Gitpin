/**
 * app.js — Gitpin main application logic
 *
 * Features:
 *  • Discover / trending repositories (GitHub Search API)
 *  • Search repositories by query
 *  • Pin / unpin repos (persisted in localStorage)
 *  • View pinned repos in "Pinned" tab
 *  • Open file explorer panel (file tree + file content viewer)
 *  • Language & sort filters
 *  • Toast notifications
 */

/* ═══════════════════════════════════════════════
   CONSTANTS & STATE
═══════════════════════════════════════════════ */
const STORAGE_KEY = 'gitpin_pins';

// Mutable app state
const state = {
  activeTab: 'discover',   // 'discover' | 'pinned'
  searchQuery: '',
  language: '',
  sort: 'stars',
  repos: [],               // displayed repos
  pins: loadPins(),        // Map<fullName, RepoData>
  filePanel: {
    open: false,
    repo: null,            // full repo object
    currentPath: '',
    treeData: null,        // flat array of tree nodes
  },
};

/* ═══════════════════════════════════════════════
   DOM REFS
═══════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);

const dom = {
  searchForm:       $('searchForm'),
  searchInput:      $('searchInput'),
  discoverTab:      $('discoverTab'),
  pinnedTab:        $('pinnedTab'),
  pinCount:         $('pinCount'),
  toolbarTitle:     $('toolbarTitle'),
  toolbar:          $('toolbar'),
  languageFilter:   $('languageFilter'),
  sortFilter:       $('sortFilter'),
  loadingState:     $('loadingState'),
  emptyState:       $('emptyState'),
  emptyMessage:     $('emptyMessage'),
  repoGrid:         $('repoGrid'),
  // File panel
  filePanel:        $('filePanel'),
  filePanelClose:   $('filePanelClose'),
  filePanelFork:    $('filePanelFork'),
  filePanelGH:      $('filePanelGH'),
  filePanelRepoName:$('filePanelRepoName'),
  filePanelRepoMeta:$('filePanelRepoMeta'),
  fileTreeLoading:  $('fileTreeLoading'),
  fileTree:         $('fileTree'),
  fileTreePane:     $('fileTreePane'),
  fileViewerPane:   $('fileViewerPane'),
  fileViewerBack:   $('fileViewerBack'),
  fileViewerFilename:$('fileViewerFilename'),
  fileViewerCopy:   $('fileViewerCopy'),
  fileViewerCode:   $('fileViewerCodeInner'),
  overlay:          $('overlay'),
  logoHome:         $('logoHome'),
};

/* ═══════════════════════════════════════════════
   PERSISTENCE
═══════════════════════════════════════════════ */
function loadPins() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Map(Object.entries(JSON.parse(raw))) : new Map();
  } catch {
    return new Map();
  }
}

function savePins() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(state.pins))
    );
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — silently ignore
  }
}

/* ═══════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════ */
let toastTimer = null;

function showToast(message, duration = 2500) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

/* ═══════════════════════════════════════════════
   PIN / UNPIN
═══════════════════════════════════════════════ */
function togglePin(repo) {
  const key = repo.full_name;
  if (state.pins.has(key)) {
    state.pins.delete(key);
    showToast(`Unpinned ${repo.name}`);
  } else {
    state.pins.set(key, repo);
    showToast(`∆ Pinned ${repo.name}`);
  }
  savePins();
  updatePinCount();

  // Update card state in DOM
  const card = document.querySelector(`.repo-card[data-repo="${key}"]`);
  if (card) syncCardPinState(card, state.pins.has(key));

  // If on pinned tab, re-render immediately
  if (state.activeTab === 'pinned') renderRepos(getPinnedRepos());
}

function isPinned(fullName) {
  return state.pins.has(fullName);
}

function getPinnedRepos() {
  return Array.from(state.pins.values());
}

function updatePinCount() {
  const count = state.pins.size;
  dom.pinCount.textContent = count > 0 ? count : '';
}

function syncCardPinState(card, pinned) {
  const btn = card.querySelector('.pin-btn');
  if (!btn) return;
  if (pinned) {
    card.classList.add('is-pinned');
    btn.classList.add('pinned');
    btn.innerHTML = pinBtnHTML(true);
  } else {
    card.classList.remove('is-pinned');
    btn.classList.remove('pinned');
    btn.innerHTML = pinBtnHTML(false);
  }
}

function pinBtnHTML(pinned) {
  return `<span class="btn-icon">${pinned ? '∆' : '△'}</span> ${pinned ? 'Pinned' : 'Pin'}`;
}

/* ═══════════════════════════════════════════════
   RENDER
═══════════════════════════════════════════════ */
function setLoading(loading) {
  dom.loadingState.classList.toggle('hidden', !loading);
  dom.repoGrid.classList.toggle('hidden', loading);
  dom.emptyState.classList.add('hidden');
}

function showEmpty(message = 'No repositories found.') {
  dom.emptyState.classList.remove('hidden');
  dom.emptyMessage.textContent = message;
  dom.repoGrid.classList.add('hidden');
  dom.loadingState.classList.add('hidden');
}

function renderRepos(repos) {
  dom.loadingState.classList.add('hidden');

  if (!repos || repos.length === 0) {
    showEmpty(
      state.activeTab === 'pinned'
        ? 'No pinned repos yet. Hit ∆ Pin on any repo to save it here!'
        : 'No repositories found. Try a different query or filter.'
    );
    return;
  }

  dom.emptyState.classList.add('hidden');
  dom.repoGrid.classList.remove('hidden');
  dom.repoGrid.innerHTML = repos.map(buildRepoCard).join('');
  attachCardListeners();
}

/* ── Card HTML ─────────────────────────────── */
function buildRepoCard(repo) {
  const pinned = isPinned(repo.full_name);
  const lang = repo.language || '';
  const langClass = getLangClass(lang);
  const topics = (repo.topics || []).slice(0, 5);
  const stars = fmtNumber(repo.stargazers_count);
  const forks = fmtNumber(repo.forks_count);
  const updated = fmtDate(repo.updated_at);

  return `
  <article class="repo-card${pinned ? ' is-pinned' : ''}" data-repo="${esc(repo.full_name)}">
    <div class="card-header">
      <img
        class="card-avatar"
        src="${esc(repo.owner.avatar_url)}&s=48"
        alt="${esc(repo.owner.login)}"
        width="36" height="36"
        loading="lazy"
        onerror="this.style.display='none'"
      />
      <div class="card-repo-info">
        <a
          class="card-repo-name"
          href="${esc(repo.html_url)}"
          target="_blank"
          rel="noopener noreferrer"
          title="${esc(repo.full_name)}"
        >${esc(repo.name)}</a>
        <div class="card-owner">${esc(repo.owner.login)}</div>
      </div>
    </div>

    ${repo.description ? `<p class="card-description">${esc(repo.description)}</p>` : ''}

    ${topics.length ? `
    <div class="card-topics">
      ${topics.map((t) => `<span class="topic-tag" data-topic="${esc(t)}">${esc(t)}</span>`).join('')}
    </div>` : ''}

    <div class="card-stats">
      ${lang ? `
      <span class="stat-item">
        <span class="lang-dot ${langClass}"></span>
        ${esc(lang)}
      </span>` : ''}
      <span class="stat-item">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        ${stars}
      </span>
      <span class="stat-item">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
          <path d="M6 9v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/>
        </svg>
        ${forks}
      </span>
      <span class="stat-item" title="Updated ${updated}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        ${updated}
      </span>
    </div>

    <div class="card-actions">
      <button class="card-btn pin-btn${pinned ? ' pinned' : ''}" data-action="pin" aria-label="${pinned ? 'Unpin' : 'Pin'} ${esc(repo.name)}">
        ${pinBtnHTML(pinned)}
      </button>
      <button class="card-btn files-btn" data-action="files" aria-label="Browse files for ${esc(repo.name)}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        Files
      </button>
      <a
        class="card-btn fork-btn"
        href="https://github.com/${esc(repo.full_name)}/fork"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Fork ${esc(repo.name)} on GitHub"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
          <path d="M6 9v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/>
        </svg>
        Fork
      </a>
    </div>
  </article>`;
}

/* ── Attach card event listeners after render ── */
function attachCardListeners() {
  dom.repoGrid.querySelectorAll('.repo-card').forEach((card) => {
    const fullName = card.dataset.repo;
    const repo = findRepo(fullName);
    if (!repo) return;

    // Pin button
    card.querySelector('[data-action="pin"]')?.addEventListener('click', () => {
      togglePin(repo);
    });

    // Files button
    card.querySelector('[data-action="files"]')?.addEventListener('click', () => {
      openFilePanel(repo);
    });

    // Topic tags → trigger search
    card.querySelectorAll('.topic-tag').forEach((tag) => {
      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        const topic = tag.dataset.topic;
        dom.searchInput.value = `topic:${topic}`;
        handleSearch(`topic:${topic}`);
      });
    });
  });
}

/** Look up a repo object by full_name from all known sources */
function findRepo(fullName) {
  // Check current displayed repos first
  let repo = state.repos.find((r) => r.full_name === fullName);
  if (!repo) repo = state.pins.get(fullName);
  return repo || null;
}

/* ═══════════════════════════════════════════════
   FILE PANEL
═══════════════════════════════════════════════ */
async function openFilePanel(repo) {
  state.filePanel.repo = repo;
  state.filePanel.treeData = null;
  state.filePanel.currentPath = '';

  // Update panel header
  dom.filePanelRepoName.textContent = repo.full_name;
  dom.filePanelRepoMeta.textContent =
    [repo.language, fmtNumber(repo.stargazers_count) + ' stars'].filter(Boolean).join(' · ');
  dom.filePanelFork.href = `https://github.com/${repo.full_name}/fork`;
  dom.filePanelGH.href = repo.html_url;

  // Reset to tree view
  showFileTree();

  // Open panel
  dom.filePanel.classList.add('open');
  dom.filePanel.setAttribute('aria-hidden', 'false');
  dom.overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Load tree
  dom.fileTreeLoading.classList.remove('hidden');
  dom.fileTree.innerHTML = '';
  dom.fileTree.classList.add('hidden');

  try {
    const tree = await GitHubAPI.getRepoTree(repo.owner.login, repo.name);
    state.filePanel.treeData = tree;
    dom.fileTreeLoading.classList.add('hidden');
    dom.fileTree.classList.remove('hidden');
    renderFileTree(tree, dom.fileTree, '');
  } catch (err) {
    dom.fileTreeLoading.innerHTML = `<span style="color:var(--clr-red)">Error loading files: ${esc(err.message)}</span>`;
  }
}

function closeFilePanel() {
  dom.filePanel.classList.remove('open');
  dom.filePanel.setAttribute('aria-hidden', 'true');
  dom.overlay.classList.remove('active');
  document.body.style.overflow = '';
  state.filePanel.open = false;
}

/* ── File tree renderer ─────────────────────── */
function renderFileTree(nodes, container, prefix) {
  // Build a nested structure from flat paths
  const tree = buildTree(nodes, prefix);
  container.innerHTML = '';
  renderTreeNodes(tree, container);
}

/**
 * Convert flat array of {path, type} into nested tree structure.
 * Handles both "git trees" format ({path, type:'blob'|'tree'}) and
 * "contents API" format ({name, type:'file'|'dir'}).
 */
function buildTree(nodes, prefix = '') {
  const root = {};

  nodes.forEach((node) => {
    // Normalize between Git Tree API and Contents API formats
    const path = node.path !== undefined ? node.path : node.name;
    const type = node.type === 'tree' || node.type === 'dir' ? 'dir' : 'file';

    // Only include nodes under the given prefix
    if (prefix && !path.startsWith(prefix + '/') && path !== prefix) return;
    const rel = prefix ? path.slice(prefix.length + 1) : path;
    if (!rel) return;

    const parts = rel.split('/');
    let cursor = root;
    parts.forEach((part, i) => {
      if (!cursor[part]) {
        cursor[part] = {
          _name: part,
          _type: i === parts.length - 1 ? type : 'dir',
          _fullPath: prefix ? `${prefix}/${parts.slice(0, i + 1).join('/')}` : parts.slice(0, i + 1).join('/'),
          _node: i === parts.length - 1 ? node : null,
          _children: {},
        };
      }
      cursor = cursor[part]._children;
    });
  });

  return root;
}

function renderTreeNodes(tree, container) {
  // Dirs first, then files
  const entries = Object.values(tree).sort((a, b) => {
    if (a._type !== b._type) return a._type === 'dir' ? -1 : 1;
    return a._name.localeCompare(b._name, undefined, { sensitivity: 'base' });
  });

  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');

    const item = document.createElement('div');
    item.className = 'tree-item';
    item.dataset.path = entry._fullPath;
    item.dataset.type = entry._type;

    const hasChildren = Object.keys(entry._children).length > 0;
    const icon = entry._type === 'dir' ? '📁' : getFileIcon(entry._name);

    item.innerHTML = `
      <span class="item-icon">${icon}</span>
      <span class="item-name">${esc(entry._name)}</span>
      ${entry._type === 'dir' ? '<span class="item-chevron">▶</span>' : ''}
    `;

    li.appendChild(item);

    if (entry._type === 'dir') {
      const childUl = document.createElement('ul');
      childUl.className = 'tree-children';
      childUl.setAttribute('role', 'group');

      if (hasChildren) {
        renderTreeNodes(entry._children, childUl);
      }

      li.appendChild(childUl);

      item.addEventListener('click', () => toggleDir(item, childUl, entry, hasChildren));
    } else {
      item.addEventListener('click', () => openFile(entry._node || entry, entry._name, entry._fullPath));
    }

    container.appendChild(li);
  });
}

async function toggleDir(item, childUl, entry, preloaded) {
  const isOpen = item.classList.contains('open');

  if (isOpen) {
    item.classList.remove('open');
    childUl.classList.remove('open');
    return;
  }

  item.classList.add('open');
  childUl.classList.add('open');

  // If directory had no pre-loaded children, fetch via Contents API
  if (!preloaded && childUl.children.length === 0) {
    childUl.innerHTML = '<li class="tree-item"><span class="spinner spinner-sm"></span></li>';
    try {
      const repo = state.filePanel.repo;
      const contents = await GitHubAPI.getContents(repo.owner.login, repo.name, entry._fullPath);
      const items = Array.isArray(contents) ? contents : [contents];
      // Build nested tree from contents
      const tree = buildTree(items, '');
      childUl.innerHTML = '';
      renderTreeNodes(tree, childUl);
    } catch (err) {
      childUl.innerHTML = `<li class="tree-item" style="color:var(--clr-red)">Error: ${esc(err.message)}</li>`;
    }
  }
}

/* ── File viewer ────────────────────────────── */
async function openFile(node, filename, fullPath) {
  // Highlight active tree item
  document.querySelectorAll('.tree-item.active').forEach((el) => el.classList.remove('active'));
  const treeItem = document.querySelector(`.tree-item[data-path="${CSS.escape(fullPath)}"]`);
  if (treeItem) treeItem.classList.add('active');

  // Show viewer pane
  showFileViewer();
  dom.fileViewerFilename.textContent = filename;
  dom.fileViewerCode.textContent = 'Loading…';
  dom.fileViewerCode.removeAttribute('class');

  try {
    const repo = state.filePanel.repo;
    let content;

    // Try download_url first (fastest), fall back to Contents API
    if (node.download_url) {
      content = await GitHubAPI.getFileContent(node);
    } else if (node._fullPath || fullPath) {
      const path = fullPath || node._fullPath;
      const contentItem = await GitHubAPI.getContents(repo.owner.login, repo.name, path);
      content = await GitHubAPI.getFileContent(contentItem);
    } else {
      content = await GitHubAPI.getFileContent(node);
    }

    dom.fileViewerCode.textContent = content;

    // Syntax highlighting
    const ext = filename.split('.').pop().toLowerCase();
    const langMap = {
      js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
      cs: 'csharp', cpp: 'cpp', c: 'c', php: 'php', swift: 'swift',
      kt: 'kotlin', html: 'html', css: 'css', scss: 'scss', less: 'less',
      json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
      sh: 'shell', bash: 'shell', dockerfile: 'dockerfile', sql: 'sql',
      xml: 'xml', toml: 'ini',
    };
    const lang = langMap[ext];
    if (lang) dom.fileViewerCode.classList.add(`language-${lang}`);

    if (window.hljs) hljs.highlightElement(dom.fileViewerCode);
  } catch (err) {
    dom.fileViewerCode.textContent = `Error loading file: ${err.message}`;
  }
}

function showFileTree() {
  dom.fileTreePane.classList.remove('hidden');
  dom.fileViewerPane.classList.add('hidden');
}

function showFileViewer() {
  dom.fileTreePane.classList.add('hidden');
  dom.fileViewerPane.classList.remove('hidden');
}

/* ── Copy file content ──────────────────────── */
function copyFileContent() {
  const text = dom.fileViewerCode.textContent;
  if (!navigator.clipboard) {
    showToast('Clipboard not available');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    dom.fileViewerCopy.classList.add('copied');
    dom.fileViewerCopy.textContent = 'Copied!';
    setTimeout(() => {
      dom.fileViewerCopy.classList.remove('copied');
      dom.fileViewerCopy.textContent = 'Copy';
    }, 2000);
  });
}

/* ═══════════════════════════════════════════════
   DATA LOADING
═══════════════════════════════════════════════ */
async function loadTrending() {
  setLoading(true);
  dom.toolbarTitle.textContent = 'Trending Repositories';
  try {
    const result = await GitHubAPI.getTrending(state.language, state.sort);
    state.repos = result.items || [];
    renderRepos(state.repos);
  } catch (err) {
    setLoading(false);
    showEmpty(`Failed to load repositories: ${err.message}`);
  }
}

async function handleSearch(query) {
  if (!query.trim()) {
    state.searchQuery = '';
    setActiveTab('discover');
    return;
  }
  state.searchQuery = query.trim();
  state.activeTab = 'discover';
  setActiveTab('discover');
  setLoading(true);

  let q = state.searchQuery;
  if (state.language && !q.includes('language:')) q += ` language:${state.language}`;
  dom.toolbarTitle.textContent = `Results for "${state.searchQuery}"`;

  try {
    const result = await GitHubAPI.searchRepos(q, state.sort);
    state.repos = result.items || [];
    renderRepos(state.repos);
  } catch (err) {
    setLoading(false);
    showEmpty(`Search failed: ${err.message}`);
  }
}

/* ═══════════════════════════════════════════════
   TAB SWITCHING
═══════════════════════════════════════════════ */
function setActiveTab(tab) {
  state.activeTab = tab;
  dom.discoverTab.classList.toggle('active', tab === 'discover');
  dom.pinnedTab.classList.toggle('active', tab === 'pinned');

  // Show/hide filters
  dom.toolbar.style.display = tab === 'pinned' ? 'none' : '';

  if (tab === 'pinned') {
    dom.toolbarTitle.textContent = 'Pinned Repositories';
    renderRepos(getPinnedRepos());
  } else {
    if (state.searchQuery) {
      handleSearch(state.searchQuery);
    } else {
      loadTrending();
    }
  }
}

/* ═══════════════════════════════════════════════
   UTILITY
═══════════════════════════════════════════════ */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNumber(n) {
  if (!n && n !== 0) return '0';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}yr ago`;
}

function getLangClass(lang) {
  if (!lang) return 'lang-default';
  const map = {
    'JavaScript': 'lang-JavaScript', 'TypeScript': 'lang-TypeScript',
    'Python': 'lang-Python', 'Go': 'lang-Go', 'Rust': 'lang-Rust',
    'Java': 'lang-Java', 'C++': 'lang-Cpp', 'C': 'lang-C',
    'C#': 'lang-CSharp', 'Ruby': 'lang-Ruby', 'PHP': 'lang-PHP',
    'Swift': 'lang-Swift', 'Kotlin': 'lang-Kotlin', 'HTML': 'lang-HTML',
    'CSS': 'lang-CSS', 'Shell': 'lang-Shell', 'Vue': 'lang-Vue',
  };
  return map[lang] || 'lang-default';
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    js: '📜', ts: '📘', jsx: '⚛', tsx: '⚛', json: '📋',
    html: '🌐', css: '🎨', scss: '🎨', less: '🎨',
    py: '🐍', rb: '💎', go: '🔵', rs: '🦀', java: '☕',
    md: '📝', txt: '📄', sh: '⚙️', bash: '⚙️',
    png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', svg: '🖼', ico: '🖼',
    yml: '⚙️', yaml: '⚙️', toml: '⚙️', env: '⚙️',
    gitignore: '🚫', dockerfile: '🐳', lock: '🔒',
    sql: '🗄️', xml: '📋', csv: '📊',
  };
  return icons[ext] || icons[filename.toLowerCase()] || '📄';
}

/* ═══════════════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════════════ */
function init() {
  // Logo — go home
  dom.logoHome.addEventListener('click', (e) => {
    e.preventDefault();
    dom.searchInput.value = '';
    state.searchQuery = '';
    setActiveTab('discover');
  });

  // Search form
  dom.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSearch(dom.searchInput.value);
  });

  // Tab buttons
  dom.discoverTab.addEventListener('click', () => {
    if (state.activeTab !== 'discover') setActiveTab('discover');
  });
  dom.pinnedTab.addEventListener('click', () => {
    setActiveTab('pinned');
  });

  // Filters
  dom.languageFilter.addEventListener('change', () => {
    state.language = dom.languageFilter.value;
    if (state.searchQuery) {
      handleSearch(state.searchQuery);
    } else {
      loadTrending();
    }
  });

  dom.sortFilter.addEventListener('change', () => {
    state.sort = dom.sortFilter.value;
    if (state.searchQuery) {
      handleSearch(state.searchQuery);
    } else {
      loadTrending();
    }
  });

  // File panel close
  dom.filePanelClose.addEventListener('click', closeFilePanel);
  dom.overlay.addEventListener('click', closeFilePanel);

  // File viewer back button
  dom.fileViewerBack.addEventListener('click', showFileTree);

  // Copy button
  dom.fileViewerCopy.addEventListener('click', copyFileContent);

  // Keyboard: Escape closes file panel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.filePanel.classList.contains('open')) {
      closeFilePanel();
    }
  });

  // ── Init pin count & load data ────────────────
  updatePinCount();
  loadTrending();
}

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
