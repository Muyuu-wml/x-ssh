import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";

import {
  GetProfile,
  SaveHost,
  DeleteHost,
  ReorderHosts,
  SaveGroup,
  DeleteGroup,
  ReorderGroups,
  OpenSession,
  WriteSession,
  ResizeSession,
  CloseSession,
  SampleSystem,
  SftpOpen,
  SftpHome,
  SftpList,
  SftpParent,
  SftpMkdir,
  SftpRemove,
  SftpRename,
  SftpReadTextFile,
  SftpReadLog,
  SftpTailLog,
  SftpChmod,
  SftpWriteTextFile,
  SftpUpload,
  SftpDownload,
  SftpCancelTask,
  SftpRetryTask,
  SftpClearTasks,
  SftpClose,
  LocalHome,
  LocalDrives,
  LocalList,
  LocalParent,
  LocalMkdir,
  LocalRemove,
  LocalRename,
  PickLocalFile,
  PickLocalDirectory,
  ImportPrivateKeyFile,
  GetAppInfo,
  ListKnownHosts,
  ForgetHostKey,
  TrustHostKey,
  ExportHosts,
  ImportHosts,
  ReadBackupFile,
} from "../wailsjs/go/main/App";
import {
  EventsOn,
  WindowMinimise,
  WindowToggleMaximise,
  WindowIsMaximised,
  WindowSetSize,
  WindowCenter,
  ClipboardGetText,
  ClipboardSetText,
  Quit,
} from "../wailsjs/runtime/runtime";
import { icon, mountIcons } from "./icons";
import { distroIcon } from "./distros";
import { mountCodeEditor } from "./editor";
import { themes, loadAppearance, saveAppearance, applyAppearance, normalizeAppearance } from "./appearance";

/* ================================================================== helpers */

const $ = (sel) => document.querySelector(sel);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function bytesToB64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function humanSize(bytes) {
  if (bytes === null || bytes === undefined || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${u === 0 ? n : n.toFixed(n < 10 ? 1 : 0)} ${units[u]}`;
}

/** Reads a design token from style.css so nothing is duplicated in JS. */
function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function cssPx(name, fallback) {
  const n = parseInt(cssVar(name, ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Builds the xterm palette from the design tokens.
 *
 * Transparent canvas reveals the workspace background without fading glyphs.
 * Semantic ANSI colours follow the selected theme, including its light variant.
 */
function terminalTheme() {
  return {
    background: "#00000000",
    foreground: cssVar("--text", "#e5e7eb"),
    cursor: cssVar("--primary-hi", "#60a5fa"),
    selectionBackground: cssVar("--term-selection", "rgba(107, 176, 255, 0.3)"),
    black: cssVar("--term-black", "#17191d"),
    red: cssVar("--danger", "#ef4444"),
    green: cssVar("--success", "#10b981"),
    yellow: cssVar("--warning", "#f59e0b"),
    blue: cssVar("--primary", "#3b82f6"),
    magenta: cssVar("--term-magenta", "#cba6f7"),
    cyan: cssVar("--term-cyan", "#89dceb"),
    white: cssVar("--text", "#e5e7eb"),
    brightBlack: cssVar("--text-faint", "#7f8798"),
    brightRed: cssVar("--danger", "#ff7b7b"),
    brightGreen: cssVar("--success", "#34d399"),
    brightYellow: cssVar("--warning", "#fbbf24"),
    brightBlue: cssVar("--primary-hi", "#60a5fa"),
    brightMagenta: cssVar("--term-magenta", "#cba6f7"),
    brightCyan: cssVar("--term-cyan", "#89dceb"),
    brightWhite: cssVar("--text", "#eceef2"),
  };
}

/* --------------------------------------------------- terminal font size */

const TERM_FONT_KEY = "xssh:termFontSize";
const TERM_FONT_MIN = 9;
const TERM_FONT_MAX = 28;

/** 字号按用户习惯记在本机；存坏了就退回设计稿的正文大小。 */
function loadTermFontSize() {
  const saved = Number(localStorage.getItem(TERM_FONT_KEY));
  if (Number.isFinite(saved) && saved >= TERM_FONT_MIN && saved <= TERM_FONT_MAX) return saved;
  return cssPx("--fs-md", 14);
}

/**
 * 改所有终端标签的字号并重新适配行列。
 * 终端只有 FitAddon 重新算过 cols/rows 之后，远端才会按新宽度换行。
 */
function setTermFontSize(size) {
  const next = Math.min(TERM_FONT_MAX, Math.max(TERM_FONT_MIN, Math.round(size)));
  if (next === state.termFontSize) return;
  state.termFontSize = next;
  try {
    localStorage.setItem(TERM_FONT_KEY, String(next));
  } catch {
    // 存不下就只在本次运行内生效
  }
  for (const tab of state.tabs) {
    if (tab.kind !== "terminal" || !tab.term) continue;
    tab.term.options.fontSize = next;
    tab.fit?.fit();
  }
}

function toast(message, kind = "info", ms = 4200) {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  $("#toasts").appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transition = "opacity .2s";
    setTimeout(() => node.remove(), 220);
  }, ms);
}

function fail(err, prefix = "") {
  const text = err && err.message ? err.message : String(err);
  toast(prefix ? `${prefix}：${text}` : text, "error", 7000);
}

/** Promise based confirmation dialog. */
function confirmDialog({ title, message, confirmLabel = "确认", danger = true }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" style="width:420px">
        <div class="modal-head">${esc(title)}</div>
        <div class="modal-body"><div>${esc(message)}</div></div>
        <div class="modal-foot">
          <button class="btn" data-act="cancel">取消</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    const close = (value) => {
      backdrop.remove();
      resolve(value);
    };
    backdrop.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "ok") close(true);
      else if (act === "cancel" || e.target === backdrop) close(false);
    });
    $("#modal-root").appendChild(backdrop);
  });
}

/** Single line prompt dialog. */
function promptDialog({ title, label, value = "", confirmLabel = "保存" }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" style="width:420px">
        <div class="modal-head">${esc(title)}</div>
        <div class="modal-body">
          <div class="field"><label>${esc(label)}</label>
            <input type="text" id="prompt-input" value="${esc(value)}" />
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn" data-act="cancel">取消</button>
          <button class="btn btn-primary" data-act="ok">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    const input = backdrop.querySelector("#prompt-input");
    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };
    backdrop.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "ok") close(input.value.trim());
      else if (act === "cancel" || e.target === backdrop) close(null);
    });
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Enter") close(input.value.trim());
      if (e.key === "Escape") close(null);
    });
    $("#modal-root").appendChild(backdrop);
    input.focus();
    input.select();
  });
}

/* ------------------------------------------------------- host key trust */

const UNKNOWN_HOSTKEY = "UNKNOWN_HOSTKEY|";

/** Parses the marker error raised when a host has no approved fingerprint. */
function parseUnknownHostKey(err) {
  const text = err && err.message ? err.message : String(err ?? "");
  const idx = text.indexOf(UNKNOWN_HOSTKEY);
  if (idx < 0) return null;
  const [hostport, fingerprint, algorithm] = text.slice(idx + UNKNOWN_HOSTKEY.length).split("|");
  if (!hostport || !fingerprint) return null;
  return { hostport, fingerprint, algorithm: algorithm || "" };
}

/** First-connect fingerprint confirmation. Resolves true when trusted. */
function confirmHostKey({ hostport, fingerprint, algorithm }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" style="width:480px">
        <div class="modal-head">首次连接：确认主机身份</div>
        <div class="modal-body">
          <p style="margin:0 0 10px">首次连接 <strong>${esc(hostport)}</strong>，请核对服务器指纹后再继续：</p>
          <div class="field"><label>密钥类型</label><code>${esc(algorithm || "未知")}</code></div>
          <div class="field"><label>指纹 (SHA256)</label><code style="word-break:break-all">${esc(fingerprint)}</code></div>
          <p class="dim" style="margin:10px 0 0;font-size:var(--fs-xs);color:var(--text-dim)">
            可在服务器上执行 <code>ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub</code> 比对。
            指纹不一致说明连接可能被劫持，请勿信任。信任后指纹将被固定，之后指纹变化会拒绝连接。
          </p>
        </div>
        <div class="modal-foot">
          <button class="btn" data-act="cancel">取消</button>
          <button class="btn btn-primary" data-act="ok">信任并连接</button>
        </div>
      </div>`;
    const close = (value) => {
      backdrop.remove();
      resolve(value);
    };
    backdrop.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "ok") close(true);
      else if (act === "cancel" || e.target === backdrop) close(false);
    });
    $("#modal-root").appendChild(backdrop);
  });
}

/**
 * Runs open() and, when it fails because the host key is not approved yet,
 * asks the user. Trusting pins the exact fingerprint shown, then retries once.
 */
async function withHostKeyConfirm(open) {
  try {
    return await open();
  } catch (err) {
    const info = parseUnknownHostKey(err);
    if (!info) throw err;
    const trusted = await confirmHostKey(info);
    if (!trusted) throw new Error("已取消连接：未信任该主机。");
    await TrustHostKey(info.hostport, info.fingerprint);
    return open();
  }
}

/* ==================================================================== state */
const state = {
  profile: { groups: [], hosts: [] },
  tabs: [],
  transfers: new Map(), // task id -> latest sftp:task snapshot
  activeTabId: null,
  selectedHostId: null,
  appearance: loadAppearance(),
  localStart: "", // init() 里读，避免在 localStorage key 声明前调用
  snippets: [],
  filter: "",
  termFontSize: loadTermFontSize(),
};

const activeTab = () => state.tabs.find((t) => t.id === state.activeTabId) || null;

let tabSeq = 0;
const nextTabId = () => `tab-${++tabSeq}`;

/* ------------------------------------------------- remote path memory */

// Remember where the user last browsed on each host. This is the fallback when
// the remote shell does not report its working directory via OSC 7.
const REMOTE_PATH_PREFIX = "xssh:lastRemotePath:";

function rememberedRemotePath(hostId) {
  if (!hostId) return "";
  try {
    return localStorage.getItem(REMOTE_PATH_PREFIX + hostId) || "";
  } catch {
    return "";
  }
}

function rememberRemotePath(hostId, path) {
  if (!hostId || !path) return;
  try {
    localStorage.setItem(REMOTE_PATH_PREFIX + hostId, path);
  } catch {
    // Storage can be disabled; the current tab still works without persistence.
  }
}

/* -------------------------------------------------------- remote bookmarks */

// 常用目录按主机分开存：同一台机器上的日志目录混进另一台没有意义。
const BOOKMARK_PREFIX = "xssh:bookmarks:";

function loadBookmarks(hostId) {
  if (!hostId) return [];
  try {
    const list = JSON.parse(localStorage.getItem(BOOKMARK_PREFIX + hostId) || "[]");
    return Array.isArray(list) ? list.filter((p) => typeof p === "string" && p.startsWith("/")) : [];
  } catch {
    return [];
  }
}

function saveBookmarks(hostId, list) {
  if (!hostId) return;
  try {
    localStorage.setItem(BOOKMARK_PREFIX + hostId, JSON.stringify(list));
  } catch {
    // 存不下就只在本次运行内生效
  }
}

/* ------------------------------------------------------ local start path */

// 本地文件面板打开时从哪儿开始。空 = 跟随系统（家目录所在的盘）。
const LOCAL_START_KEY = "xssh:localStartPath";

function loadLocalStart() {
  try {
    return localStorage.getItem(LOCAL_START_KEY) || "";
  } catch {
    return "";
  }
}

function saveLocalStart(path) {
  try {
    if (path) localStorage.setItem(LOCAL_START_KEY, path);
    else localStorage.removeItem(LOCAL_START_KEY);
  } catch {
    // 存不下就只在本次运行内生效，不影响功能
  }
}

/* -------------------------------------------------- backend event buffering */

// Output and state events can arrive before OpenSession() resolves and the tab
// learns its backend session id; "connecting" is emitted before the id exists at
// all. Buffer by id so a first screen or an immediate exit is not dropped.
const pendingEvents = new Map();
const MAX_PENDING_PER_SESSION = 200;
const MAX_PENDING_SESSIONS = 50;

function bufferEvent(id, entry) {
  const list = pendingEvents.get(id) || [];
  list.push(entry);
  if (list.length > MAX_PENDING_PER_SESSION) list.shift();
  pendingEvents.set(id, list);
  // Sessions that are never adopted must not accumulate forever.
  while (pendingEvents.size > MAX_PENDING_SESSIONS) {
    pendingEvents.delete(pendingEvents.keys().next().value);
  }
}

function takePending(id) {
  const list = pendingEvents.get(id);
  if (!list) return [];
  pendingEvents.delete(id);
  return list;
}

const tabForSession = (id) => state.tabs.find((t) => t.sessionId === id) || null;

/* =================================================================== sidebar */

function matchesHost(host) {
  const needle = state.filter.trim().toLowerCase();
  return !needle || [host.name, host.address, host.username, ...(host.tags || [])]
    .some((value) => (value || "").toLowerCase().includes(needle));
}

function orderedHostsInGroup(groupId) {
  return state.profile.hosts
    .filter((host) => (host.groupId || "") === groupId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function childGroups(parentId) {
  return state.profile.groups
    .filter((g) => (g.parentId || "") === parentId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

// 主机图标：已检测到发行版时显示品牌 logo，否则显示通用服务器图标。
function hostSymbol(host) {
  return distroIcon(host?.distro) || icon("server");
}

// 地址按代码 token 上色：用户名 / 主机 / 端口各一色，分隔符退到背景里。
function addressHTML(host) {
  return `<span class="addr-user">${esc(host.username)}</span><span class="addr-sep">@</span><span class="addr-host">${esc(host.address)}</span><span class="addr-sep">:</span><span class="addr-port">${esc(host.port)}</span>`;
}

/* ------------------------------------------------------------ 最近连接 */

/** 侧栏上半：开着的会话排前面，再补最近用过的，最多 6 台。 */
function recentHosts() {
  const seen = new Set();
  const ids = [];
  for (const tab of state.tabs) {
    if (!tab.hostId || tab.status === "closed" || seen.has(tab.hostId)) continue;
    seen.add(tab.hostId);
    ids.push(tab.hostId);
  }
  const recent = state.profile.hosts
    .filter((host) => host.lastUsedAt && !seen.has(host.id))
    .sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt));
  for (const host of recent) {
    if (ids.length >= 6) break;
    ids.push(host.id);
  }
  return ids.slice(0, 6).map((id) => state.profile.hosts.find((host) => host.id === id)).filter(Boolean);
}

function renderRecentHosts() {
  const box = $("#recent-hosts");
  if (!box) return;
  const hosts = recentHosts();
  box.innerHTML = hosts.length
    ? hosts
        .map((host) => {
          const live = state.tabs.some((tab) => tab.hostId === host.id && tab.status === "connected");
          return `<button class="side-host" type="button" data-recent="${esc(host.id)}" title="${esc(host.username)}@${esc(host.address)}:${host.port} · 打开终端">
            <span class="side-host-icon">${hostSymbol(host)}</span>
            <span class="side-host-text">
              <span class="side-host-name">${esc(host.name || host.address)}</span>
              <span class="side-host-addr">${esc(host.username)}@${esc(host.address)}</span>
            </span>
            <span class="side-host-dot ${live ? "is-live" : ""}"></span>
          </button>`;
        })
        .join("")
    : `<div class="side-empty">还没有连接记录<span>双击右侧主机即可开始</span></div>`;
}

/** 同一台主机已经开着终端就直接切过去，不再多挂一个会话。 */
function openHostSession(host) {
  const tab = state.tabs.find((t) => t.hostId === host.id && t.kind === "terminal" && t.status !== "closed");
  if (tab) return setActiveTab(tab.id);
  openTerminalTab(host);
}

/* ------------------------------------------------------------ 快捷指令 */

const SNIPPET_KEY = "xssh:snippets";

function loadSnippets() {
  try {
    const list = JSON.parse(localStorage.getItem(SNIPPET_KEY) || "[]");
    return Array.isArray(list) ? list.filter((item) => item?.id && item?.command) : [];
  } catch {
    return [];
  }
}

function saveSnippets() {
  try {
    localStorage.setItem(SNIPPET_KEY, JSON.stringify(state.snippets));
  } catch {
    // 存不下就只在本次运行内生效
  }
}

function renderSnippets() {
  const box = $("#snippets");
  if (!box) return;
  box.innerHTML = state.snippets.length
    ? state.snippets
        .map(
          (snippet) => `<div class="snippet" role="button" tabindex="0" data-snippet="${esc(snippet.id)}" title="${esc(snippet.command)}">
            <span class="snippet-main">
              <span class="snippet-name">${esc(snippet.name || snippet.command)}</span>
              <span class="snippet-cmd">${esc(snippet.command)}</span>
            </span>
            <span class="snippet-actions">
              <button class="icon-btn" data-act="edit-snippet" title="编辑">${icon("edit")}</button>
              <button class="icon-btn" data-act="del-snippet" title="删除">${icon("trash")}</button>
            </span>
          </div>`
        )
        .join("")
    : `<div class="side-empty">常用命令放这里<span>点右上角 + 添加，一键发送到当前终端</span></div>`;
}

function runSnippet(snippet) {
  const tab = activeTab();
  if (tab?.kind === "terminal" && tab.status === "connected" && tab.sessionId) {
    WriteSession(tab.sessionId, bytesToB64(new TextEncoder().encode(snippet.command + "\r"))).catch((err) =>
      fail(err, "发送指令失败")
    );
    tab.term?.focus();
    return;
  }
  toast("先打开一个终端会话，再执行快捷指令。", "info", 3000);
}

async function snippetEditor(snippet) {
  const editing = Boolean(snippet);
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:480px">
      <div class="modal-head">${editing ? "编辑快捷指令" : "新建快捷指令"}</div>
      <div class="modal-body">
        <div class="field"><label>名称</label>
          <input type="text" data-f="name" value="${esc(snippet?.name || "")}" placeholder="例如：查看程序目录" />
        </div>
        <div class="field"><label>命令</label>
          <input type="text" data-f="command" value="${esc(snippet?.command || "")}" placeholder="例如：cd /home/app && ls -al" />
          <div class="hint">发送时自动补一个回车，直接在终端里执行。</div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" data-act="cancel">取消</button>
        <button class="btn btn-primary" data-act="ok">保存</button>
      </div>
    </div>`;
  const nameInput = backdrop.querySelector('[data-f="name"]');
  const commandInput = backdrop.querySelector('[data-f="command"]');
  const submit = () => {
    const command = commandInput.value.trim();
    if (!command) return toast("命令不能为空。", "info", 2500);
    const item = {
      id: snippet?.id || `snip-${Date.now().toString(36)}`,
      name: nameInput.value.trim(),
      command,
    };
    const index = state.snippets.findIndex((entry) => entry.id === item.id);
    if (index >= 0) state.snippets[index] = item;
    else state.snippets.push(item);
    saveSnippets();
    renderSnippets();
    backdrop.remove();
  };
  backdrop.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "ok") submit();
    else if (act === "cancel" || e.target === backdrop) backdrop.remove();
  });
  backdrop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input")) submit();
    if (e.key === "Escape") backdrop.remove();
  });
  $("#modal-root").appendChild(backdrop);
  (editing ? commandInput : nameInput).focus();
}

async function deleteSnippet(snippet) {
  const ok = await confirmDialog({
    title: "删除快捷指令",
    message: `确定删除“${snippet.name || snippet.command}”？`,
    confirmLabel: "删除",
  });
  if (!ok) return;
  state.snippets = state.snippets.filter((entry) => entry.id !== snippet.id);
  saveSnippets();
  renderSnippets();
}

function renderSidebar() {
  renderRecentHosts();
  renderSnippets();
  renderDashboard();
}

function relativeTime(value) {
  if (!value) return "从未连接";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Math.max(0, Date.now() - then);
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`;
  return new Date(then).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function hostItemHTML(host) {
  const name = host.name || host.address;
  const live = state.tabs.some((tab) => tab.hostId === host.id && tab.status === "connected");
  const selected = state.selectedHostId === host.id;
  const tags = (host.tags || []).filter(Boolean);
  const shownTags = tags.slice(0, 2).map((tag) => `<span class="host-tag">${esc(tag)}</span>`).join("");
  const moreTags = tags.length > 2 ? `<span class="host-tag is-more">+${tags.length - 2}</span>` : "";
  const lastUsed = relativeTime(host.lastUsedAt);
  // 24 小时内用过的单独上色：在一列灰字里，最近的那几台一眼能挑出来
  const fresh = host.lastUsedAt && Date.now() - new Date(host.lastUsedAt).getTime() < 86400e3;
  const lastTitle = host.lastUsedAt
    ? new Date(host.lastUsedAt).toLocaleString("zh-CN")
    : "从未连接";

  return `<article class="host-item ${live ? "is-live" : ""} ${selected ? "selected" : ""}" data-host="${esc(host.id)}" data-sort-host="${esc(host.id)}" draggable="true" tabindex="0" aria-label="${esc(name)}，双击连接，拖动排序" title="双击连接 · 拖动排序">
    <span class="host-item-symbol">${hostSymbol(host)}</span>
    <span class="host-item-main">
      <span class="host-item-name" title="${esc(name)}">${esc(name)}${live ? '<span class="host-dot" title="已连接"></span>' : ""}</span>
    </span>
    <span class="host-item-address" title="${esc(host.username)}@${esc(host.address)}:${host.port}">${addressHTML(host)}</span>
    <span class="host-item-tags">${shownTags}${moreTags}</span>
    <span class="host-item-last ${fresh ? "is-recent" : ""}" title="${esc(lastTitle)}">${esc(lastUsed)}</span>
    <span class="host-item-actions">
      <button class="btn btn-sm host-connect" data-act="terminal" title="连接 ${esc(name)}" aria-label="连接 ${esc(name)}">连接</button>
      <button class="icon-btn" data-act="sftp" title="文件" aria-label="管理 ${esc(name)} 的文件">${icon("folder")}</button>
      <button class="icon-btn" data-act="edit" title="编辑" aria-label="编辑 ${esc(name)}">${icon("edit")}</button>
    </span>
  </article>`;
}

/* 页头四个概览格子：数量的变化比一整片表格更容易一眼扫到 */
function dashboardStatsHTML(hosts) {
  const groups = state.profile.groups.filter((group) => hosts.some((host) => host.groupId === group.id)).length;
  const live = state.tabs.filter((tab) => tab.kind === "terminal" && tab.status === "connected").length;
  const recent = hosts.filter(
    (host) => host.lastUsedAt && Date.now() - new Date(host.lastUsedAt).getTime() < 7 * 86400e3
  ).length;
  const tiles = [
    { tone: "primary", icon: "server", label: "主机", value: hosts.length },
    { tone: "violet", icon: "layers", label: "分组", value: groups },
    { tone: "mint", icon: "terminal", label: "活动会话", value: live },
    { tone: "amber", icon: "refresh", label: "近 7 天用过", value: recent },
  ];
  return tiles
    .map(
      (tile) => `<div class="stat-card" data-tone="${tile.tone}">
      <span class="stat-icon">${icon(tile.icon)}</span>
      <span class="stat-text"><span class="stat-value">${tile.value}</span><span class="stat-label">${tile.label}</span></span>
    </div>`
    )
    .join("");
}

function renderDashboard() {
  const hosts = state.profile.hosts.filter(matchesHost);
  const grouped = new Map();
  for (const host of hosts) {
    const id = host.groupId || "";
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(host);
  }
  const sections = [];
  const tones = ["primary", "violet", "mint", "amber"];
  // 一台主机都没打标签时，整列标签就是纯空白，不如让地址和时间更靠左一步
  const hasTags = hosts.some((host) => (host.tags || []).length);
  const addSection = (id, name) => {
    const members = (grouped.get(id) || []).sort((a, b) => (a.order || 0) - (b.order || 0));
    // 搜索时只留有命中的分组；平时空分组也保留，否则没有地方重命名/删除它
    if (!members.length && (!id || state.filter)) return;
    // 分组色点、行图标、标签共用同一个 --tone，扫一眼就能把行和分组对上
    const tone = tones[sections.length % tones.length];
    sections.push(`<section class="host-group" data-tone="${tone}" aria-label="${esc(name)}">
      <div class="host-group-heading" ${id ? `data-sort-group="${esc(id)}" draggable="true" title="拖动调整同级分组顺序"` : ""}>
        <h3 title="${esc(name)}">${esc(name)}</h3>
        <span class="count">${members.length} 台</span>
        ${
          id
            ? `<span class="host-group-actions">
          <button class="icon-btn" type="button" data-act="edit-group" data-group="${esc(id)}" title="重命名分组">${icon("edit")}</button>
          <button class="icon-btn" type="button" data-act="del-group" data-group="${esc(id)}" title="删除分组">${icon("close")}</button>
        </span>`
            : ""
        }
      </div>
      <div class="host-list">${
        members.length ? members.map(hostItemHTML).join("") : `<div class="host-empty">该分组还没有主机</div>`
      }</div>
    </section>`);
  };
  const visitGroups = (parentId, path = []) => {
    const groups = childGroups(parentId);
    for (const group of groups) {
      const names = [...path, group.name];
      addSection(group.id, names.join(" / "));
      visitGroups(group.id, names);
    }
  };
  visitGroups("");
  addSection("", "未分组");
  $("#dashboard-stats").innerHTML = dashboardStatsHTML(hosts);
  const showTable = hosts.length > 0 || (!state.filter && state.profile.groups.length > 0);
  $("#host-grid").innerHTML = showTable ? `<div class="host-table ${hasTags ? "" : "no-tags"}">
    <div class="host-table-head" aria-hidden="true">
      <span>主机</span><span>地址</span>${hasTags ? "<span>标签</span>" : ""}<span>最近连接</span><span>操作</span>
    </div>
    ${sections.join("")}
  </div>` : `<div class="onboarding">
    <span>${state.filter ? "没有匹配的主机" : "还没有主机"}</span>
    <button class="btn btn-sm" data-act="${state.filter ? "clear-search" : "new-host"}">${icon(state.filter ? "close" : "plus")}${state.filter ? "清空搜索" : "新建主机"}</button>
  </div>`;
}

/* ================================================================ tab strip */

function tabStatusClass(tab) {
  if (tab.error) return "error";
  if (tab.status === "closed") return tab.kind === "sftp" ? "error" : "closed";
  if (tab.status === "connected") return "connected";
  return "connecting";
}

function tabStatusLabel(tab) {
  return { connecting: "连接中", connected: "已连接", closed: "已关闭", error: "连接异常" }[tabStatusClass(tab)];
}

function renderTabstrip() {
  const strip = $("#tabstrip");
  strip.innerHTML = state.tabs
    .map((tab) => {
      const statusClass = tabStatusClass(tab);
      return `
      <div class="tab ${tab.id === state.activeTabId ? "active" : ""}" tabindex="0" data-tab="${esc(tab.id)}" data-kind="${esc(tab.kind)}" title="${esc(tab.title)} · ${tabStatusLabel(tab)}">
        <span class="tab-status ${statusClass}"></span>
        <span class="tab-title">${esc(tab.title)}</span>
        <span class="tab-kind" title="${tab.kind === "sftp" ? "SFTP 文件" : "SSH 终端"}">${icon(tab.kind === "sftp" ? "folder" : "terminal")}</span>
        <button class="tab-close" data-act="close" aria-label="关闭 ${esc(tab.title)}">${icon("close")}</button>
      </div>`;
    })
    .join("");

  $("#session-bar").classList.toggle("hidden", state.tabs.length === 0);
  const current = activeTab();
  $("#empty").classList.toggle("hidden", Boolean(current));
  $("#panes").classList.toggle("hidden", !current);
  $("#btn-back").hidden = !current;
  $("#workspace-title").textContent = current ? current.title : "主机管理";
  // 主机页的数量已经由概览卡承担，这里再报一遍只会重复，改成说明性文案
  $("#workspace-context").textContent = current
    ? `${current.kind === "sftp" ? "文件传输" : "SSH 终端"} / ${tabStatusLabel(current)}`
    : "本地工作区 · 双击主机直接连接";
  const connected = state.tabs.filter((tab) => tab.status === "connected").length;
  $("#session-chip-text").textContent = state.tabs.length
    ? `${connected} / ${state.tabs.length} 会话`
    : "暂无活动会话";
  $("#session-chip").classList.toggle("is-live", connected > 0);
  updatePaneBadges();
}

/** 面板顶条上的状态徽章要跟会话状态一起变。 */
function updatePaneBadges() {
  for (const tab of state.tabs) {
    const badge = tab.paneEl?.querySelector("[data-status-badge]");
    if (!badge) continue;
    badge.className = `pane-badge is-${tabStatusClass(tab)}`;
    const text = badge.querySelector("[data-status-text]");
    if (text) text.textContent = tabStatusLabel(tab);
  }
}

function setActiveTab(id) {
  state.activeTabId = id;
  for (const tab of state.tabs) {
    tab.paneEl?.classList.toggle("hidden", tab.id !== id);
  }
  // 只给可见的终端采样，后台标签的定时器停掉。
  for (const tab of state.tabs) {
    if (tab.kind !== "terminal" || !tab.monitor) continue;
    if (tab.id === id) {
      if (tab.monitor.open) startMonitor(tab);
    } else {
      pauseMonitor(tab);
    }
  }
  renderTabstrip();
  renderSidebar();
  const tab = activeTab();
  if (tab?.kind === "terminal") {
    requestAnimationFrame(() => {
      tab.fit?.fit();
      tab.term?.focus();
      if (tab.term && tab.term.cols && tab.term.rows) {
        ResizeSession(tab.sessionId, tab.term.cols, tab.term.rows).catch(() => {});
      }
    });
  }
}

function closeTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  // Mark first: an OpenSession that is still in flight must release its
  // connection instead of attaching it to a tab the user already closed.
  tab.disposed = true;
  if (tab.kind === "terminal" && tab.sessionId) {
    CloseSession(tab.sessionId).catch(() => {});
  } else if (tab.kind === "sftp" && tab.sessionId) {
    SftpClose(tab.sessionId).catch(() => {});
  }
  // 终端标签页点文件时按需开的 SFTP 通道，关标签时一并释放。
  if (tab.editorSessionId) SftpClose(tab.editorSessionId).catch(() => {});
  if (tab.monitor) stopMonitor(tab);
  tab.term?.dispose();
  tab.paneEl?.remove();
  state.tabs = state.tabs.filter((t) => t.id !== id);
  if (state.activeTabId === id) {
    state.activeTabId = state.tabs.length ? state.tabs[state.tabs.length - 1].id : null;
  }
  setActiveTab(state.activeTabId);
}

/* ==================================================================== ssh */

async function writeClipboard(text) {
  try {
    if (await ClipboardSetText(text)) return;
  } catch (_) {
    // The browser fallback keeps clipboard actions usable during frontend dev.
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("系统剪贴板不可用");
}

async function readClipboard() {
  try {
    const text = await ClipboardGetText();
    if (typeof text === "string") return text;
  } catch (_) {
    // The browser fallback keeps clipboard actions usable during frontend dev.
  }
  if (navigator.clipboard?.readText) return navigator.clipboard.readText();
  throw new Error("系统剪贴板不可用");
}

function copyTerminalSelection(tab) {
  const text = tab.term?.getSelection() || "";
  if (!text) return false;
  writeClipboard(text)
    .then(() => toast("已复制到剪贴板", "success", 2200))
    .catch((err) => fail(err, "复制失败"));
  return true;
}

function pasteTerminalClipboard(tab) {
  readClipboard()
    .then((text) => {
      if (!tab.disposed && text) tab.term?.paste(text);
    })
    .catch((err) => fail(err, "粘贴失败"));
}

/* ================================================================ monitor */

// 采样间隔与曲线保留点数：2 秒一次，保留约 1 分半的趋势。
const MONITOR_INTERVAL = 2000;
const MONITOR_POINTS = 45;

function monitorState(tab) {
  if (!tab.monitor) {
    tab.monitor = {
      open: false,
      timer: null,
      busy: false,
      stats: null,
      error: "",
      fails: 0,
      cpu: [],
      rx: [],
      tx: [],
    };
  }
  return tab.monitor;
}

function fmtBytes(bytes, digits = 1) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : digits)} ${units[i]}`;
}

function fmtUptime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${mins} 分`;
  return `${mins} 分`;
}

function pushPoint(list, value) {
  list.push(Number(value) || 0);
  while (list.length > MONITOR_POINTS) list.shift();
}

/** 折线 + 面积，坐标压缩到 viewBox，实际尺寸交给 CSS。 */
function sparkChart(values, max, cls) {
  const w = 100;
  const h = 30;
  const top = h - 2;
  const list = values.length === 1 ? [values[0], values[0]] : values;
  if (!list.length) return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}"></svg>`;
  const ceiling = Math.max(1, Number(max) || 1);
  const step = list.length > 1 ? w / (list.length - 1) : w;
  const y = (v) => top - Math.min(1, Math.max(0, v / ceiling)) * (top - 4) + 2;
  const points = list.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`);
  const line = `M${points.join("L")}`;
  return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <path class="spark-area" d="${line}L${w},${h}L0,${h}Z"/>
      <path class="spark-line" d="${line}" vector-effect="non-scaling-stroke"/>
    </svg>`;
}

function donutChart(parts, caption, note) {
  const size = 104;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0) || 1;
  let offset = 0;
  const segments = parts
    .filter((part) => part.value > 0)
    .map((part) => {
      const length = (part.value / total) * circumference;
      const segment = `<circle class="donut-seg ${part.cls}" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke-width="${stroke}" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
      offset += length;
      return segment;
    })
    .join("");
  return `<div class="donut-wrap">
      <svg class="donut" viewBox="0 0 ${size} ${size}" aria-hidden="true">${segments}</svg>
      <div class="donut-center"><b>${caption}</b><span>${note}</span></div>
    </div>`;
}

function renderMonitor(tab) {
  const box = tab.paneEl?.querySelector("[data-monitor-body]");
  if (!box) return;
  const m = monitorState(tab);

  if (m.error) {
    box.innerHTML = `<div class="mon-empty">${esc(m.error)}</div>`;
    return;
  }
  const s = m.stats;
  if (!s) {
    box.innerHTML = `<div class="mon-empty">正在采样…</div>`;
    return;
  }

  const memPct = s.memTotal ? (s.memUsed / s.memTotal) * 100 : 0;
  const memCache = Math.min(s.memCache, s.memTotal);
  const memApp = Math.max(0, s.memTotal - s.memFree - memCache);
  const memIdle = Math.max(0, s.memTotal - memApp - memCache);
  const netMax = Math.max(1024, ...m.rx, ...m.tx);

  const diskRows = (s.disks || [])
    .map((disk) => {
      const pct = disk.total ? (disk.used / disk.total) * 100 : 0;
      const level = pct >= 95 ? "is-danger" : pct >= 85 ? "is-warning" : "is-normal";
      return `<div class="disk-row">
        <div class="disk-top"><span class="disk-mount">${esc(disk.mount)}</span><span class="disk-num">${fmtBytes(disk.used)} / ${fmtBytes(disk.total)}</span></div>
        <div class="disk-bar"><span class="disk-fill ${level}" style="width:${pct.toFixed(1)}%"></span></div>
        <div class="disk-foot"><span>${pct.toFixed(0)}% 已用</span><span>剩余 ${fmtBytes(disk.free)}</span></div>
      </div>`;
    })
    .join("");

  box.innerHTML = `
    <section class="mon-card">
      <header class="mon-head"><span class="mon-title">系统</span></header>
      <div class="mon-os">${esc(s.os || "未知系统")}</div>
      <div class="mon-kv">
        <span>内核</span><b>${esc(s.kernel || "—")}</b>
        <span>架构</span><b>${esc(s.arch || "—")}</b>
        <span>主机</span><b>${esc(s.hostname || "—")}</b>
        <span>运行</span><b>${fmtUptime(s.uptime)}</b>
      </div>
    </section>
    <section class="mon-card">
      <header class="mon-head"><span class="mon-title">CPU</span><span class="mon-value">${s.cpu.toFixed(0)}<i>%</i></span></header>
      ${sparkChart(m.cpu, 100, "is-cpu")}
      <div class="mon-foot"><span>${s.cpus || "?"} 核</span><span>负载 ${s.load1.toFixed(2)} / ${s.load5.toFixed(2)} / ${s.load15.toFixed(2)}</span></div>
    </section>
    <section class="mon-card">
      <header class="mon-head"><span class="mon-title">内存</span><span class="mon-value">${memPct.toFixed(0)}<i>%</i></span></header>
      <div class="mon-split">
        ${donutChart(
          [
            { value: memApp, cls: "is-mem" },
            { value: memCache, cls: "is-cache" },
            { value: memIdle, cls: "is-idle" },
          ],
          fmtBytes(s.memUsed),
          `共 ${fmtBytes(s.memTotal)}`,
        )}
        <div class="mon-legend">
          <span><i class="dot is-mem"></i>应用 ${fmtBytes(memApp)}</span>
          <span><i class="dot is-cache"></i>缓存 ${fmtBytes(memCache)}</span>
          <span><i class="dot is-idle"></i>空闲 ${fmtBytes(memIdle)}</span>
        </div>
      </div>
      ${s.swapTotal > 0 ? `<div class="mon-foot"><span>交换分区</span><span>${fmtBytes(s.swapUsed)} / ${fmtBytes(s.swapTotal)}</span></div>` : ""}
    </section>
    <section class="mon-card">
      <header class="mon-head"><span class="mon-title">磁盘</span></header>
      ${diskRows || `<div class="mon-empty">未检测到挂载点</div>`}
    </section>
    <section class="mon-card">
      <header class="mon-head"><span class="mon-title">网络</span></header>
      <div class="net-row"><span class="net-label is-rx">↓</span><b>${fmtBytes(s.netRxRate)}/s</b><span class="net-total">共 ${fmtBytes(s.netRxTotal)}</span></div>
      ${sparkChart(m.rx, netMax, "is-rx")}
      <div class="net-row"><span class="net-label is-tx">↑</span><b>${fmtBytes(s.netTxRate)}/s</b><span class="net-total">共 ${fmtBytes(s.netTxTotal)}</span></div>
      ${sparkChart(m.tx, netMax, "is-tx")}
    </section>`;
}

async function pollMonitor(tab) {
  const m = monitorState(tab);
  if (!m.open || m.busy || tab.disposed) return;
  if (!tab.sessionId || tab.status === "closed") return;
  m.busy = true;
  try {
    const stats = await SampleSystem(tab.sessionId);
    if (tab.disposed || !m.open) return;
    m.stats = stats;
    m.error = "";
    m.fails = 0;
    pushPoint(m.cpu, stats.cpu);
    pushPoint(m.rx, stats.netRxRate);
    pushPoint(m.tx, stats.netTxRate);
  } catch (err) {
    m.fails += 1;
    if (m.fails >= 3) m.error = `采样失败：${err?.message || err}`;
  } finally {
    m.busy = false;
    if (!tab.disposed) renderMonitor(tab);
  }
}

function startMonitor(tab) {
  const m = monitorState(tab);
  if (m.timer) return;
  m.open = true;
  m.fails = 0;
  m.error = "";
  pollMonitor(tab);
  m.timer = setInterval(() => pollMonitor(tab), MONITOR_INTERVAL);
}

function stopMonitor(tab) {
  const m = monitorState(tab);
  m.open = false;
  if (m.timer) {
    clearInterval(m.timer);
    m.timer = null;
  }
}

/** 切走标签时只停定时器，保留用户的开关状态。 */
function pauseMonitor(tab) {
  const m = tab.monitor;
  if (!m?.timer) return;
  clearInterval(m.timer);
  m.timer = null;
}

function toggleMonitor(tab) {
  const m = monitorState(tab);
  const panel = tab.paneEl?.querySelector("[data-monitor]");
  const button = tab.paneEl?.querySelector('[data-act="toggle-monitor"]');
  if (!panel) return;

  if (m.open) {
    stopMonitor(tab);
  } else {
    startMonitor(tab);
  }
  panel.classList.toggle("hidden", !m.open);
  button?.classList.toggle("is-on", m.open);
  renderMonitor(tab);
  // 面板占掉宽度后终端列数变了，重新 fit 一次。
  requestAnimationFrame(() => tab.fit?.fit());
}

/**
 * Extracts the path from an OSC 7 payload ("file://host/path"). Shells emit this
 * when cwd integration is enabled; it is the only reliable way to learn the
 * working directory of an interactive shell over SSH.
 */
function osc7Cwd(data) {
  const match = /^file:\/\/[^/]*(\/.*)$/.exec(String(data || ""));
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * 打开文件管理时用哪个目录。
 *
 * 首选 OSC 7（准确）；绝大多数服务器默认没开，所以再从提示符兜一层：
 * 只认"光标那一行整行就是提示符"的情况（没在输入命令），
 * 形如 root@host:/home/x# 或 user@host:~$（bash 的 \w、zsh 的 %~ 都是这个形状）。
 * 读不到的（比如 [root@host ~]# 这种只有目录名的）就交给上一次浏览的目录。
 */
function shellCwd(tab) {
  if (tab.cwd) return tab.cwd;
  const buffer = tab.term?.buffer?.active;
  if (!buffer) return "";
  // 提示符很长时会折行，先从光标行往回把折行部分接起来再匹配
  const end = buffer.baseY + buffer.cursorY;
  let start = end;
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  let line = "";
  for (let i = start; i <= end; i++) line += buffer.getLine(i)?.translateToString(true) ?? "";
  const match = /^[^\s@]+@[^\s:]+:(.+?)[#$%>]\s*$/.exec(line);
  const path = match?.[1]?.trim() || "";
  // 相对路径 / 只有一个目录名时没法定位，宁可退回首页
  return path === "/" || path.startsWith("~") || path.startsWith("/") ? path : "";
}

/**
 * 终端里的文件链接。
 *
 * 只把"带已知扩展名的 token"变成链接（扩展名沿用文件列表那张表），
 * 目录、版本号、命令参数不会被误伤；路径/文件名都按当前提示符目录解析。
 * 行内的全角字符占两格，所以先把字符串下标映射回单元格列，链接下划线才不会错位。
 */
let terminalFileRe = null;

function terminalFileLinks(term, y, open) {
  const line = term.buffer.active.getLine(y - 1);
  if (!line) return undefined;
  if (!terminalFileRe) {
    const exts = [...fileKinds.code, ...fileKinds.config, ...fileKinds.doc];
    const name = "[\\p{L}\\p{N}._@%+\\-]";
    terminalFileRe = new RegExp(
      `(?:~\\/|\\.{1,2}\\/|\\/)?(?:${name}+\\/)*${name}+\\.(?:${exts.join("|")})\\b`,
      "giu"
    );
  }

  let text = "";
  const columns = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell) break;
    if (cell.getWidth() === 0) continue;
    const chars = cell.getChars() || " ";
    for (let i = 0; i < chars.length; i++) columns.push(x + 1);
    text += chars;
  }

  const links = [];
  for (const match of text.matchAll(terminalFileRe)) {
    const start = match.index;
    const end = start + match[0].length - 1;
    if (!columns[start] || !columns[end] || insideUrl(text, start)) continue;
    links.push({
      range: { start: { x: columns[start], y }, end: { x: columns[end], y } },
      text: match[0],
      decorations: { pointerCursor: true, underline: true },
      activate: () => open(match[0]),
    });
  }
  return links.length ? links : undefined;
}

/** 匹配词落在 URL 里时不当文件处理（网页链接交给 WebLinksAddon）。 */
function insideUrl(text, index) {
  let start = index;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  return text.slice(start, index).includes("://");
}

/** 编辑器用的 SFTP 通道：SFTP 标签页现成，终端标签页第一次点文件时按需开一条并缓存。 */
async function editorSession(tab) {
  if (tab.kind === "sftp") {
    if (!tab.sessionId) throw new Error("SFTP 尚未连接。");
    return tab.sessionId;
  }
  if (tab.editorSessionId) return tab.editorSessionId;
  if (tab.editorSessionPending) return tab.editorSessionPending;
  const host = state.profile.hosts.find((h) => h.id === tab.hostId);
  if (!host) throw new Error("主机不存在。");
  tab.editorSessionPending = withHostKeyConfirm(() => SftpOpen(host.id))
    .then((sessionId) => {
      tab.editorSessionId = sessionId;
      return sessionId;
    })
    .finally(() => {
      tab.editorSessionPending = null;
    });
  return tab.editorSessionPending;
}

/** 把终端里的相对路径按提示符目录拼成绝对路径；定位不到返回空串。 */
async function resolveTerminalPath(tab, raw, sessionId) {
  if (raw.startsWith("~/")) {
    try {
      return (await SftpHome(sessionId)) + raw.slice(1);
    } catch {
      return "";
    }
  }
  if (raw.startsWith("/")) return raw;
  let cwd = tab.cwd || shellCwd(tab);
  if (!cwd) return "";
  if (cwd.startsWith("~")) {
    try {
      cwd = (await SftpHome(sessionId)) + cwd.slice(1);
    } catch {
      return "";
    }
  }
  if (!cwd.startsWith("/")) return "";
  const parts = [];
  for (const part of `${cwd}/${raw}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

async function openTerminalFile(tab, raw) {
  // 双击会触发两次 click；首次读取还没回来时忽略重复请求，免得叠两个编辑器。
  if (tab.editorBusy) return;
  tab.editorBusy = true;
  try {
    let sessionId;
    try {
      sessionId = await editorSession(tab);
    } catch (err) {
      return fail(err, "连接 SFTP 失败");
    }
    const path = await resolveTerminalPath(tab, raw, sessionId);
    if (!path) return toast("读不到当前目录，无法定位这个文件。", "info", 4000);
    await openRemoteFile(tab, { name: path.slice(path.lastIndexOf("/") + 1) || path, path, isDir: false });
  } finally {
    tab.editorBusy = false;
  }
}

function openTerminalTab(host) {
  const tab = {
    id: nextTabId(),
    kind: "terminal",
    hostId: host.id,
    title: host.name || host.address,
    status: "connecting",
    error: "",
    disposed: false,
    cwd: "",
  };

  const pane = document.createElement("div");
  pane.className = "pane hidden";
  pane.innerHTML = `
    <div class="pane-bar">
      <span class="pane-bar-icon">${hostSymbol(host)}</span>
      <span class="pane-bar-title">${esc(host.name || host.address)}</span>
      <span class="pane-bar-meta">${addressHTML(host)}</span>
      <span class="spacer"></span>
      <span class="pane-badge is-connecting" data-status-badge><span class="status-dot"></span><span data-status-text>连接中</span></span>
      <button class="btn btn-sm btn-files" data-act="toggle-monitor" title="系统监控">${icon("monitor")}监控</button>
      <button class="btn btn-sm btn-files" data-act="open-sftp" title="打开文件管理（优先当前目录）">${icon("folder")}文件</button>
    </div>
    <div class="term-banner" data-banner style="display:none"></div>
    <div class="term-split">
      <div class="term-host">
        <div class="term-find" data-find hidden>
          <input class="term-find-input" data-find-input spellcheck="false" autocomplete="off"
            placeholder="在终端中查找" aria-label="在终端中查找" />
          <span class="term-find-count" data-find-count></span>
          <button class="icon-btn" data-act="find-prev" title="上一个（Shift+Enter）" aria-label="上一个匹配">${icon("up")}</button>
          <button class="icon-btn" data-act="find-next" title="下一个（Enter）" aria-label="下一个匹配">${icon("down")}</button>
          <button class="icon-btn" data-act="find-close" title="关闭（Esc）" aria-label="关闭查找">${icon("close")}</button>
        </div>
        <div class="term-fit" data-termhost></div>
      </div>
      <aside class="monitor hidden" data-monitor>
        <div class="monitor-head">
          <span class="monitor-title">${icon("monitor")}系统监控</span>
          <button class="icon-btn" data-act="close-monitor" title="收起监控" aria-label="收起监控">${icon("chevron")}</button>
        </div>
        <div class="monitor-body" data-monitor-body></div>
      </aside>
    </div>`;
  $("#panes").appendChild(pane);
  tab.paneEl = pane;

  pane.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "open-sftp") openSftpTab(host, { remotePath: shellCwd(tab) });
    else if (act === "toggle-monitor" || act === "close-monitor") toggleMonitor(tab);
    else if (act === "find-prev") runTermFind(-1);
    else if (act === "find-next") runTermFind(1);
    else if (act === "find-close") closeTermFind();
  });

  const term = new Terminal({
    fontFamily: cssVar("--mono", 'Consolas, "Microsoft YaHei UI", monospace'),
    fontSize: state.termFontSize,
    lineHeight: 1.2,
    cursorBlink: true,
    allowProposedApi: true,
    allowTransparency: true,
    scrollback: 10000,
    theme: terminalTheme(),
  });
  term.attachCustomKeyEventHandler((event) => {
    if (event.type === "keydown") {
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && key === "c" && term.hasSelection()) {
        copyTerminalSelection(tab);
        return false;
      }
      if (modifier && key === "v") {
        // Prevent the browser's native paste event from running as well.
        // Otherwise the clipboard would be sent to the remote shell twice.
        event.preventDefault();
        pasteTerminalClipboard(tab);
        return false;
      }
      if (event.shiftKey && key === "insert") {
        event.preventDefault();
        pasteTerminalClipboard(tab);
        return false;
      }
      if (modifier && event.shiftKey && key === "h") {
        // 交给全局快捷键处理，不要把控制字符发给远端 shell。
        event.preventDefault();
        return false;
      }
      if (modifier && (key === "=" || key === "+")) {
        // 和浏览器一致：Ctrl+= 放大，Ctrl+- 缩小，Ctrl+0 复位。
        event.preventDefault();
        setTermFontSize(state.termFontSize + 1);
        return false;
      }
      if (modifier && key === "-") {
        event.preventDefault();
        setTermFontSize(state.termFontSize - 1);
        return false;
      }
      if (modifier && key === "0") {
        event.preventDefault();
        setTermFontSize(cssPx("--fs-md", 14));
        return false;
      }
    }
    // Workspace shortcuts must not also send control characters to the shell.
    return !(event.ctrlKey || event.metaKey) || !["f", "k", "w"].includes(event.key.toLowerCase());
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  const search = new SearchAddon();
  term.loadAddon(search);
  // 终端输出里的文件名（如 ll 列表）单击就能用内置编辑器打开。
  term.registerLinkProvider({
    provideLinks: (y, callback) => callback(terminalFileLinks(term, y, (raw) => openTerminalFile(tab, raw))),
  });
  term.open(pane.querySelector("[data-termhost]"));
  tab.term = term;
  tab.fit = fit;

  /* ----------------------------------------------------- terminal search */
  const findBar = pane.querySelector("[data-find]");
  const findInput = pane.querySelector("[data-find-input]");
  const findCount = pane.querySelector("[data-find-count]");

  search.onDidChangeResults(({ resultIndex, resultCount }) => {
    findCount.textContent = resultCount ? `${resultIndex < 0 ? 1 : resultIndex + 1}/${resultCount}` : "无结果";
    findCount.classList.toggle("is-empty", !resultCount);
  });

  function runTermFind(step) {
    const text = findInput.value;
    if (!text) {
      search.clearDecorations();
      findCount.textContent = "";
      return;
    }
    // incremental 只在 findNext 生效：打字时扩展当前命中，不会一路跳到下一个词。
    const options = { caseSensitive: false, incremental: step > 0 };
    if (step > 0) search.findNext(text, options);
    else search.findPrevious(text, options);
  }

  function openTermFind() {
    findBar.hidden = false;
    findInput.focus();
    findInput.select();
    runTermFind(1);
  }

  function closeTermFind() {
    findBar.hidden = true;
    search.clearDecorations();
    findCount.textContent = "";
    term.focus();
  }

  tab.openFind = openTermFind;

  findInput.addEventListener("input", () => runTermFind(1));
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runTermFind(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeTermFind();
    }
  });

  // Ctrl+滚轮缩放字号，和浏览器里把网页放大是同一套手势。
  pane.querySelector(".term-host").addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setTermFontSize(state.termFontSize + (e.deltaY < 0 ? 1 : -1));
    },
    { passive: false }
  );

  // Progressive enhancement: use the shell's real cwd if it supports OSC 7.
  // Otherwise openSftpTab falls back to the last directory browsed on this host.
  term.parser.registerOscHandler(7, (data) => {
    const cwd = osc7Cwd(data);
    if (cwd) tab.cwd = cwd;
    return true;
  });

  state.tabs.push(tab);
  setActiveTab(tab.id);

  requestAnimationFrame(() => {
    fit.fit();
    withHostKeyConfirm(() => OpenSession(host.id, term.cols, term.rows))
      .then((info) => {
        if (tab.disposed) {
          // The tab was closed while the connection was still being made.
          CloseSession(info.id).catch(() => {});
          return;
        }
        attachSession(tab, info.id);
        if (tab.status !== "closed") {
          tab.status = info.status === "connected" ? "connected" : "connecting";
          if (info.status === "connected") scrollPastBanner(tab);
        }
        renderTabstrip();
      })
      .catch((err) => {
        if (tab.disposed) return;
        tab.status = "closed";
        tab.error = err?.message ? err.message : String(err);
        showBanner(tab, tab.error);
        renderTabstrip();
      });
  });

  term.onData((data) => {
    if (!tab.sessionId) return;
    WriteSession(tab.sessionId, bytesToB64(new TextEncoder().encode(data))).catch(() => {});
  });

  term.onResize(({ cols, rows }) => {
    if (!tab.sessionId) return;
    ResizeSession(tab.sessionId, cols, rows).catch(() => {});
  });

  return tab;
}

/** The banner shows an error (or a neutral note) above the terminal. */
function showBanner(tab, message, kind = "error") {
  const banner = tab.paneEl.querySelector("[data-banner]");
  if (!banner) return;
  banner.style.display = "flex";
  banner.className = `term-banner${kind ? ` ${kind}` : ""}`;
  banner.innerHTML = `<span>${esc(message)}</span><button class="btn btn-sm" data-act="retry">重新连接</button>`;
  banner.querySelector('[data-act="retry"]').addEventListener("click", () => {
    const host = state.profile.hosts.find((h) => h.id === tab.hostId);
    if (!host) return;
    tab.error = "";
    tab.status = "connecting";
    tab.disposed = false;
    // Reconnecting replaces the banner in place, so a second click cannot open
    // a parallel session for the same tab.
    banner.className = "term-banner";
    banner.innerHTML = `<span>正在重新连接…</span>`;
    renderTabstrip();
    withHostKeyConfirm(() => OpenSession(host.id, tab.term.cols, tab.term.rows))
      .then((info) => {
        if (tab.disposed) {
          CloseSession(info.id).catch(() => {});
          return;
        }
        attachSession(tab, info.id);
        if (tab.status !== "closed") tab.status = "connected";
        renderTabstrip();
      })
      .catch((err) => {
        if (tab.disposed) return;
        tab.status = "closed";
        tab.error = err?.message ? err.message : String(err);
        showBanner(tab, tab.error);
        renderTabstrip();
      });
  });
}

function scrollPastBanner(tab) {
  const banner = tab.paneEl.querySelector("[data-banner]");
  if (banner) banner.style.display = "none";
}

/** Writes one chunk of terminal output. */
function writeOutput(tab, payload) {
  if (!tab?.term) return;
  tab.term.write(b64ToBytes(payload.data));
}

/** Applies one ssh:state event to a tab that owns the session. */
function applyState(tab, info) {
  if (!tab) return;
  if (info.status === "connected") {
    tab.sessionId = info.id;
    tab.status = "connected";
    scrollPastBanner(tab);
  } else if (info.status === "closed") {
    tab.sessionId = info.id;
    tab.status = "closed";
    if (info.error) {
      tab.error = info.error;
      showBanner(tab, info.error);
    } else {
      // A clean exit still deserves a visible state and a way back in.
      showBanner(tab, "会话已关闭。", "");
    }
    tab.term?.write(`\r\n\x1b[38;5;245m— 会话已关闭${info.error ? `：${info.error}` : ""} —\x1b[0m\r\n`);
  }
  renderTabstrip();
  renderRecentHosts();
}

/**
 * Records the backend session id on a tab and replays anything that arrived
 * before the id was known, so the first screen and a fast exit are preserved.
 */
function attachSession(tab, id) {
  if (!tab) return;
  tab.sessionId = id;
  for (const entry of takePending(id)) {
    if (entry.type === "data") writeOutput(tab, entry.payload);
    else applyState(tab, entry.payload);
  }
  // 监控面板可能在连接建立前就被打开了，这里补一次采样。
  if (tab.monitor?.open) pollMonitor(tab);
}

/* =================================================================== sftp */

function openSftpTab(host, options = {}) {
  const preferredRemotePath = options.remotePath || rememberedRemotePath(host.id);
  const tab = {
    id: nextTabId(),
    kind: "sftp",
    hostId: host.id,
    title: host.name || host.address,
    status: "connecting",
    error: "",
    disposed: false,
    localPath: "",
    localDrives: [],
    remotePath: preferredRemotePath,
    localEntries: [],
    remoteEntries: [],
    localSel: null,
    remoteSel: null,
    localError: "",
    remoteError: "",
    bookmarks: loadBookmarks(host.id),
  };

  const pane = document.createElement("div");
  pane.className = "pane hidden";
  pane.innerHTML = `
    <div class="pane-bar">
      <span class="pane-bar-icon">${hostSymbol(host)}</span>
      <span class="pane-bar-title">${esc(host.name || host.address)}</span>
      <span class="pane-bar-meta">${addressHTML(host)}</span>
      <span class="spacer"></span>
      <span class="pane-badge is-connecting" data-status-badge><span class="status-dot"></span><span data-status-text>连接中</span></span>
      <button class="btn btn-sm btn-primary" data-act="upload" title="上传选中项到远端">${icon("upload")}上传</button>
      <button class="btn btn-sm btn-files" data-act="download" title="下载选中项到本地">${icon("download")}下载</button>
    </div>
    <div class="sftp-body">
      <section class="sftp-pane" data-side="local">
        <div class="sftp-side-label">${icon("monitor")} 本地文件 <select data-drives aria-label="选择本地磁盘"><option>读取磁盘…</option></select></div>
        <div class="sftp-pane-head">
          <button class="icon-btn" data-act="up" title="上一级目录">${icon("up")}</button>
          <button class="icon-btn" data-act="refresh" title="刷新">${icon("refresh")}</button>
          <input class="sftp-path" data-path spellcheck="false" aria-label="本地路径" />
          <button class="icon-btn" data-act="mkdir" title="新建文件夹">${icon("folderPlus")}</button>
          <button class="icon-btn" data-act="rename" title="重命名">${icon("edit")}</button>
          <button class="icon-btn" data-act="delete" title="删除">${icon("trash")}</button>
        </div>
        <div class="sftp-columns"><span>名称</span><span class="c-mode">权限</span><span class="c-size">大小</span><span class="c-date">修改时间</span></div>
        <div class="file-list" data-list></div>
      </section>
      <section class="sftp-pane" data-side="remote">
        <div class="sftp-side-label">${icon("server")} 远程文件
          <select class="sftp-bookmarks" data-bookmarks aria-label="目录书签" title="常用目录书签"></select>
          <span>${esc(host.name || host.address)}</span>
        </div>
        <div class="sftp-pane-head">
          <button class="icon-btn" data-act="up" title="上一级目录">${icon("up")}</button>
          <button class="icon-btn" data-act="refresh" title="刷新">${icon("refresh")}</button>
          <input class="sftp-path" data-path spellcheck="false" aria-label="远程路径" />
          <button class="icon-btn" data-act="star" title="收藏 / 取消收藏当前目录">${icon("star")}</button>
          <button class="icon-btn" data-act="chmod" title="修改选中项的权限">${icon("lock")}</button>
          <button class="icon-btn" data-act="mkdir" title="新建文件夹">${icon("folderPlus")}</button>
          <button class="icon-btn" data-act="rename" title="重命名">${icon("file")}</button>
          <button class="icon-btn" data-act="edit" title="编辑文本文件">${icon("edit")}</button>
          <button class="icon-btn" data-act="delete" title="删除">${icon("trash")}</button>
        </div>
        <div class="sftp-columns"><span>名称</span><span class="c-mode">权限</span><span class="c-size">大小</span><span class="c-date">修改时间</span></div>
        <div class="file-list" data-list></div>
      </section>
    </div>`;
  $("#panes").appendChild(pane);
  tab.paneEl = pane;

  state.tabs.push(tab);
  setActiveTab(tab.id);

  wireSftpPane(tab, "local");
  wireSftpPane(tab, "remote");

  // Local pane starts at the directory picked in settings, otherwise at the
  // drive the user's home lives on; the dropdown still exposes every drive.
  Promise.all([LocalHome(), LocalDrives()])
    .then(([home, drives]) => {
      tab.localDrives = drives || [];
      tab.localPath = state.localStart || defaultLocalDir(home, tab.localDrives);
      renderDriveSelect(tab);
      return refreshSide(tab, "local").then(() => {
        if (tab.disposed || !tab.localError) return;
        // 设置的目录可能被删掉或换了盘，退回系统默认，别让面板停在错误上
        tab.localPath = defaultLocalDir(home, tab.localDrives);
        tab.localError = "";
        renderDriveSelect(tab);
        return refreshSide(tab, "local");
      });
    })
    .catch((err) => fail(err, "读取本地文件失败"));

  withHostKeyConfirm(() => SftpOpen(host.id))
    .then((sessionId) => {
      if (tab.disposed) {
        SftpClose(sessionId).catch(() => {});
        return null;
      }
      tab.sessionId = sessionId;
      tab.status = "connected";
      renderTabstrip();
      return SftpHome(sessionId);
    })
    .then((home) => {
      if (home === null) return null;
      return openRemoteStart(tab, home);
    })
    .catch((err) => {
      if (tab.disposed) return;
      tab.status = "closed";
      tab.remoteError = err?.message ? err.message : String(err);
      renderFileList(tab, "remote");
      renderTabstrip();
      fail(err, "SFTP");
    });

  pane.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "upload") doUpload(tab);
    if (act === "download") doDownload(tab);
  });

  return tab;
}

/**
 * Opens the remote pane at the preferred path (terminal cwd or last visit).
 * A remembered directory can be deleted between sessions, so fall back to the
 * login directory instead of leaving the pane stuck on an error.
 */
async function openRemoteStart(tab, home) {
  // 提示符里读到的是 ~/xxx，SFTP 不认 ~，换成真实的登录目录
  const preferred = tab.remotePath?.startsWith("~")
    ? home + tab.remotePath.slice(1)
    : tab.remotePath;
  tab.remotePath = preferred || home;
  await refreshSide(tab, "remote");

  if (tab.disposed || !preferred || preferred === home || !tab.remoteError) return;
  tab.remotePath = home;
  tab.remoteError = "";
  await refreshSide(tab, "remote");
}

function wireSftpPane(tab, side) {
  const pane = tab.paneEl.querySelector(`[data-side="${side}"]`);
  const pathInput = pane.querySelector("[data-path]");
  const list = pane.querySelector("[data-list]");
  const drives = pane.querySelector("[data-drives]");
  const bookmarks = pane.querySelector("[data-bookmarks]");

  drives?.addEventListener("change", (e) => {
    if (side === "local" && e.target.value) navigate(tab, side, e.target.value);
  });

  bookmarks?.addEventListener("change", (e) => {
    const target = e.target.value;
    if (target) navigate(tab, side, target).then(() => renderBookmarks(tab));
  });

  pathInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    navigate(tab, side, e.target.value.trim());
    e.target.blur();
  });

  pane.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const current = tab[`${side}Path`];
    const sel = tab[`${side}Sel`];
    switch (act) {
      case "up":
        parentOf(tab, side, current);
        break;
      case "refresh":
        refreshSide(tab, side);
        break;
      case "star":
        toggleBookmark(tab, current);
        break;
      case "chmod":
        if (!sel) return toast("请先选择要修改权限的文件或文件夹。", "info", 2500);
        chmodPrompt(tab, sel);
        break;
      case "mkdir":
        mkdirPrompt(tab, side, current);
        break;
      case "rename":
        if (!sel) return toast("请先选择要重命名的文件或文件夹。", "info", 2500);
        renamePrompt(tab, side, sel);
        break;
      case "edit":
        if (side !== "remote") return toast("只能编辑远程文件，本地文件请用系统编辑器打开。", "info", 3000);
        if (!sel) return toast("请先选择要编辑的文件。", "info", 2500);
        if (sel.isDir) return toast("文件夹不能编辑。", "info", 2500);
        openRemoteFile(tab, sel);
        break;
      case "delete":
        if (!sel) return toast("请先选择要删除的文件或文件夹。", "info", 2500);
        deleteConfirm(tab, side, sel);
        break;
    }
  });

  list.addEventListener("click", (e) => {
    const row = e.target.closest("[data-name]");
    if (!row) {
      selectFile(null);
      return;
    }
    const entry = tab[`${side}Entries`].find((x) => x.name === row.dataset.name);
    if (!entry) return;
    if (e.target.closest("[data-open-dir]")) {
      if (e.detail <= 1) navigate(tab, side, entry.path);
      return;
    }
    // 文件名就是"打开"入口：目录单击进目录，远程文件单击开内置编辑器，
    // 和双击整行、工具栏的编辑按钮是同一个动作。行内其它位置单击仍然是选中。
    if (e.target.closest("[data-open-file]")) {
      selectFile(entry);
      if (side === "remote" && !entry.isDir && e.detail <= 1) openRemoteFile(tab, entry);
      return;
    }
    selectFile(entry);
  });

  list.addEventListener("dblclick", (e) => {
    if (e.target.closest("[data-open-dir], [data-open-file]")) return;
    const row = e.target.closest("[data-name]");
    if (!row) return;
    const entry = tab[`${side}Entries`].find((x) => x.name === row.dataset.name);
    if (entry?.isDir) navigate(tab, side, entry.path);
    // Double-click a remote file opens the built-in editor; that is the common
    // "fix this config" path and saves a download/edit/upload round trip.
    else if (entry && side === "remote") openRemoteFile(tab, entry);
  });

  list.addEventListener("keydown", (e) => {
    if (e.key === "Delete") {
      // Use the pane's selection rather than the focused row: a click focuses
      // the row, but the directory name is a button, so the two can differ.
      const selected = tab[`${side}Sel`];
      if (!selected || e.repeat) return;
      e.preventDefault();
      deleteConfirm(tab, side, selected);
      return;
    }

    if (!e.target.matches(".file-row")) return;
    if (!["Enter", " "].includes(e.key)) return;
    e.preventDefault();
    if (e.repeat) return;
    const entry = tab[`${side}Entries`].find((x) => x.name === e.target.dataset.name);
    if (!entry) return;
    if (e.key === "Enter" && entry.isDir) navigate(tab, side, entry.path);
    else if (e.key === "Enter" && side === "remote" && !entry.isDir) openRemoteFile(tab, entry);
    else selectFile(entry);
  });

  list.addEventListener("dragstart", (e) => {
    const row = e.target.closest("[data-name]");
    if (!row) return;
    const entry = tab[`${side}Entries`].find((x) => x.name === row.dataset.name);
    if (!entry) return;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-xssh-entry", JSON.stringify({ side, entry }));
    e.dataTransfer.setData("text/plain", entry.path);
    row.classList.add("dragging");
  });

  list.addEventListener("dragend", (e) => {
    e.target.closest("[data-name]")?.classList.remove("dragging");
    list.classList.remove("drop-target");
  });

  list.addEventListener("dragover", (e) => {
    if (!Array.from(e.dataTransfer.types).includes("application/x-xssh-entry")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    list.classList.add("drop-target");
  });

  list.addEventListener("dragleave", (e) => {
    if (!list.contains(e.relatedTarget)) list.classList.remove("drop-target");
  });

  list.addEventListener("drop", (e) => {
    e.preventDefault();
    list.classList.remove("drop-target");
    const raw = e.dataTransfer.getData("application/x-xssh-entry");
    if (!raw) return;
    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    if (!payload?.entry || payload.side === side) return;
    if (payload.side === "local" && side === "remote") doUpload(tab, payload.entry);
    if (payload.side === "remote" && side === "local") doDownload(tab, payload.entry);
  });

  function selectFile(entry) {
    tab[`${side}Sel`] = entry || null;
    // Keep the nodes intact between clicks so native dblclick still fires.
    for (const row of list.querySelectorAll(".file-row")) {
      row.classList.toggle("selected", row.dataset.name === entry?.name);
    }
  }
}

async function navigate(tab, side, target) {
  if (!target || tab.disposed || (side === "remote" && !tab.sessionId)) return;
  const request = (tab[`${side}Request`] || 0) + 1;
  tab[`${side}Request`] = request;
  try {
    const entries = await (side === "local" ? LocalList(target) : SftpList(tab.sessionId, target));
    if (tab.disposed || tab[`${side}Request`] !== request) return;
    tab[`${side}Entries`] = entries;
    tab[`${side}Path`] = target;
    if (side === "remote") rememberRemotePath(tab.hostId, target);
    tab[`${side}Sel`] = null;
    tab[`${side}Error`] = "";
  } catch (err) {
    if (tab.disposed || tab[`${side}Request`] !== request) return;
    tab[`${side}Error`] = err?.message ? err.message : String(err);
  }
  renderFileList(tab, side);
}

function renderDriveSelect(tab) {
  const select = tab.paneEl?.querySelector('[data-drives]');
  if (!select) return;
  const current = tab.localPath || "";
  select.innerHTML = tab.localDrives.length
    ? tab.localDrives.map((drive) => `<option value="${esc(drive)}">${esc(drive)}</option>`).join("")
    : `<option value="">无可用磁盘</option>`;
  const selected = tab.localDrives.find((drive) => current.toLowerCase().startsWith(drive.toLowerCase()));
  if (selected) select.value = selected;
}

/** 家目录所在的盘（用户文件大多在那儿），没有就第一块盘。 */
function defaultLocalDir(home, drives) {
  return drives.find((root) => home.toLowerCase().startsWith(root.toLowerCase())) || drives[0] || home;
}

async function refreshSide(tab, side) {
  if (side === "remote" && !tab.sessionId) return;
  const target = tab[`${side}Path`] || (await (side === "local" ? LocalHome() : SftpHome(tab.sessionId)));
  await navigate(tab, side, target);
}

// Coalesces directory refreshes. A folder upload reports one "done" per file,
// and re-listing the destination on every one competes with the remaining
// transfers for the same SFTP channel.
const refreshTimers = new Map();

function scheduleRefresh(tab, side) {
  const key = `${tab.id}:${side}`;
  clearTimeout(refreshTimers.get(key));
  refreshTimers.set(
    key,
    setTimeout(() => {
      refreshTimers.delete(key);
      refreshSide(tab, side).catch(() => {});
    }, 250)
  );
}

async function parentOf(tab, side, current) {
  try {
    if (side === "remote" && !tab.sessionId) return;
    const parent = await (side === "local" ? LocalParent(current) : SftpParent(tab.sessionId, current));
    await navigate(tab, side, parent);
  } catch (err) {
    fail(err, "打开上级目录失败");
  }
}

// File icon colours by extension group. Kept as a lookup rather than one CSS
// rule per extension so new types are a one-line change.
const fileKinds = {
  code: ["js", "mjs", "cjs", "ts", "tsx", "jsx", "go", "php", "py", "rb", "java", "kt", "c", "h", "cpp", "hpp", "cs", "rs", "swift", "sh", "bash", "zsh", "fish", "ps1", "lua", "sql", "pl", "vue", "svelte"],
  config: ["json", "yml", "yaml", "ini", "conf", "cnf", "toml", "env", "properties", "xml", "service", "cfg", "lock"],
  doc: ["md", "markdown", "txt", "rst", "log", "csv"],
  archive: ["zip", "gz", "tgz", "tar", "rar", "7z", "xz", "bz2", "zst", "iso"],
  media: ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "mp4", "mkv", "mp3", "wav", "flac", "webm"],
};

function fileKindClass(name) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  const ext = name.slice(dot + 1).toLowerCase();
  for (const [kind, list] of Object.entries(fileKinds)) {
    if (list.includes(ext)) return `ext-${kind}`;
  }
  return "";
}

function renderFileList(tab, side) {
  const pane = tab.paneEl.querySelector(`[data-side="${side}"]`);
  const list = pane.querySelector("[data-list]");
  const pathInput = pane.querySelector("[data-path]");
  const entries = tab[`${side}Entries`];
  const current = tab[`${side}Path`];
  const error = tab[`${side}Error`];

  if (pathInput.value !== current) pathInput.value = current;
  if (side === "local") renderDriveSelect(tab);
  else renderBookmarks(tab);

  if (error) {
    list.innerHTML = `<div class="file-list-empty">${esc(error)}</div>`;
    return;
  }
  if (!entries.length) {
    list.innerHTML = `<div class="file-list-empty">文件夹为空</div>`;
    return;
  }

  const selected = tab[`${side}Sel`]?.name;
  list.innerHTML = entries
    .map(
      (entry) => `
        <div class="file-row ${entry.name === selected ? "selected" : ""}" data-name="${esc(entry.name)}" draggable="true" tabindex="0" title="${entry.isDir ? "单击名称或双击此行打开；拖到另一侧传输" : side === "remote" ? "单击名称或双击此行打开编辑；拖到另一侧传输" : "拖到另一侧传输"}；单击选中">
        <span class="file-icon ${entry.isDir ? "is-directory" : fileKindClass(entry.name)}">${icon(entry.isDir ? "folder" : "file")}</span>
        ${entry.isDir
          ? `<button class="file-name directory-open" data-open-dir title="打开 ${esc(entry.name)}" aria-label="打开目录 ${esc(entry.name)}">${esc(entry.name)}</button>`
          : side === "remote"
            ? `<button class="file-name file-open" data-open-file title="单击打开编辑 ${esc(entry.name)}" aria-label="编辑文件 ${esc(entry.name)}">${esc(entry.name)}</button>`
            : `<span class="file-name" title="${esc(entry.name)}">${esc(entry.name)}</span>`}
        <span class="file-mode" title="${esc(entry.mode || "")}">${esc(entry.mode || "")}</span>
        <span class="file-size">${entry.isDir ? "" : humanSize(entry.size)}</span>
        <span class="file-date">${esc(entry.modTime)}</span>
      </div>`
    )
    .join("");
}

/** 书签下拉：当前目录在列表里就选中，星标跟着亮，一眼看出收没收藏。 */
function renderBookmarks(tab) {
  const pane = tab.paneEl?.querySelector('[data-side="remote"]');
  const select = pane?.querySelector("[data-bookmarks]");
  if (!select) return;
  const current = tab.remotePath || "";
  const saved = tab.bookmarks.includes(current);
  select.innerHTML = [
    `<option value="">书签…</option>`,
    ...tab.bookmarks.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`),
  ].join("");
  select.value = saved ? current : "";
  const star = pane.querySelector('[data-act="star"]');
  star?.classList.toggle("is-on", saved);
  star?.setAttribute("title", saved ? "取消收藏当前目录" : "收藏当前目录");
}

function toggleBookmark(tab, current) {
  if (!current) return;
  tab.bookmarks = tab.bookmarks.includes(current)
    ? tab.bookmarks.filter((item) => item !== current)
    : [...tab.bookmarks, current].sort((a, b) => a.localeCompare(b));
  saveBookmarks(tab.hostId, tab.bookmarks);
  renderBookmarks(tab);
}

/** 从 `-rwxr-xr-x` 反推八进制，作为权限输入框的默认值。 */
function octalFromMode(mode) {
  const text = String(mode || "");
  if (text.length < 10) return "";
  const perms = text.slice(1, 10);
  let digits = "";
  for (let group = 0; group < 3; group++) {
    const [read, write, exec] = perms.slice(group * 3, group * 3 + 3);
    digits += String((read === "r" ? 4 : 0) + (write === "w" ? 2 : 0) + (/[xst]/.test(exec) ? 1 : 0));
  }
  // setuid / setgid / sticky 是第四位，普通 chmod 很少用，但不该被丢掉
  const special =
    (/[sS]/.test(perms[2]) ? 4 : 0) + (/[sS]/.test(perms[5]) ? 2 : 0) + (/[tT]/.test(perms[8]) ? 1 : 0);
  return special ? `${special}${digits}` : digits;
}

async function chmodPrompt(tab, entry) {
  if (!tab.sessionId) return toast("SFTP 尚未连接。", "error");
  const input = await promptDialog({
    title: "修改权限",
    label: `“${entry.name}”的权限（八进制，如 644 / 755）`,
    value: octalFromMode(entry.mode) || (entry.isDir ? "755" : "644"),
    confirmLabel: "应用",
  });
  if (!input) return;
  if (!/^[0-7]{3,4}$/.test(input)) return toast("权限要写成八进制，3 位或 4 位，如 644、0755。", "error", 3200);
  try {
    await SftpChmod(tab.sessionId, entry.path, input);
    toast(`“${entry.name}”权限已改为 ${input}`, "success", 2400);
    await refreshSide(tab, "remote");
  } catch (err) {
    fail(err, "修改权限失败");
  }
}

async function mkdirPrompt(tab, side, current) {
  const name = await promptDialog({ title: "新建文件夹", label: "文件夹名称", value: "新建文件夹", confirmLabel: "创建" });
  if (!name) return;
  try {
    if (side === "local") await LocalMkdir(`${current}/${name}`);
    else await SftpMkdir(tab.sessionId, `${current}/${name}`);
    await refreshSide(tab, side);
  } catch (err) {
    fail(err, "创建文件夹失败");
  }
}

async function renamePrompt(tab, side, entry) {
  const name = await promptDialog({ title: "重命名", label: "新名称", value: entry.name });
  if (!name || name === entry.name) return;
  const sep = entry.path.includes("/") ? "/" : "\\";
  const parent = entry.path.slice(0, entry.path.lastIndexOf(sep));
  try {
    if (side === "local") await LocalRename(entry.path, `${parent}${sep}${name}`);
    else await SftpRename(tab.sessionId, entry.path, `${parent}/${name}`);
    tab[`${side}Sel`] = null;
    await refreshSide(tab, side);
  } catch (err) {
    fail(err, "重命名失败");
  }
}

async function deleteConfirm(tab, side, entry) {
  const ok = await confirmDialog({
    title: "删除确认",
    message: `确定删除“${entry.name}”${entry.isDir ? "及其全部内容" : ""}？`,
    confirmLabel: "删除",
  });
  if (!ok) return;
  try {
    if (side === "local") await LocalRemove(entry.path);
    else await SftpRemove(tab.sessionId, entry.path, true);
    tab[`${side}Sel`] = null;
    await refreshSide(tab, side);
  } catch (err) {
    fail(err, "删除失败");
  }
}

/**
 * Built-in remote text editor.
 *
 * Loads the file over SFTP, edits it in a CodeMirror view with syntax
 * highlighting, and writes it back with Ctrl+S. Closing with unsaved changes
 * asks first, so a stray Escape cannot throw away an edited config.
 */
async function openTextEditor(tab, entry) {
  let sessionId;
  try {
    sessionId = await editorSession(tab);
  } catch (err) {
    return fail(err, "SFTP 尚未连接");
  }

  let content;
  try {
    content = await SftpReadTextFile(sessionId, entry.path);
  } catch (err) {
    return fail(err, `无法打开 ${entry.name}`);
  }

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal editor-modal">
      <div class="modal-head">
        <span class="modal-title">${icon("file")}<span>${esc(entry.name)}</span></span>
        <span class="editor-path" title="${esc(entry.path)}">${esc(entry.path)}</span>
        <button class="icon-btn" data-act="close" title="关闭" aria-label="关闭">${icon("close")}</button>
      </div>
      <div class="editor-host" data-editor></div>
      <div class="modal-foot">
        <span class="editor-status" data-status></span>
        <span class="spacer"></span>
        <button class="btn" data-act="cancel">取消</button>
        <button class="btn btn-primary" data-act="save">保存</button>
      </div>
    </div>`;

  const host = backdrop.querySelector("[data-editor]");
  const status = backdrop.querySelector("[data-status]");
  const saveBtn = backdrop.querySelector('[data-act="save"]');
  const cancelBtn = backdrop.querySelector('[data-act="cancel"]');

  let dirty = false;
  let saving = false;

  $("#modal-root").appendChild(backdrop);

  // 挂载必须在插入 DOM 之后：CodeMirror 首次测量高度需要父节点已有尺寸。
  const editor = mountCodeEditor(host, {
    value: content,
    filename: entry.name,
    onChange: () => {
      dirty = true;
      updateStatus();
    },
  });

  function updateStatus() {
    const text = editor.getValue();
    const lines = text.split("\n").length;
    status.textContent = `${dirty ? "已修改" : "未修改"} · ${lines} 行 · ${humanSize(text.length)}`;
  }

  const dispose = () => {
    editor.destroy();
    backdrop.remove();
  };

  const close = async () => {
    if (saving) return;
    if (dirty) {
      const ok = await confirmDialog({
        title: "放弃修改",
        message: `“${entry.name}”还没有保存，确定关闭？`,
        confirmLabel: "放弃修改",
      });
      if (!ok) return;
    }
    dispose();
  };

  const save = async () => {
    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    status.textContent = "保存中…";
    try {
      await SftpWriteTextFile(sessionId, entry.path, editor.getValue());
      saving = false;
      dirty = false;
      dispose();
      toast(`已保存 ${entry.name}`, "success", 3000);
      // 从终端打开的编辑器没有文件列表面板，保存后不用刷新。
      if (tab.kind === "sftp") refreshSide(tab, "remote").catch(() => {});
    } catch (err) {
      // Keep the editor and the text: the session may have dropped and the user
      // still needs a chance to retry or copy the content out.
      saving = false;
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      updateStatus();
      fail(err, "保存失败");
    }
  };

  backdrop.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "save") save();
    else if (act === "cancel" || act === "close") close();
    else if (e.target === backdrop) close();
  });
  backdrop.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  updateStatus();
  editor.focus();
}

/* ================================================================ log viewer */

// 默认只读尾部 2MB：最大的日志 39MB，整份读进来再渲染会把窗口卡住。
// 需要更早的内容时点"读完整"（后端上限 32MB），或者直接用编辑器打开。
const LOG_TAIL_BYTES = 2 << 20;
// 一次只渲染 2000 行，滚到上下边界再往前/往后接一段。
const LOG_RENDER_STEP = 2000;
// 单行可能带整段钉钉响应体，截断显示保证 DOM 不会几百万字符；完整内容看编辑器。
const LOG_LINE_MAX = 3000;
// 跟随的读取间隔记在本机：盯现场时可以调到 1 秒，平时 2 秒够用。
const LOG_FOLLOW_KEY = "xssh:logFollowMs";
const LOG_FOLLOW_DEFAULT = 2000;

// zap JSON 的四个固定字段单独成列，剩下的都算附加字段。
const LOG_FIELDS = new Set(["time", "level", "caller", "msg"]);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** zap 的 ISO8601 时间当天都是同一个日期，只留时分秒省宽度。 */
function shortLogTime(value) {
  const text = String(value ?? "");
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(text);
  return match ? match[1] : text;
}

/** 解析一行 zap JSON；解析失败（堆栈、分隔行）就原样当纯文本。 */
function parseLogLine(raw) {
  const entry = { raw, time: "", level: "", caller: "", text: raw, plain: true };
  if (!raw.startsWith("{")) return entry;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return entry;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return entry;

  entry.plain = false;
  entry.time = shortLogTime(obj.time);
  entry.level = String(obj.level ?? "").toUpperCase();
  entry.caller = String(obj.caller ?? "");
  const parts = [];
  if (obj.msg !== undefined) parts.push(String(obj.msg));
  for (const [key, value] of Object.entries(obj)) {
    if (LOG_FIELDS.has(key)) continue;
    parts.push(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  entry.text = parts.join("  ").trim();
  if (entry.text.length > LOG_LINE_MAX) entry.text = `${entry.text.slice(0, LOG_LINE_MAX)} …`;
  return entry;
}

/** 连续完全相同的行折叠成 ×N：zap 的报错常在循环里刷满整屏。 */
function foldLogLines(lines) {
  const out = [];
  for (const raw of lines) {
    const last = out[out.length - 1];
    if (last && last.raw === raw) {
      last.count += 1;
      continue;
    }
    out.push({ ...parseLogLine(raw), count: 1 });
  }
  return out;
}

/**
 * 过滤表达式：空格分词的 AND。
 * 普通词按子串搜；`/.../` 是正则；`-词` 是排除。
 * 正则写错时退回子串匹配，别让整个过滤框失效。
 */
function compileLogFilter(query) {
  const tokens = [];
  for (const part of String(query).trim().split(/\s+/)) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith("/") && part.endsWith("/")) {
      try {
        tokens.push({ re: new RegExp(part.slice(1, -1), "i") });
        continue;
      } catch {
        // 落到下面的子串分支
      }
    }
    if (part.startsWith("-") && part.length > 1) tokens.push({ text: part.slice(1).toLowerCase(), exclude: true });
    else tokens.push({ text: part.toLowerCase() });
  }
  return tokens;
}

/** 命中词包成 <mark>：先在原文里切，再逐段转义，下标不会因实体而错位。 */
function highlightLogText(text, tokens) {
  const active = tokens.filter((token) => !token.exclude);
  if (!active.length) return esc(text);
  let re;
  try {
    re = new RegExp(active.map((token) => (token.re ? token.re.source : escapeRegExp(token.text))).join("|"), "gi");
  } catch {
    return esc(text);
  }
  let out = "";
  let last = 0;
  for (const match of text.matchAll(re)) {
    if (!match[0]) continue;
    out += esc(text.slice(last, match.index)) + `<mark>${esc(match[0])}</mark>`;
    last = match.index + match[0].length;
  }
  return out + esc(text.slice(last));
}

/** 日志默认进只读查看器，其它文件进编辑器。 */
function openRemoteFile(tab, entry) {
  if (/\.log(\.\d+)?$/i.test(entry.name || "")) return openLogViewer(tab, entry);
  return openTextEditor(tab, entry);
}

/**
 * 只读日志查看器。
 *
 * 一次读进内存、前端过滤：日志按天切分、单文件多数在几 MB 以内，
 * 所以不做服务端 grep 和增量轮询。默认只读尾部、只渲染最近 2000 行，
 * 保证 39MB 那种历史文件打开时不会先卡十秒。
 */
async function openLogViewer(tab, entry) {
  let sessionId;
  try {
    sessionId = await editorSession(tab);
  } catch (err) {
    return fail(err, "SFTP 尚未连接");
  }

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal log-modal">
      <div class="modal-head">
        <span class="modal-title">${icon("file")}<span>${esc(entry.name)}</span></span>
        <span class="editor-path" title="${esc(entry.path)}">${esc(entry.path)}</span>
        <button class="btn btn-sm" data-act="edit" title="用内置编辑器打开">${icon("edit")}编辑</button>
        <button class="icon-btn" data-act="close" title="关闭" aria-label="关闭">${icon("close")}</button>
      </div>
      <div class="log-toolbar">
        <input class="log-filter" data-filter spellcheck="false" autocomplete="off"
          placeholder="过滤：关键字 · /正则/ · -排除词，空格分隔" aria-label="过滤日志" />
        <select class="log-level" data-level aria-label="按级别过滤"><option value="">全部级别</option></select>
        <span class="log-hits" data-hits></span>
        <button class="btn btn-sm" data-act="prev" title="上一个匹配（Shift+F3）">↑</button>
        <button class="btn btn-sm" data-act="next" title="下一个匹配（F3）">↓</button>
        <button class="btn btn-sm" data-act="full" title="读取整个文件（上限 32MB）" hidden>${icon("download")}读完整</button>
        <button class="btn btn-sm" data-act="follow" aria-pressed="false" title="持续读取新增内容（tail -f）">${icon("down")}跟随</button>
        <select class="log-rate" data-rate aria-label="跟随间隔" title="跟随读取间隔">
          <option value="1000">1 秒</option>
          <option value="2000" selected>2 秒</option>
          <option value="5000">5 秒</option>
          <option value="10000">10 秒</option>
        </select>
        <button class="btn btn-sm" data-act="refresh" title="重新读取（Ctrl+R）">${icon("refresh")}刷新</button>
      </div>
      <div class="log-body" data-body><div class="log-lines" data-lines></div></div>
      <div class="modal-foot log-foot">
        <span class="log-status" data-status>读取中…</span>
        <span class="spacer"></span>
        <span class="log-hint">双击整行可复制 / 格式化</span>
        <label class="log-wrap"><input type="checkbox" data-wrap /> 折行</label>
      </div>
    </div>`;

  const body = backdrop.querySelector("[data-body]");
  const linesEl = backdrop.querySelector("[data-lines]");
  const filterInput = backdrop.querySelector("[data-filter]");
  const levelSelect = backdrop.querySelector("[data-level]");
  const hitsEl = backdrop.querySelector("[data-hits]");
  const statusEl = backdrop.querySelector("[data-status]");
  const fullBtn = backdrop.querySelector('[data-act="full"]');
  const followBtn = backdrop.querySelector('[data-act="follow"]');
  const rateSelect = backdrop.querySelector("[data-rate]");
  const wrapBox = backdrop.querySelector("[data-wrap]");

  try {
    const saved = localStorage.getItem(LOG_FOLLOW_KEY) || "";
    if ([...rateSelect.options].some((option) => option.value === saved)) rateSelect.value = saved;
  } catch {
    // 读取失败就按默认 2 秒
  }

  const view = {
    entries: [], // 折叠后的全部行
    rows: [], // 过滤后的行
    tokens: [],
    start: 0, // rows 里已渲染区间的起点
    end: 0, // 终点（不含）
    match: -1, // 当前跳到的行在 rows 里的下标
    chunk: null,
    full: false, // 是否已经按"读完整"读过
    loading: false,
    levelSignature: "", // 已生成的级别列表，没变化就不重建下拉
    follow: false, // 是否在跟随最新（tail -f）
    offset: 0, // 已读到的文件偏移，跟随从这里接着读
    busy: false, // 跟随请求进行中，避免重叠
    timer: 0,
  };
  // 程序自己改 scrollTop 时别触发续接逻辑，否则跳到旧匹配会立刻往上翻页。
  let scrollLock = false;

  const rowHTML = (item, index) => `
    <div class="log-row${item.plain ? " is-plain" : ""}${item.fresh ? " is-fresh" : ""}" data-i="${index}" title="双击查看整行并复制">
      ${item.time ? `<span class="log-time">${esc(item.time)}</span>` : ""}
      ${item.level ? `<span class="log-level lv-${esc(item.level.toLowerCase())}">${esc(item.level)}</span>` : ""}
      ${item.caller ? `<span class="log-caller" title="${esc(item.caller)}">${esc(item.caller)}</span>` : ""}
      <span class="log-text">${highlightLogText(item.text, view.tokens)}</span>
      ${item.count > 1 ? `<span class="log-repeat" title="连续重复 ${item.count} 次">×${item.count}</span>` : ""}
      <span class="log-actions">
        <button class="icon-btn log-act" data-act="copy" title="复制整行原文">${icon("copy")}</button>
        <button class="icon-btn log-act" data-act="raw" title="查看整行（格式化 JSON）">${icon("search")}</button>
      </span>
    </div>`;

  function paintLog() {
    const slice = view.rows.slice(view.start, view.end);
    linesEl.innerHTML = slice.length
      ? slice.map((item, i) => rowHTML(item, view.start + i)).join("")
      : `<div class="file-list-empty">没有可显示的行</div>`;
    updateLogStatus();
  }

  /** 过滤后跳回最新一段，滚动条停在底部（查看日志通常先看最新）。 */
  function applyLogFilter() {
    view.tokens = compileLogFilter(filterInput.value);
    const level = levelSelect.value;
    view.rows = view.entries.filter((item) => {
      if (level && item.level !== level) return false;
      const text = item.raw.toLowerCase();
      return view.tokens.every((token) => {
        const hit = token.re ? token.re.test(item.raw) : text.includes(token.text);
        return token.exclude ? !hit : hit;
      });
    });
    view.match = -1;
    view.end = view.rows.length;
    view.start = Math.max(0, view.end - LOG_RENDER_STEP);
    paintLog();
    scrollLock = true;
    body.scrollTop = body.scrollHeight;
    requestAnimationFrame(() => {
      scrollLock = false;
    });
    updateLogHits();
  }

  function updateLogHits() {
    if (!view.tokens.length && !levelSelect.value) {
      hitsEl.textContent = "";
      hitsEl.classList.remove("is-empty");
      return;
    }
    hitsEl.textContent = view.rows.length
      ? `命中 ${view.rows.length} 行${view.match >= 0 ? ` · 第 ${view.match + 1}` : ""}`
      : "没有命中";
    hitsEl.classList.toggle("is-empty", !view.rows.length);
  }

  function updateLogStatus() {
    if (!view.chunk) return;
    const total = view.entries.reduce((sum, item) => sum + item.count, 0);
    const parts = [`共 ${total} 行`];
    if (view.rows.length !== view.entries.length) parts.push(`过滤后 ${view.rows.length}`);
    parts.push(humanSize(view.chunk.size));
    if (view.chunk.truncated) parts.push(`只读了最后 ${humanSize(view.chunk.readSize)}`);
    if (view.follow) parts.push(`跟随中 · 每 ${followInterval() / 1000} 秒`);
    statusEl.textContent = parts.join(" · ");
  }

  /** 跳到某条匹配：不在已渲染区间就先重新开一个窗口，再高亮该行。 */
  function revealLogRow(index) {
    if (index < view.start) {
      view.start = index;
      view.end = Math.min(view.rows.length, index + LOG_RENDER_STEP);
      paintLog();
      scrollLock = true;
      body.scrollTop = 0;
      requestAnimationFrame(() => {
        scrollLock = false;
      });
    } else if (index >= view.end) {
      view.end = Math.min(view.rows.length, index + 1);
      view.start = Math.max(0, view.end - LOG_RENDER_STEP);
      paintLog();
      scrollLock = true;
      body.scrollTop = body.scrollHeight;
      requestAnimationFrame(() => {
        scrollLock = false;
      });
    }
    linesEl.querySelector(".log-row.is-current")?.classList.remove("is-current");
    const row = linesEl.querySelector(`[data-i="${index}"]`);
    row?.scrollIntoView({ block: "center" });
    row?.classList.add("is-current");
  }

  /** 上下一个匹配；没过滤时就是逐行翻，回绕到底部/顶部。 */
  function jumpLogMatch(step) {
    if (!view.rows.length) return;
    const len = view.rows.length;
    const next = view.match < 0 ? (step > 0 ? 0 : len - 1) : (view.match + step + len) % len;
    view.match = next;
    revealLogRow(next);
    updateLogHits();
  }

  /** 级别下拉按实际出现过的级别生成，常见级别排前面，其余按字母序。 */
  function fillLevelOptions() {
    const order = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"];
    const levels = [...new Set(view.entries.map((item) => item.level).filter(Boolean))];
    levels.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
    // 跟随刷新时级别通常不变；重建 innerHTML 会把展开的下拉关掉，所以没新级别就跳过
    const signature = levels.join(",");
    if (signature === view.levelSignature) return;
    view.levelSignature = signature;
    const current = levelSelect.value;
    levelSelect.innerHTML = [
      `<option value="">全部级别</option>`,
      ...levels.map((level) => `<option value="${esc(level)}">${esc(level)}</option>`),
    ].join("");
    levelSelect.value = levels.includes(current) ? current : "";
  }

  async function loadLog() {
    if (view.loading) return;
    view.loading = true;
    statusEl.textContent = "读取中…";
    try {
      const chunk = await SftpReadLog(sessionId, entry.path, view.full ? 0 : LOG_TAIL_BYTES);
      view.chunk = chunk;
      view.offset = chunk.size;
      // 文件以换行结尾时 split 会多出一个空串，去掉免得渲染空白行；
      // 老服务端偶尔带 BOM，不去掉第一行就不是 JSON 了。
      const lines = chunk.content.replace(/^\uFEFF/, "").split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      view.entries = foldLogLines(lines);
      fullBtn.hidden = !chunk.truncated || view.full;
      fillLevelOptions();
      applyLogFilter();
    } catch (err) {
      statusEl.textContent = "读取失败";
      fail(err, `无法打开 ${entry.name}`);
    } finally {
      view.loading = false;
    }
  }

  /** 追加一段新增内容：折叠规则和首屏一致，连续重复的行继续累加 ×N。 */
  function appendLogChunk(content) {
    const lines = content.replace(/^\uFEFF/, "").split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    if (!lines.length) return;
    for (const raw of lines) {
      const last = view.entries[view.entries.length - 1];
      if (last && last.raw === raw) {
        last.count += 1;
        // 这一行又出现了一次，同样算"跟随后新来的"
        last.fresh = true;
        continue;
      }
      view.entries.push({ ...parseLogLine(raw), count: 1, fresh: true });
    }
    // 新行可能带来新的级别，下拉要跟着长
    fillLevelOptions();
    // 重算过滤会一并滚到最新一行，正是"跟随"想要的落点
    applyLogFilter();
  }

  async function followOnce() {
    if (!view.follow || view.busy || !view.chunk) return;
    view.busy = true;
    try {
      const inc = await SftpTailLog(sessionId, entry.path, view.offset);
      // 等待期间弹层可能已经关了，结果直接丢掉
      if (!view.follow || !backdrop.isConnected) return;
      if (inc.reset) {
        // 文件被轮转/截断，offset 已经失效：整体重读尾部
        view.full = false;
        view.busy = false;
        await loadLog();
        return;
      }
      view.offset = inc.next;
      view.chunk.size = inc.size;
      // 跟随读到的新内容也算进"已读大小"，否则状态栏一直停在上次刷新的数字
      view.chunk.readSize += inc.content.length;
      if (inc.content) appendLogChunk(inc.content);
      else updateLogStatus();
    } catch (err) {
      setFollow(false);
      statusEl.textContent = "跟随已停止";
      fail(err, "日志跟随中断");
    } finally {
      view.busy = false;
    }
  }

  /** 跟随间隔：下拉里的值就是毫秒数，取不到就按默认 2 秒。 */
  function followInterval() {
    const ms = Number(rateSelect.value);
    return Number.isFinite(ms) && ms >= 500 ? ms : LOG_FOLLOW_DEFAULT;
  }

  function setFollow(on) {
    view.follow = on;
    clearInterval(view.timer);
    view.timer = 0;
    followBtn.classList.toggle("btn-primary", on);
    followBtn.setAttribute("aria-pressed", String(on));
    followBtn.innerHTML = `${icon("down")}${on ? "跟随中" : "跟随"}`;
    if (!on) {
      updateLogStatus();
      return;
    }
    // 开跟随时先跳到最新，之后按选定的间隔只取新增的完整行
    if (view.chunk) view.offset = view.chunk.size;
    if (view.rows.length) {
      view.match = -1;
      view.end = view.rows.length;
      view.start = Math.max(0, view.end - LOG_RENDER_STEP);
      paintLog();
      body.scrollTop = body.scrollHeight;
    }
    view.timer = setInterval(followOnce, followInterval());
    updateLogStatus();
  }

  let filterTimer = 0;
  filterInput.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyLogFilter, 120);
  });
  levelSelect.addEventListener("change", applyLogFilter);
  rateSelect.addEventListener("change", () => {
    try {
      localStorage.setItem(LOG_FOLLOW_KEY, rateSelect.value);
    } catch {
      // 存不下就只在本次打开期间生效
    }
    // 正在跟随就按新间隔重排，不用让用户先关再开
    if (view.follow) {
      clearInterval(view.timer);
      view.timer = setInterval(followOnce, followInterval());
    }
    updateLogStatus();
  });
  wrapBox.addEventListener("change", () => linesEl.classList.toggle("is-wrap", wrapBox.checked));

  /** 复制到系统剪贴板，失败给条错误提示。 */
  function copyLog(text, label) {
    writeClipboard(text)
      .then(() => toast(`已复制${label}`, "success", 2200))
      .catch((err) => fail(err, "复制失败"));
  }

  /**
   * 整行详情。
   *
   * 一行 zap JSON 经常几 KB，缩进后才有法读，所以默认展示格式化结果；
   * 同时保留"复制原文"，贴去别的工具时不会被格式化改动。
   */
  function showLogDetail(item) {
    let pretty = item.raw;
    try {
      pretty = JSON.stringify(JSON.parse(item.raw), null, 2);
    } catch {
      // 非 JSON 行（堆栈、分隔线）没有结构可格式化，原样展示
    }

    const detail = document.createElement("div");
    detail.className = "modal-backdrop";
    detail.innerHTML = `
      <div class="modal log-detail-modal">
        <div class="modal-head">
          <span class="modal-title">${icon("file")}<span>${esc(item.time || "日志行")}${item.level ? ` · ${esc(item.level)}` : ""}</span></span>
          <span class="editor-path">${esc(item.caller)}</span>
          <button class="icon-btn" data-act="close" title="关闭" aria-label="关闭">${icon("close")}</button>
        </div>
        <pre class="log-raw" data-raw tabindex="0"></pre>
        <div class="modal-foot log-foot">
          <span class="log-status">${item.count > 1 ? `连续出现 ${item.count} 次 · ` : ""}原文 ${item.raw.length} 字符</span>
          <span class="spacer"></span>
          <button class="btn" data-act="copy-raw">复制原文</button>
          <button class="btn btn-primary" data-act="copy-pretty">复制格式化</button>
        </div>
      </div>`;

    const pre = detail.querySelector("[data-raw]");
    pre.textContent = pretty;

    function closeDetail() {
      window.removeEventListener("keydown", onDetailKey);
      detail.remove();
    }

    // 详情可能压在日志弹层上，Escape 只关最上层的那一个。
    function onDetailKey(e) {
      if (!detail.isConnected || $("#modal-root").lastElementChild !== detail) return;
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeDetail();
    }

    detail.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "close") closeDetail();
      else if (act === "copy-raw") copyLog(item.raw, "原文");
      else if (act === "copy-pretty") copyLog(pretty, "格式化内容");
      else if (e.target === detail) closeDetail();
    });

    $("#modal-root").appendChild(detail);
    window.addEventListener("keydown", onDetailKey);
    pre.focus();
  }

  // 双击整行看完整内容：折行宽度有限时，几 KB 的一行只能靠这个复制出去。
  body.addEventListener("dblclick", (e) => {
    if (e.target.closest(".log-actions")) return;
    const row = e.target.closest(".log-row");
    const item = row ? view.rows[Number(row.dataset.i)] : null;
    if (item) showLogDetail(item);
  });

  body.addEventListener("scroll", () => {
    if (scrollLock || view.loading || !view.rows.length) return;
    if (body.scrollTop < 40) {
      if (view.start === 0) return;
      const before = body.scrollHeight;
      const top = body.scrollTop;
      view.start = Math.max(0, view.start - LOG_RENDER_STEP);
      paintLog();
      scrollLock = true;
      body.scrollTop = top + (body.scrollHeight - before);
      requestAnimationFrame(() => {
        scrollLock = false;
      });
    } else if (body.scrollTop + body.clientHeight > body.scrollHeight - 40) {
      if (view.end >= view.rows.length) return;
      view.end = Math.min(view.rows.length, view.end + LOG_RENDER_STEP);
      paintLog();
    }
  });

  backdrop.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "copy" || act === "raw") {
      const item = view.rows[Number(e.target.closest(".log-row")?.dataset.i)];
      if (!item) return;
      if (act === "raw") showLogDetail(item);
      else copyLog(item.raw, "整行原文");
      return;
    }
    if (act === "close") dispose();
    else if (act === "refresh") {
      view.full = false;
      loadLog();
    } else if (act === "full") {
      view.full = true;
      loadLog();
    } else if (act === "follow") setFollow(!view.follow);
    else if (act === "prev") jumpLogMatch(-1);
    else if (act === "next") jumpLogMatch(1);
    else if (act === "edit") openTextEditor(tab, entry);
    else if (e.target === backdrop) dispose();
  });

  // 快捷键挂在 window 上：点过日志正文后焦点会落到 body，挂在弹层上就收不到按键了。
  // 只在日志弹层是最上层时处理，否则叠在上面的编辑器/确认框会被抢走 Escape。
  function onKey(e) {
    if (!backdrop.isConnected || $("#modal-root").lastElementChild !== backdrop) return;
    if (e.key === "Escape") {
      e.preventDefault();
      dispose();
    } else if (e.key === "F3") {
      e.preventDefault();
      jumpLogMatch(e.shiftKey ? -1 : 1);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      filterInput.focus();
      filterInput.select();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
      e.preventDefault();
      view.full = false;
      loadLog();
    } else if (e.key === "Enter" && e.target === filterInput) {
      e.preventDefault();
      // 输入防抖还没触发时先过滤，否则跳的是上一次的结果。
      clearTimeout(filterTimer);
      applyLogFilter();
      jumpLogMatch(1);
    }
  }

  function dispose() {
    clearTimeout(filterTimer);
    clearInterval(view.timer);
    window.removeEventListener("keydown", onKey);
    backdrop.remove();
  }

  window.addEventListener("keydown", onKey);
  $("#modal-root").appendChild(backdrop);
  filterInput.focus();
  loadLog();
}

async function doUpload(tab, entry = tab.localSel) {
  if (!tab.sessionId) return toast("SFTP 尚未连接。", "error");
  const sel = entry;
  if (!sel) return toast("请先在本地面板中选择文件或文件夹。", "info", 3000);
  try {
    await SftpUpload(tab.sessionId, sel.path, tab.remotePath);
    showTransferPanel();
  } catch (err) {
    fail(err, "上传失败");
  }
}

async function doDownload(tab, entry = tab.remoteSel) {
  if (!tab.sessionId) return toast("SFTP 尚未连接。", "error");
  const sel = entry;
  if (!sel) return toast("请先在远程面板中选择文件或文件夹。", "info", 3000);
  try {
    await SftpDownload(tab.sessionId, sel.path, tab.localPath);
    showTransferPanel();
  } catch (err) {
    fail(err, "下载失败");
  }
}

/* ============================================================= host editor */

function hostEditor(host) {
  const editing = Boolean(host);
  const draft = host || {
    name: "",
    groupId: "",
    address: "",
    port: 22,
    username: "",
    authType: "password",
    password: "",
    privateKey: "",
    passphrase: "",
    tags: [],
  };

  const groupOptions = [
    `<option value="">— 未分组 —</option>`,
    ...state.profile.groups.map(
      (g) => `<option value="${esc(g.id)}" ${g.id === draft.groupId ? "selected" : ""}>${esc(g.name)}</option>`
    ),
  ].join("");

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div><div class="modal-title">${icon("server")}${editing ? "编辑主机" : "新建主机"}</div></div>
        <button class="icon-btn" data-act="cancel" aria-label="关闭主机编辑器">${icon("close")}</button>
      </div>
      <div class="modal-body">
        <div class="field-row">
          <div class="field">
            <label>主机名称</label>
            <input type="text" data-f="name" value="${esc(draft.name)}" placeholder="例如：生产服务器" />
          </div>
          <div class="field">
            <label>所属分组</label>
            <select data-f="groupId">${groupOptions}</select>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>服务器地址</label>
            <input type="text" data-f="address" value="${esc(draft.address)}" placeholder="IP 地址或域名" />
          </div>
          <div class="field narrow">
            <label>端口</label>
            <input type="number" data-f="port" value="${draft.port || 22}" min="1" max="65535" />
          </div>
        </div>

        <div class="field">
          <label>用户名</label>
          <input type="text" data-f="username" value="${esc(draft.username)}" placeholder="root" />
        </div>

        <div class="field field-divider">
          <label>身份验证</label>
          <div class="radio-row">
            <label><input type="radio" name="authtype" value="password" ${draft.authType !== "key" ? "checked" : ""} /> 密码</label>
            <label><input type="radio" name="authtype" value="key" ${draft.authType === "key" ? "checked" : ""} /> 私钥</label>
          </div>
        </div>

        <div class="field" data-pane="password">
          <label>密码</label>
          <input type="password" data-f="password" value="${esc(draft.password)}" placeholder="••••••••" />
        </div>

        <div class="field" data-pane="key">
          <label>私钥内容</label>
          <textarea data-f="privateKey" spellcheck="false" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----">${esc(draft.privateKey)}</textarea>
          <div class="row-gap">
            <button class="btn btn-sm" data-act="import-key">从文件导入…</button>
            <span class="hint">私钥将加密保存在本地配置中。</span>
          </div>
        </div>

        <div class="field" data-pane="key">
          <label>私钥口令（选填）</label>
          <input type="password" data-f="passphrase" value="${esc(draft.passphrase)}" />
        </div>

        <div class="field">
          <label>标签（用逗号分隔）</label>
          <input type="text" data-f="tags" value="${esc((draft.tags || []).join(", "))}" placeholder="生产环境, 数据库" />
        </div>
      </div>
      <div class="modal-foot">
        ${editing ? `<button class="btn btn-danger" data-act="delete">删除</button>` : ""}
        <span class="spacer"></span>
        <button class="btn" data-act="cancel">取消</button>
        <button class="btn btn-primary" data-act="save">${editing ? "保存" : "创建"}</button>
      </div>
    </div>`;

  const read = (name) => backdrop.querySelector(`[data-f="${name}"]`).value;
  const authType = () =>
    backdrop.querySelector('input[name="authtype"]:checked').value;

  const syncAuthPanes = () => {
    const isKey = authType() === "key";
    backdrop.querySelectorAll('[data-pane="password"]').forEach((n) => (n.style.display = isKey ? "none" : "flex"));
    backdrop.querySelectorAll('[data-pane="key"]').forEach((n) => (n.style.display = isKey ? "flex" : "none"));
  };
  backdrop.querySelectorAll('input[name="authtype"]').forEach((n) => n.addEventListener("change", syncAuthPanes));
  syncAuthPanes();

  backdrop.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) {
      if (e.target === backdrop) backdrop.remove();
      return;
    }

    if (act === "cancel") {
      backdrop.remove();
      return;
    }

    if (act === "import-key") {
      try {
        const content = await ImportPrivateKeyFile();
        if (content) {
          backdrop.querySelector('[data-f="privateKey"]').value = content;
          backdrop.querySelector('input[value="key"]').checked = true;
          syncAuthPanes();
        }
      } catch (err) {
        fail(err, "导入私钥失败");
      }
      return;
    }

    if (act === "delete") {
      const ok = await confirmDialog({
        title: "删除主机",
        message: `确定删除主机“${draft.name || draft.address}”？`,
        confirmLabel: "删除",
      });
      if (!ok) return;
      try {
        await DeleteHost(draft.id);
        backdrop.remove();
        await reloadProfile();
        toast("主机已删除。", "success", 2500);
      } catch (err) {
        fail(err, "删除主机失败");
      }
      return;
    }

    if (act === "save") {
      const payload = {
        id: draft.id || "",
        name: read("name").trim(),
        groupId: read("groupId"),
        address: read("address").trim(),
        port: Number(read("port")) || 22,
        username: read("username").trim(),
        authType: authType(),
        password: read("password"),
        privateKey: read("privateKey"),
        passphrase: read("passphrase"),
        tags: read("tags")
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
      };
      try {
        await SaveHost(payload);
        backdrop.remove();
        await reloadProfile();
        toast(editing ? "主机已保存。" : "主机已创建。", "success", 2500);
      } catch (err) {
        fail(err, "保存主机失败");
      }
    }
  });

  $("#modal-root").appendChild(backdrop);
  backdrop.querySelector('[data-f="name"]').focus();
}

async function groupEditor(group) {
  const editing = Boolean(group);
  const name = await promptDialog({
    title: editing ? "重命名分组" : "新建分组",
    label: "分组名称",
    value: group?.name || "",
  });
  if (!name) return;
  try {
    await SaveGroup({ id: group?.id || "", name, parentId: group?.parentId || "", order: group?.order || 0 });
    await reloadProfile();
  } catch (err) {
    fail(err, "保存分组失败");
  }
}

/* ================================================================ settings */

function updateAppearance() {
  applyAppearance(state.appearance);
  for (const tab of state.tabs) {
    if (tab.term) tab.term.options.theme = terminalTheme();
  }
}

async function openSettings() {
  let info = { version: "?", dataDir: "?", keySource: "?", profilePath: "?" };
  let known = {};
  try {
    info = await GetAppInfo();
    known = await ListKnownHosts();
  } catch (err) {
    fail(err, "读取设置失败");
  }

  const entries = Object.entries(known);
  const keySource = { "os-keychain": "系统凭据管理器", keyfile: "本地密钥文件" }[info.keySource] || info.keySource;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-head">设置</div>
      <div class="modal-body">
        <div class="field">
          <label>配色主题</label>
          <div class="theme-grid" role="group" aria-label="配色主题">
            ${themes.map(t => `<button class="theme-choice" data-theme-choice="${t.id}" aria-pressed="${t.id === state.appearance.theme}" style="--preview-bg:${t.canvas};--preview-text:${t.text};--preview-accent:${t.accent}"><span class="theme-preview" aria-hidden="true"><span></span><i></i><i></i></span><span>${t.name}</span></button>`).join("")}
          </div>
        </div>
        <div class="appearance-actions"><span class="hint">主题自动保存，下次启动沿用。</span><button class="btn btn-sm" data-act="reset-appearance">恢复默认</button></div>
        <div class="field">
          <label>本地文件起始目录</label>
          <div class="hint">打开文件管理时，左边本地面板从哪个目录开始。不设置就跟着系统走（家目录所在的盘）。</div>
          <div class="hint" style="font-family:var(--mono);word-break:break-all">${esc(state.localStart || "跟随系统（家目录所在盘）")}</div>
          <div class="appearance-actions">
            <button class="btn btn-sm" data-act="pick-local-start">${icon("folder")}选择目录</button>
            <button class="btn btn-sm" data-act="reset-local-start"${state.localStart ? "" : " disabled"}>恢复默认</button>
          </div>
        </div>
        <div class="field">
          <label>主机备份</label>
          <div class="hint">导出文件用你设置的密码加密，包含分组、主机和已保存的凭据，可在另一台电脑导入。文件不含明文密码，请牢记密码——丢失后无法恢复。</div>
          <div class="appearance-actions">
            <button class="btn btn-sm" data-act="export-backup">${icon("download")}导出</button>
            <button class="btn btn-sm" data-act="import-backup">${icon("upload")}导入</button>
          </div>
        </div>
        <div class="field">
          <label>关于</label>
          <div class="hint">版本 ${esc(info.version)} · 主密钥来源：<b>${esc(keySource)}</b></div>
        </div>
        <div class="field">
          <label>配置文件</label>
          <div class="hint" style="font-family:var(--mono);word-break:break-all">${esc(info.profilePath)}</div>
        </div>
        <div class="field">
          <label>已信任的主机密钥（${entries.length}）</label>
          <div class="check-list">
            ${
              entries.length
                ? entries
                    .map(
                      ([hostport, fp]) => `
                  <div class="check-item">
                    <span>${esc(hostport)}</span>
                    <code>${esc(fp.replace("SHA256:", "").slice(0, 16))}…</code>
                    <button class="icon-btn" data-forget="${esc(hostport)}" title="移除信任记录">${icon("close")}</button>
                  </div>`
                    )
                    .join("")
                : `<div class="check-item"><span>暂无已信任的主机。</span></div>`
            }
          </div>
          <div class="hint">首次连接会自动记录主机密钥。服务器重装或密钥变更后，请核实指纹，再移除旧记录并重新连接。</div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn" data-act="close">关闭</button></div>
    </div>`;

  backdrop.addEventListener("click", async (e) => {
    const themeId = e.target.closest("[data-theme-choice]")?.dataset.themeChoice;
    const action = e.target.closest("[data-act]")?.dataset.act;
    if (themeId || action === "reset-appearance") {
      state.appearance = themeId ? { ...state.appearance, theme: themeId } : normalizeAppearance();
      updateAppearance();
      for (const button of backdrop.querySelectorAll("[data-theme-choice]")) {
        button.setAttribute("aria-pressed", String(button.dataset.themeChoice === state.appearance.theme));
      }
      persistAppearance();
      return;
    }
    const forget = e.target.closest("[data-forget]")?.dataset.forget;
    if (forget) {
      try {
        await ForgetHostKey(forget);
        backdrop.remove();
        openSettings();
      } catch (err) {
        fail(err, "移除主机密钥记录失败");
      }
      return;
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "pick-local-start") {
      try {
        const picked = await PickLocalDirectory();
        if (!picked) return; // 取消选择，不动现有设置
        state.localStart = picked;
        saveLocalStart(picked);
        backdrop.remove();
        openSettings();
      } catch (err) {
        fail(err, "选择目录失败");
      }
      return;
    }
    if (act === "reset-local-start") {
      state.localStart = "";
      saveLocalStart("");
      backdrop.remove();
      openSettings();
      return;
    }
    if (act === "export-backup") {
      exportBackupDialog();
      return;
    }
    if (act === "import-backup") {
      importBackupDialog();
      return;
    }
    if (act === "close" || e.target === backdrop) backdrop.remove();
  });

  function persistAppearance() {
    try { saveAppearance(state.appearance); }
    catch (err) { fail(err, "外观设置保存失败"); }
  }
  $("#modal-root").appendChild(backdrop);
}

/* ================================================================== backup */

function exportBackupDialog() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:440px">
      <div class="modal-head">导出主机配置</div>
      <div class="modal-body">
        <div class="hint">导出内容使用该密码加密。导入时需要输入同一密码，密码丢失后备份无法解密。</div>
        <div class="field"><label>备份密码</label><input type="password" id="bk-pass" autocomplete="new-password" /></div>
        <div class="field"><label>确认密码</label><input type="password" id="bk-pass2" autocomplete="new-password" /></div>
      </div>
      <div class="modal-foot">
        <button class="btn" data-act="cancel">取消</button>
        <button class="btn btn-primary" data-act="ok">${icon("download")}导出</button>
      </div>
    </div>`;
  const pass = backdrop.querySelector("#bk-pass");
  const pass2 = backdrop.querySelector("#bk-pass2");
  const submit = async () => {
    if (!pass.value.trim()) return toast("请设置备份密码", "error");
    if (pass.value !== pass2.value) return toast("两次输入的密码不一致", "error");
    try {
      const path = await ExportHosts(pass.value);
      backdrop.remove();
      if (path) toast(`已导出到 ${path}`, "success", 6000);
    } catch (err) {
      fail(err, "导出失败");
    }
  };
  backdrop.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "ok") submit();
    else if (act === "cancel" || e.target === backdrop) backdrop.remove();
  });
  backdrop.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") backdrop.remove();
  });
  $("#modal-root").appendChild(backdrop);
  pass.focus();
}

function importBackupDialog() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:520px">
      <div class="modal-head">导入主机配置</div>
      <div class="modal-body">
        <div class="field">
          <label>备份内容</label>
          <textarea id="bk-text" rows="8" spellcheck="false" placeholder="粘贴导出文件的内容，或点击下方按钮选择文件"></textarea>
          <div class="appearance-actions" style="margin-top:var(--space-8)">
            <button class="btn btn-sm" data-act="pick">${icon("folder")}选择备份文件…</button>
            <span class="hint" id="bk-src"></span>
          </div>
        </div>
        <div class="field"><label>备份密码</label><input type="password" id="bk-pass" autocomplete="off" /></div>
        <div class="hint">按 ID 合并：已存在的主机会被备份覆盖，其余追加，不会清空现有配置。</div>
      </div>
      <div class="modal-foot">
        <button class="btn" data-act="cancel">取消</button>
        <button class="btn btn-primary" data-act="ok">${icon("upload")}导入</button>
      </div>
    </div>`;
  const text = backdrop.querySelector("#bk-text");
  const pass = backdrop.querySelector("#bk-pass");
  const okBtn = backdrop.querySelector('[data-act="ok"]');
  const submit = async () => {
    if (!text.value.trim()) return toast("请先粘贴备份内容或选择文件", "error");
    if (!pass.value.trim()) return toast("请输入备份密码", "error");
    okBtn.disabled = true;
    try {
      const sum = await ImportHosts(text.value, pass.value);
      backdrop.remove();
      await reloadProfile();
      toast(
        `导入完成：新增主机 ${sum.hostsAdded}，更新 ${sum.hostsUpdated}；新增分组 ${sum.groupsAdded}`,
        "success",
        6000
      );
    } catch (err) {
      okBtn.disabled = false;
      fail(err, "导入失败");
    }
  };
  backdrop.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "pick") {
      try {
        const content = await ReadBackupFile();
        if (content) {
          text.value = content;
          backdrop.querySelector("#bk-src").textContent = "已读取文件内容";
          pass.focus();
        }
      } catch (err) {
        fail(err, "读取备份文件失败");
      }
    } else if (act === "ok") submit();
    else if (act === "cancel" || e.target === backdrop) backdrop.remove();
  });
  backdrop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") backdrop.remove();
  });
  $("#modal-root").appendChild(backdrop);
  text.focus();
}

/* ================================================================== reload */

async function reloadProfile() {
  try {
    state.profile = await GetProfile();
    if (!state.profile.hosts.some(h => h.id === state.selectedHostId)) state.selectedHostId = null;
    renderSidebar();
    renderTabstrip();
  } catch (err) {
    fail(err, "加载配置失败");
  }
}

/* ============================================================ event wiring */

async function moveGroup(sourceId, targetId, after) {
  const source = state.profile.groups.find((g) => g.id === sourceId);
  const target = state.profile.groups.find((g) => g.id === targetId);
  if (!source || !target || sourceId === targetId || (source.parentId || "") !== (target.parentId || "")) return;

  const parentId = source.parentId || "";
  const siblings = childGroups(parentId);
  const reordered = siblings.filter((g) => g.id !== sourceId);
  const index = reordered.findIndex((g) => g.id === targetId);
  reordered.splice(index + (after ? 1 : 0), 0, source);
  if (reordered.every((g, i) => g.id === siblings[i].id)) return;

  const ids = [];
  const collect = (parent) => {
    for (const group of parent === parentId ? reordered : childGroups(parent)) {
      ids.push(group.id);
      collect(group.id);
    }
  };
  collect("");
  await ReorderGroups(ids);
  await reloadProfile();
}

async function moveHost(sourceId, targetId, after) {
  const source = state.profile.hosts.find((host) => host.id === sourceId);
  const target = state.profile.hosts.find((host) => host.id === targetId);
  if (!source || !target || sourceId === targetId || (source.groupId || "") !== (target.groupId || "")) return;

  // Include hosts hidden by search so their relative order is preserved.
  const hosts = orderedHostsInGroup(source.groupId || "");
  const reordered = hosts.filter((host) => host.id !== sourceId);
  const index = reordered.findIndex((host) => host.id === targetId);
  reordered.splice(index + (after ? 1 : 0), 0, source);
  if (reordered.every((host, i) => host.id === hosts[i].id)) return;
  await ReorderHosts(reordered.map((host) => host.id));
  await reloadProfile();
}

function wireSorting() {
  const itemSelector = "[data-sort-group], [data-sort-host]";
  const itemInfo = (el) => el?.dataset.sortGroup
    ? { kind: "group", id: el.dataset.sortGroup }
    : { kind: "host", id: el?.dataset.sortHost };
  let dragSource = null;
  let saving = false;
  const clearMarkers = () => {
    document.querySelectorAll(".sort-drop-before, .sort-drop-after").forEach((el) => {
      el.classList.remove("sort-drop-before", "sort-drop-after");
    });
  };
  const dropTarget = (event) => {
    const element = event.target.closest(itemSelector);
    const info = itemInfo(element);
    if (saving || !dragSource || !info.id || info.kind !== dragSource.kind) return null;
    const items = info.kind === "group" ? state.profile.groups : state.profile.hosts;
    const parentKey = info.kind === "group" ? "parentId" : "groupId";
    const source = items.find((item) => item.id === dragSource.id);
    const target = items.find((item) => item.id === info.id);
    if (!source || !target || source.id === target.id || (source[parentKey] || "") !== (target[parentKey] || "")) return null;
    return element;
  };
  const isAfter = (event, element) => {
    const rect = element.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  };

  for (const selector of ["#host-grid"]) {
    const container = $(selector);
    container.addEventListener("dragstart", (event) => {
      const heading = event.target.closest(itemSelector);
      if (!heading) return;
      if (saving || event.target.closest("button")) {
        event.preventDefault();
        return;
      }
      dragSource = itemInfo(heading);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(`application/x-xssh-${dragSource.kind}`, dragSource.id);
      heading.classList.add("sort-dragging");
    });
    container.addEventListener("dragover", (event) => {
      clearMarkers();
      const heading = dropTarget(event);
      if (!heading) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      heading.classList.add(isAfter(event, heading) ? "sort-drop-after" : "sort-drop-before");
    });
    container.addEventListener("dragleave", (event) => {
      const heading = event.target.closest(itemSelector);
      if (heading && !heading.contains(event.relatedTarget)) clearMarkers();
    });
    container.addEventListener("drop", async (event) => {
      const heading = dropTarget(event);
      clearMarkers();
      if (!heading) return;
      event.preventDefault();
      const source = dragSource;
      const target = itemInfo(heading);
      dragSource = null;
      saving = true;
      try {
        const move = source.kind === "group" ? moveGroup : moveHost;
        await move(source.id, target.id, isAfter(event, heading));
      } catch (err) {
        fail(err, source.kind === "group" ? "保存分组顺序失败" : "保存主机顺序失败");
      } finally {
        saving = false;
      }
    });
    container.addEventListener("dragend", () => {
      dragSource = null;
      clearMarkers();
      document.querySelectorAll(".sort-dragging").forEach((el) => el.classList.remove("sort-dragging"));
    });
  }
}

function wireEvents() {
  wireSorting();
  // 左上角 logo 与顶栏返回箭头都能回到主机管理。
  $("#btn-brand-top").addEventListener("click", () => setActiveTab(null));
  $("#btn-back").addEventListener("click", () => setActiveTab(null));
  $("#window-minimise").addEventListener("click", WindowMinimise);
  $("#window-maximise").addEventListener("click", WindowToggleMaximise);
  $("#window-close").addEventListener("click", Quit);
  $("#window-titlebar").addEventListener("dblclick", (e) => {
    if (!e.target.closest(".window-controls")) WindowToggleMaximise();
  });
  const syncWindowControls = async () => {
    try {
      const maximised = await WindowIsMaximised();
      const button = $("#window-maximise");
      button.innerHTML = icon(maximised ? "restore" : "maximise");
      button.title = maximised ? "向下还原" : "最大化";
      button.setAttribute("aria-label", button.title);
    } catch (err) {
      fail(err, "读取窗口状态失败");
    }
  };
  window.addEventListener("resize", syncWindowControls);
  syncWindowControls();

  $("#search").addEventListener("input", (e) => {
    state.filter = e.target.value;
    renderSidebar();
  });

  $("#btn-empty-new").addEventListener("click", () => hostEditor(null));
  $("#btn-new-group").addEventListener("click", () => groupEditor(null));
  $("#btn-new-snippet").addEventListener("click", () => snippetEditor(null));
  $("#btn-settings").addEventListener("click", openSettings);

  $("#host-grid").addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "new-host") return hostEditor(null);
    if (act === "clear-search") {
      state.filter = "";
      $("#search").value = "";
      renderSidebar();
      $("#search").focus();
      return;
    }
    if (act === "edit-group" || act === "del-group") {
      const groupId = e.target.closest("[data-group]")?.dataset.group;
      const group = state.profile.groups.find((g) => g.id === groupId);
      if (!group) return;
      if (act === "edit-group") return groupEditor(group);
      const ok = await confirmDialog({
        title: "删除分组",
        message: `确定删除分组“${group.name}”？组内主机将移至“未分组”。`,
        confirmLabel: "删除",
      });
      if (!ok) return;
      try {
        await DeleteGroup(groupId);
        await reloadProfile();
      } catch (err) {
        fail(err, "删除分组失败");
      }
      return;
    }
    const hostRow = e.target.closest("[data-host]");
    const host = state.profile.hosts.find((h) => h.id === hostRow?.dataset.host);
    if (!host) return;
    if (act === "terminal") return openTerminalTab(host);
    if (act === "sftp") return openSftpTab(host);
    if (act === "edit") return hostEditor(host);
    if (!act) selectHost(host.id);
  });

  $("#host-grid").addEventListener("dblclick", (e) => {
    if (e.target.closest("button")) return;
    const row = e.target.closest(".host-item");
    const host = state.profile.hosts.find((h) => h.id === row?.dataset.host);
    if (!host) return;
    selectHost(host.id);
    openTerminalTab(host);
  });

  $("#host-grid").addEventListener("keydown", (e) => {
    if (!e.target.matches(".host-item")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const host = state.profile.hosts.find((h) => h.id === e.target.dataset.host);
      if (host) openTerminalTab(host);
    } else if (e.key === " ") {
      e.preventDefault();
      selectHost(e.target.dataset.host);
    }
  });

  // Space selects a host; Enter connects. Nested buttons keep native activation.
  $("#tabstrip").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!e.target.matches(".tab")) return;
    e.preventDefault();
    if (e.repeat) return;
    e.target.click();
  });

  $("#recent-hosts").addEventListener("click", (e) => {
    const host = state.profile.hosts.find((h) => h.id === e.target.closest("[data-recent]")?.dataset.recent);
    if (host) openHostSession(host);
  });

  $("#snippets").addEventListener("click", (e) => {
    const item = e.target.closest("[data-snippet]");
    if (!item) return;
    const snippet = state.snippets.find((entry) => entry.id === item.dataset.snippet);
    if (!snippet) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "edit-snippet") return snippetEditor(snippet);
    if (act === "del-snippet") return deleteSnippet(snippet);
    runSnippet(snippet);
  });

  $("#snippets").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const item = e.target.closest("[data-snippet]");
    if (!item || e.target.closest("button")) return;
    e.preventDefault();
    const snippet = state.snippets.find((entry) => entry.id === item.dataset.snippet);
    if (snippet) runSnippet(snippet);
  });

  $("#tabstrip").addEventListener("click", (e) => {
    const tabEl = e.target.closest("[data-tab]");
    if (!tabEl) return;
    const id = tabEl.dataset.tab;
    if (e.target.closest('[data-act="close"]')) return closeTab(id);
    setActiveTab(id);
  });

  window.addEventListener("resize", () => {
    const tab = activeTab();
    if (tab?.kind === "terminal") {
      tab.fit?.fit();
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "h") {
      // 回到主机管理，会话保留在标签条里。
      e.preventDefault();
      setActiveTab(null);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ["f", "k"].includes(e.key.toLowerCase()) && !$("#modal-root").children.length) {
      e.preventDefault();
      const tab = activeTab();
      // 终端里 Ctrl+F 是"在输出里查"，不是回主机列表搜主机。
      if (e.key.toLowerCase() === "f" && tab?.kind === "terminal" && tab.openFind) {
        tab.openFind();
        return;
      }
      // 搜索框在主面板上，终端页得先退回去才看得见
      if (tab) setActiveTab(null);
      $("#search").focus();
      $("#search").select();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "w") {
      if (activeTab()) {
        e.preventDefault();
        closeTab(state.activeTabId);
      }
    }
  });
}

/* ============================================================ backend push */

function wireBackendEvents() {
  EventsOn("ssh:data", (payload) => {
    const tab = tabForSession(payload.sessionId);
    if (tab) writeOutput(tab, payload);
    else bufferEvent(payload.sessionId, { type: "data", payload });
  });

  EventsOn("ssh:state", (info) => {
    // "connecting" is emitted before the frontend can know the id, so matches
    // usually happen on "connected"/"closed"; anything unmatched is buffered and
    // replayed once a tab adopts the session.
    const tab = tabForSession(info.id);
    if (tab) applyState(tab, info);
    else bufferEvent(info.id, { type: "state", payload: info });
  });

  EventsOn("sftp:task", (task) => {
    const prev = state.transfers.get(task.id);
    state.transfers.set(task.id, task);

    const wasActive = prev ? prev.status === "queued" || prev.status === "running" : false;
    const isActive = task.status === "queued" || task.status === "running";
    if (wasActive !== isActive) transferActive += isActive ? 1 : -1;

    // Refresh the destination pane once when a transfer lands.
    if (task.status === "done" && prev?.status !== "done") {
      const tab = state.tabs.find((t) => t.sessionId === task.sessionId);
      // The tab may have closed while the transfer was finishing.
      if (tab) scheduleRefresh(tab, task.kind === "upload" ? "remote" : "local");
    }
    if (task.status === "failed" && prev?.status !== "failed") {
      toast(`${task.kind === "upload" ? "上传" : "下载"}失败：${task.name} — ${task.error}`, "error", 7000);
    }

    // Only a new task re-opens the panel; hiding it must stick while the
    // remaining transfers keep reporting progress.
    if (!prev) showTransferPanel();
    upsertTransferRow(task);
    updateTransferSummary();
  });

  EventsOn("host:distro", (payload) => {
    const host = state.profile?.hosts?.find((h) => h.id === payload.hostId);
    if (!host || host.distro === payload.distro) return;
    host.distro = payload.distro;
    renderSidebar();
  });

  $("#transfer-hide").addEventListener("click", () => $("#transfer-panel").classList.add("hidden"));
  $("#transfer-collapse").addEventListener("click", () => $("#transfer-panel").classList.toggle("collapsed"));
  $("#transfer-clear").addEventListener("click", async () => {
    try {
      await SftpClearTasks(""); // every session
    } catch {
      // Sessions may already be gone; clearing the local list is still right.
    }
    for (const [id, t] of state.transfers) {
      if (t.status !== "queued" && t.status !== "running") state.transfers.delete(id);
    }
    renderTransfers();
  });
  $("#transfer-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const task = state.transfers.get(btn.dataset.task);
    if (!task) return;
    try {
      if (btn.dataset.act === "cancel") await SftpCancelTask(task.sessionId, task.id);
      if (btn.dataset.act === "retry") await SftpRetryTask(task.sessionId, task.id);
    } catch (err) {
      fail(err, btn.dataset.act === "cancel" ? "取消失败" : "重试失败");
    }
  });
}

/* ========================================================== transfer panel */

function showTransferPanel() {
  $("#transfer-panel").classList.remove("hidden");
}

const transferStates = {
  queued: "排队中",
  running: "传输中",
  done: "已完成",
  failed: "失败",
  canceled: "已取消",
};

function transferMeta(task) {
  if (task.status === "failed") return task.error || "失败";
  if (task.status === "running") {
    const size = task.total > 0 ? `${humanSize(task.done)} / ${humanSize(task.total)}` : humanSize(task.done);
    return task.file && task.file !== task.name ? `${task.file} · ${size}` : size;
  }
  return transferStates[task.status] || task.status;
}

function transferPercent(task) {
  if (task.total > 0) return Math.min(100, (task.done / task.total) * 100);
  return task.status === "done" ? 100 : 0;
}

// Rows are keyed by task id so one progress tick updates one row instead of
// rebuilding the list. Rebuilding was O(tasks) per event, so an upload got
// slower with every finished transfer; clearing finished tasks "fixed" it by
// shrinking that list.
const transferRows = new Map();
// Active tasks are counted incrementally: every progress event must stay O(1),
// otherwise the cost grows with the number of finished transfers.
let transferActive = 0;

function transferRowHTML(task) {
  const actions =
    task.status === "queued" || task.status === "running"
      ? `<button class="icon-btn" data-act="cancel" data-task="${esc(task.id)}" title="取消">${icon("close")}</button>`
      : task.status === "done"
        ? ""
        : `<button class="icon-btn" data-act="retry" data-task="${esc(task.id)}" title="重试">${icon("refresh")}</button>`;
  const meta = transferMeta(task);
  return `
    <div class="transfer-row ${esc(task.status)}" data-status="${esc(task.status)}" data-kind="${esc(task.kind)}">
      ${icon(task.kind === "upload" ? "upload" : "download")}
      <div class="transfer-main">
        <div class="transfer-name" title="${esc(task.name)}">${esc(task.name)}</div>
        <div class="transfer-meta">
          <div class="transfer-track"><div class="transfer-fill${task.status === "failed" ? " failed" : ""}" style="width:${transferPercent(task)}%"></div></div>
          <span class="transfer-state" title="${esc(meta)}">${esc(meta)}</span>
        </div>
      </div>
      <span>${actions}</span>
    </div>`;
}

function makeTransferRow(task) {
  const template = document.createElement("template");
  template.innerHTML = transferRowHTML(task);
  return template.content.firstElementChild;
}

function upsertTransferRow(task) {
  const row = transferRows.get(task.id);
  if (!row) {
    const el = makeTransferRow(task);
    $("#transfer-list").appendChild(el);
    transferRows.set(task.id, el);
    return;
  }
  if (row.dataset.status !== task.status) {
    // Status changes rewrite the action button, so replace the whole row.
    const el = makeTransferRow(task);
    row.replaceWith(el);
    transferRows.set(task.id, el);
    return;
  }
  // Same status: only the bar and its label can differ.
  row.querySelector(".transfer-fill").style.width = `${transferPercent(task)}%`;
  const state = row.querySelector(".transfer-state");
  state.textContent = transferMeta(task);
  state.title = state.textContent;
}

function updateTransferSummary() {
  const total = state.transfers.size;
  $("#transfer-summary").textContent = transferActive
    ? `${transferActive} 项进行中 · 共 ${total} 项`
    : total
      ? `共 ${total} 项`
      : "暂无传输任务";
}

// Full reconcile, used when the task set shrinks (clear finished).
function renderTransfers() {
  const seen = new Set();
  for (const task of state.transfers.values()) {
    seen.add(task.id);
    upsertTransferRow(task);
  }
  for (const [id, row] of transferRows) {
    if (seen.has(id)) continue;
    row.remove();
    transferRows.delete(id);
  }
  transferActive = 0;
  for (const task of state.transfers.values()) {
    if (task.status === "queued" || task.status === "running") transferActive += 1;
  }
  updateTransferSummary();
}

/* ==================================================================== init */

/**
 * 窗口默认是 1440×900，在 1080p 以下或开了缩放的屏幕上会有一截落到屏幕外。
 * 启动时按当前屏幕的工作区（已扣除任务栏）收一次，放得下就不动。
 */
function fitWindowToScreen() {
  try {
    // screen.avail* 和 outer* 都是 CSS 像素，与 Wails 的 DIP 同一坐标系，不用自己换算 DPI。
    const maxWidth = Math.floor(screen.availWidth * 0.94);
    const maxHeight = Math.floor(screen.availHeight * 0.94);
    if (window.outerWidth <= maxWidth && window.outerHeight <= maxHeight) return;
    WindowSetSize(Math.min(window.outerWidth, maxWidth), Math.min(window.outerHeight, maxHeight));
    WindowCenter();
  } catch (err) {
    fail(err, "调整窗口尺寸失败");
  }
}

async function init() {
  fitWindowToScreen();
  state.localStart = loadLocalStart();
  state.snippets = loadSnippets();
  updateAppearance();
  mountIcons();
  wireEvents();
  wireBackendEvents();
  renderTabstrip();
  await reloadProfile();
}

init();

function selectHost(id) {
  state.selectedHostId = id;
  // Preserve the DOM between click events so a native double-click can fire.
  for (const row of document.querySelectorAll("#host-grid .host-item")) {
    row.classList.toggle("selected", row.dataset.host === id);
  }
}
