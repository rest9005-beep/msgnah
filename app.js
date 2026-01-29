/**
 * RedBlack Social (static)
 * - users/posts/likes/comments => localStorage
 * - media blobs => IndexedDB
 */

const LS_USERS = "rb_users_v1";
const LS_POSTS = "rb_posts_v1";
const LS_SESSION = "rb_session_v1";

const DB_NAME = "rb_social_db_v1";
const DB_VERSION = 1;
const STORE_MEDIA = "media";

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

const els = {
  openAuthBtn: $("#openAuthBtn"),
  heroAuthBtn: $("#heroAuthBtn"),
  authModal: $("#authModal"),
  postModal: $("#postModal"),
  tabLogin: $("#tabLogin"),
  tabRegister: $("#tabRegister"),
  loginForm: $("#loginForm"),
  registerForm: $("#registerForm"),
  authTitle: $("#authTitle"),

  loginUsername: $("#loginUsername"),
  loginPassword: $("#loginPassword"),
  regUsername: $("#regUsername"),
  regPassword: $("#regPassword"),

  userPill: $("#userPill"),
  userName: $("#userName"),
  logoutBtn: $("#logoutBtn"),

  newPostBtn: $("#newPostBtn"),
  postForm: $("#postForm"),
  postFile: $("#postFile"),
  postDesc: $("#postDesc"),

  feedList: $("#feedList"),
  emptyState: $("#emptyState"),
  refreshBtn: $("#refreshBtn"),
  heroRefreshBtn: $("#heroRefreshBtn"),
  searchInput: $("#searchInput"),

  postTpl: $("#postTpl"),
  brand: $("#brand")
};

function toast(msg) {
  // Simple alert for MVP. Можно заменить на красивый тост.
  alert(msg);
}

/* --------------------------
   Local storage helpers
--------------------------- */
function loadJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getSession() {
  return localStorage.getItem(LS_SESSION) || "";
}
function setSession(username) {
  if (username) localStorage.setItem(LS_SESSION, username);
  else localStorage.removeItem(LS_SESSION);
}

/* --------------------------
   IndexedDB helpers
--------------------------- */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutMedia({ id, mime, blob }) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, "readwrite");
    tx.objectStore(STORE_MEDIA).put({ id, mime, blob, savedAt: Date.now() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetMedia(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEDIA, "readonly");
    const req = tx.objectStore(STORE_MEDIA).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/* --------------------------
   Crypto (SHA-256)
--------------------------- */
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2, "0")).join("");
}

/* --------------------------
   Data model
--------------------------- */
function getUsers() {
  return loadJson(LS_USERS, []);
}
function setUsers(users) {
  saveJson(LS_USERS, users);
}

function getPosts() {
  return loadJson(LS_POSTS, []);
}
function setPosts(posts) {
  saveJson(LS_POSTS, posts);
}

function makeId(prefix="id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff/60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff/3600)} ч назад`;
  return d.toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

/* --------------------------
   UI state
--------------------------- */
function showModal(id, show) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = !show;
  document.body.style.overflow = show ? "hidden" : "";
}

function setAuthMode(mode) {
  const isLogin = mode === "login";
  els.tabLogin.classList.toggle("tab--active", isLogin);
  els.tabRegister.classList.toggle("tab--active", !isLogin);
  els.loginForm.hidden = !isLogin;
  els.registerForm.hidden = isLogin;
  els.authTitle.textContent = isLogin ? "Вход" : "Регистрация";
}

function refreshTopbar() {
  const username = getSession();
  const logged = Boolean(username);
  els.userPill.hidden = !logged;
  els.openAuthBtn.hidden = logged;
  els.userName.textContent = logged ? `@${username}` : "";
}

/* --------------------------
   Auth
--------------------------- */
async function register(username, password) {
  username = username.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    throw new Error("Username: 3-20 символов (латиница/цифры/_)");
  }
  if (password.length < 6) throw new Error("Пароль минимум 6 символов");

  const users = getUsers();
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("Такой username уже занят");
  }

  const passHash = await sha256(password);
  users.push({ username, passHash, createdAt: Date.now() });
  setUsers(users);
  setSession(username);
}

async function login(username, password) {
  username = username.trim();
  const users = getUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) throw new Error("Неверный username или пароль");

  const passHash = await sha256(password);
  if (passHash !== user.passHash) throw new Error("Неверный username или пароль");

  setSession(user.username);
}

function logout() {
  setSession("");
  refreshTopbar();
  renderFeed();
}

/* --------------------------
   Posts
--------------------------- */
async function createPost(file, description) {
  const username = getSession();
  if (!username) throw new Error("Нужно войти");

  if (!file) throw new Error("Файл обязателен");
  const mime = file.type || "";
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  if (!isImage && !isVideo) throw new Error("Только image/* или video/*");

  const mediaId = makeId("media");
  await idbPutMedia({ id: mediaId, mime, blob: file });

  const post = {
    id: makeId("post"),
    author: username,
    description: (description || "").slice(0, 1000),
    mediaId,
    mediaType: isVideo ? "video" : "image",
    mime,
    createdAt: Date.now(),
    likes: [],
    comments: []
  };

  const posts = getPosts();
  posts.unshift(post);
  setPosts(posts);
}

function toggleLike(postId) {
  const username = getSession();
  if (!username) throw new Error("Нужно войти");

  const posts = getPosts();
  const p = posts.find(x => x.id === postId);
  if (!p) throw new Error("Пост не найден");

  const idx = p.likes.indexOf(username);
  if (idx >= 0) p.likes.splice(idx, 1);
  else p.likes.push(username);

  setPosts(posts);
}

function addComment(postId, text) {
  const username = getSession();
  if (!username) throw new Error("Нужно войти");
  const t = (text || "").trim();
  if (!t) throw new Error("Пустой комментарий");

  const posts = getPosts();
  const p = posts.find(x => x.id === postId);
  if (!p) throw new Error("Пост не найден");

  p.comments.unshift({
    id: makeId("c"),
    user: username,
    text: t.slice(0, 500),
    createdAt: Date.now()
  });

  setPosts(posts);
}

/* --------------------------
   Rendering
--------------------------- */
let activeMediaUrls = new Map(); // postId -> objectURL

function clearMediaUrls() {
  for (const url of activeMediaUrls.values()) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  activeMediaUrls.clear();
}

function buildCommentEl(c) {
  const el = document.createElement("div");
  el.className = "comment";
  el.innerHTML = `
    <div class="comment__user">@${escapeHtml(c.user)}</div>
    <div class="comment__text">${escapeHtml(c.text)}</div>
    <div class="comment__time">${fmtTime(c.createdAt)}</div>
  `;
  return el;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

async function renderPost(post) {
  const node = els.postTpl.content.firstElementChild.cloneNode(true);

  const authorEl = $(".post__author", node);
  const timeEl = $(".post__time", node);
  const descEl = $(".post__desc", node);
  const mediaEl = $(".post__media", node);
  const likeBtn = $(".post__likeBtn", node);
  const likeCount = $(".post__likeCount", node);

  authorEl.textContent = `@${post.author}`;
  timeEl.textContent = fmtTime(post.createdAt);
  descEl.textContent = post.description || "";

  // Like state
  const username = getSession();
  const liked = username ? post.likes.includes(username) : false;
  likeBtn.classList.toggle("btn-primary", liked);
  likeCount.textContent = String(post.likes.length);

  likeBtn.addEventListener("click", () => {
    try {
      toggleLike(post.id);
      renderFeed(); // MVP: перерендер всей ленты
    } catch (e) {
      toast(e.message || "Ошибка");
      showModal("authModal", true);
      setAuthMode("login");
    }
  });

  // Comments
  const commentForm = $(".post__commentForm", node);
  const commentInput = $(".post__commentInput", node);
  const commentsBox = $(".post__comments", node);

  commentInput.disabled = !username;
  commentInput.placeholder = username ? "Написать комментарий..." : "Войди, чтобы комментировать";

  commentForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    try {
      addComment(post.id, commentInput.value);
      commentInput.value = "";
      renderFeed();
    } catch (e) {
      toast(e.message || "Ошибка");
      showModal("authModal", true);
      setAuthMode("login");
    }
  });

  // render comments
  commentsBox.innerHTML = "";
  for (const c of (post.comments || []).slice(0, 12)) {
    commentsBox.appendChild(buildCommentEl(c));
  }
  if ((post.comments || []).length > 12) {
    const more = document.createElement("div");
    more.style.opacity = ".6";
    more.style.fontSize = "12px";
    more.textContent = "Показаны первые 12 комментариев…";
    commentsBox.appendChild(more);
  }

  // Media
  const media = await idbGetMedia(post.mediaId);
  if (!media) {
    mediaEl.innerHTML = `<div style="padding:14px; color:rgba(229,231,235,.65)">Медиа не найдено (возможно, данные браузера очищены).</div>`;
  } else {
    const url = URL.createObjectURL(media.blob);
    activeMediaUrls.set(post.id, url);

    if (post.mediaType === "video") {
      const video = document.createElement("video");
      video.controls = true;
      video.src = url;
      mediaEl.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.alt = "post";
      img.src = url;
      mediaEl.appendChild(img);
    }
  }

  return node;
}

async function renderFeed() {
  clearMediaUrls();
  els.feedList.innerHTML = "";

  const q = (els.searchInput.value || "").trim().toLowerCase();
  const posts = getPosts()
    .slice()
    .sort((a,b) => b.createdAt - a.createdAt)
    .filter(p => {
      if (!q) return true;
      return (p.description || "").toLowerCase().includes(q) || (p.author || "").toLowerCase().includes(q);
    });

  els.emptyState.hidden = posts.length !== 0;

  // Sequential render (простота)
  for (const p of posts) {
    const node = await renderPost(p);
    els.feedList.appendChild(node);
  }
}

/* --------------------------
   Events
--------------------------- */
function wireUi() {
  // Open auth
  const openAuth = () => { showModal("authModal", true); setAuthMode("login"); };
  els.openAuthBtn.addEventListener("click", openAuth);
  els.heroAuthBtn.addEventListener("click", openAuth);

  // New post
  els.newPostBtn.addEventListener("click", () => {
    if (!getSession()) { openAuth(); return; }
    showModal("postModal", true);
  });

  // Logout
  els.logoutBtn.addEventListener("click", logout);

  // Close modals
  $$("[data-close]").forEach(el => {
    el.addEventListener("click", (e) => {
      const id = e.currentTarget.getAttribute("data-close");
      showModal(id, false);
    });
  });

  // Tabs
  els.tabLogin.addEventListener("click", () => setAuthMode("login"));
  els.tabRegister.addEventListener("click", () => setAuthMode("register"));

  // Login
  els.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await login(els.loginUsername.value, els.loginPassword.value);
      showModal("authModal", false);
      refreshTopbar();
      renderFeed();
    } catch (err) {
      toast(err.message || "Ошибка входа");
    }
  });

  // Register
  els.registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await register(els.regUsername.value, els.regPassword.value);
      showModal("authModal", false);
      refreshTopbar();
      renderFeed();
    } catch (err) {
      toast(err.message || "Ошибка регистрации");
    }
  });

  // Post create
  els.postForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = els.postFile.files?.[0];
    const desc = els.postDesc.value;
    try {
      await createPost(file, desc);
      els.postForm.reset();
      showModal("postModal", false);
      renderFeed();
    } catch (err) {
      toast(err.message || "Ошибка публикации");
    }
  });

  // Refresh
  els.refreshBtn.addEventListener("click", () => renderFeed());
  els.heroRefreshBtn.addEventListener("click", () => renderFeed());

  // Search (debounce lite)
  let t = null;
  els.searchInput.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => renderFeed(), 150);
  });

  // Brand click -> top
  els.brand.addEventListener("click", (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Escape closes modals
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!els.authModal.hidden) showModal("authModal", false);
      if (!els.postModal.hidden) showModal("postModal", false);
    }
  });
}

/* --------------------------
   Init
--------------------------- */
async function init() {
  refreshTopbar();
  wireUi();

  // Ensure DB exists
  try { await openDb(); } catch {}

  await renderFeed();
}

init();
