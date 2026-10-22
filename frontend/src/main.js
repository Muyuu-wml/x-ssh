import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
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
  SftpOpen,
  SftpHome,
  SftpList,
  SftpParent,
  SftpMkdir,
  SftpRemove,
  SftpRename,
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
  ClipboardGetText,
  ClipboardSetText,
  Quit,
} from "../wailsjs/runtime/runtime";
import { icon, mountIcons } from "./icons";
import { distroIcon } from "./distros";
import { themes, loadAppearance, saveAppearance, applyAppearance } from "./appearance";

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
  filter: "",
  expanded: new Set(),
};

const activeTab = () => state.tabs.find((t) => t.id === state.activeTabId) || null;

let tabSeq = 0;
const nextTabId = () => `tab-${++tabSeq}`;

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

function hostsInGroup(groupId) {
  return orderedHostsInGroup(groupId).filter(matchesHost);
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

function hostRowHTML(host) {
  const active = activeTab()?.hostId === host.id;
  const selected = state.selectedHostId === host.id;
  return `
    <div class="host-row ${active ? "active" : ""} ${selected ? "selected" : ""}" tabindex="0" data-host="${esc(host.id)}" data-sort-host="${esc(host.id)}" draggable="true" aria-label="${esc(host.name || host.address)}，单击选中，双击连接，拖动调整同组主机顺序" title="${esc(host.username)}@${esc(host.address)}:${host.port} · 双击连接 · 拖动排序">
      <div class="host-avatar">${hostSymbol(host)}</div>
      <div class="host-meta">
        <div class="host-name">${esc(host.name || host.address)}</div>
        <div class="host-addr">${esc(host.username)}@${esc(host.address)}:${host.port}</div>
      </div>
      <div class="host-actions">
        <button class="icon-btn" data-act="terminal" title="连接" aria-label="连接">${icon("terminal")}</button>
        <button class="icon-btn" data-act="sftp" title="文件" aria-label="文件">${icon("folder")}</button>
        <button class="icon-btn" data-act="edit" title="编辑" aria-label="编辑">${icon("edit")}</button>
      </div>
    </div>`;
}

function groupNodeHTML(group) {
  const kids = childGroups(group.id);
  const hosts = hostsInGroup(group.id);
  const open = state.expanded.has(group.id);
  const total = hosts.length + kids.reduce((n, g) => n + hostsInGroup(g.id).length, 0);
  if (state.filter && hosts.length === 0 && kids.length === 0) return "";

  return `
    <div class="group-node">
      <div class="group-head" tabindex="0" aria-expanded="${open}" data-group="${esc(group.id)}" data-sort-group="${esc(group.id)}" draggable="true" title="拖动调整同级分组顺序">
        <span class="group-caret ${open ? "open" : ""}">${icon("chevron")}</span>
        <span>${esc(group.name)}</span>
        <span class="group-count">${total}</span>
        <button class="icon-btn" data-act="edit-group" title="重命名分组">${icon("edit")}</button>
        <button class="icon-btn" data-act="del-group" title="删除分组">${icon("close")}</button>
      </div>
      <div class="group-body" style="${open ? "" : "display:none"}">
        ${kids.map(groupNodeHTML).join("")}
        ${hosts.map(hostRowHTML).join("")}
      </div>
    </div>`;
}

function renderSidebar() {
  const ungrouped = hostsInGroup("");
  const roots = childGroups("");
  const html = [];

  if (roots.length === 0 && ungrouped.length === 0) {
    html.push(
      `<div class="tree-empty">${
        state.filter ? "未找到匹配的主机。" : "还没有主机。<br />新建一台主机，开始连接。"
      }</div>`
    );
  } else {
    html.push(roots.map(groupNodeHTML).join(""));
    if (ungrouped.length) {
      html.push(
        `<div class="group-head" style="cursor:default"><span class="group-caret"></span><span>未分组</span><span class="group-count">${ungrouped.length}</span></div>`
      );
      html.push(ungrouped.map(hostRowHTML).join(""));
    }
  }
  $("#tree").innerHTML = html.join("");
  $("#host-count").textContent = state.profile.hosts.length;
  renderDashboard();
}

function hostCardHTML(host, groupName) {
  const name = host.name || host.address;
  return `<article class="host-card" data-host="${esc(host.id)}" data-sort-host="${esc(host.id)}" draggable="true" title="拖动调整同组主机顺序">
    <span class="host-card-symbol" title="${esc(groupName)}">${hostSymbol(host)}</span>
    <div class="host-card-info">
      <span class="host-card-name" title="${esc(name)}">${esc(name)}</span>
      <span class="host-card-address" title="${esc(host.username)}@${esc(host.address)}:${host.port}">${esc(host.address)}:${host.port}</span>
    </div>
    <div class="host-card-foot">
      <button class="icon-btn" data-act="terminal" title="连接" aria-label="连接 ${esc(name)}">${icon("terminal")}</button>
      <button class="icon-btn" data-act="sftp" title="文件" aria-label="管理 ${esc(name)} 的文件">${icon("folder")}</button>
      <button class="icon-btn" data-act="edit" title="编辑" aria-label="编辑 ${esc(name)}">${icon("edit")}</button>
    </div>
  </article>`;
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
  const addSection = (id, name) => {
    const members = (grouped.get(id) || []).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!members.length) return;
    sections.push(`<section class="host-group" aria-label="${esc(name)}">
      <div class="host-group-heading" ${id ? `data-sort-group="${esc(id)}" draggable="true" title="拖动调整同级分组顺序"` : ""}>
        ${icon("folder")}
        <h3 title="${esc(name)}">${esc(name)}</h3>
        <span class="count">${members.length}</span>
      </div>
      <div class="host-grid">${members.map((host) => hostCardHTML(host, name)).join("")}</div>
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
  $("#dashboard-count").textContent = hosts.length;
  $("#host-grid").innerHTML = hosts.length ? sections.join("") : `<div class="onboarding">
    <div class="onboarding-symbol">${icon(state.filter ? "search" : "terminal")}</div>
    <h3>${state.filter ? "未找到匹配的主机" : "添加主机，开始第一次连接"}</h3>
    <p>${state.filter ? "试试其他主机名、地址、用户名或标签。" : "保存服务器信息，即可在这里打开终端、管理远程文件。"}</p>
    <button class="btn" data-act="${state.filter ? "clear-search" : "new-host"}">${icon(state.filter ? "close" : "plus")}${state.filter ? "清空搜索" : "添加第一台主机"}</button>
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
      <div class="tab ${tab.id === state.activeTabId ? "active" : ""}" tabindex="0" data-tab="${esc(tab.id)}" title="${esc(tab.title)} · ${tabStatusLabel(tab)}">
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
  $("#btn-workspace").setAttribute("aria-pressed", String(!current));
  $("#workspace-title").textContent = current ? current.title : "主机连接";
  $("#workspace-context").textContent = current
    ? `${current.kind === "sftp" ? "文件传输" : "SSH 终端"} / ${tabStatusLabel(current)}`
    : "本地工作区";
  const connected = state.tabs.filter((tab) => tab.status === "connected").length;
  $("#session-summary").textContent = state.tabs.length
    ? `${connected} 个已连接 · 共 ${state.tabs.length} 个会话`
    : "暂无活动会话";
  $(".workspace-footer").classList.toggle("has-connections", connected > 0);
}

function setActiveTab(id) {
  state.activeTabId = id;
  for (const tab of state.tabs) {
    tab.paneEl?.classList.toggle("hidden", tab.id !== id);
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

function openTerminalTab(host) {
  const tab = {
    id: nextTabId(),
    kind: "terminal",
    hostId: host.id,
    title: host.name || host.address,
    status: "connecting",
    error: "",
    disposed: false,
  };

  const pane = document.createElement("div");
  pane.className = "pane hidden";
  pane.innerHTML = `
    <div class="term-banner" data-banner style="display:none"></div>
    <div class="term-host" data-termhost></div>`;
  $("#panes").appendChild(pane);
  tab.paneEl = pane;

  const term = new Terminal({
    fontFamily: cssVar("--mono", 'Consolas, "Microsoft YaHei UI", monospace'),
    fontSize: cssPx("--fs-md", 14),
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
    }
    // Workspace shortcuts must not also send control characters to the shell.
    return !(event.ctrlKey || event.metaKey) || !["f", "k", "w"].includes(event.key.toLowerCase());
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(pane.querySelector("[data-termhost]"));
  tab.term = term;
  tab.fit = fit;

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
}

/* =================================================================== sftp */

function openSftpTab(host) {
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
    remotePath: "",
    localEntries: [],
    remoteEntries: [],
    localSel: null,
    remoteSel: null,
    localError: "",
    remoteError: "",
  };

  const pane = document.createElement("div");
  pane.className = "pane hidden";
  pane.innerHTML = `
    <div class="sftp-toolbar">
      <span class="sftp-target">SFTP · ${esc(host.username)}@${esc(host.address)}:${host.port}</span>
      <span class="spacer"></span>
      <button class="icon-btn" data-act="upload" title="上传选中项到远端" aria-label="上传">${icon("upload")}</button>
      <button class="icon-btn" data-act="download" title="下载选中项到本地" aria-label="下载">${icon("download")}</button>
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
        <div class="sftp-columns"><span>名称</span><span class="c-size">大小</span><span class="c-date">修改时间</span></div>
        <div class="file-list" data-list></div>
      </section>
      <section class="sftp-pane" data-side="remote">
        <div class="sftp-side-label">${icon("server")} 远程文件 <span>${esc(host.name || host.address)}</span></div>
        <div class="sftp-pane-head">
          <button class="icon-btn" data-act="up" title="上一级目录">${icon("up")}</button>
          <button class="icon-btn" data-act="refresh" title="刷新">${icon("refresh")}</button>
          <input class="sftp-path" data-path spellcheck="false" aria-label="远程路径" />
          <button class="icon-btn" data-act="mkdir" title="新建文件夹">${icon("folderPlus")}</button>
          <button class="icon-btn" data-act="rename" title="重命名">${icon("edit")}</button>
          <button class="icon-btn" data-act="delete" title="删除">${icon("trash")}</button>
        </div>
        <div class="sftp-columns"><span>名称</span><span class="c-size">大小</span><span class="c-date">修改时间</span></div>
        <div class="file-list" data-list></div>
      </section>
    </div>`;
  $("#panes").appendChild(pane);
  tab.paneEl = pane;

  state.tabs.push(tab);
  setActiveTab(tab.id);

  wireSftpPane(tab, "local");
  wireSftpPane(tab, "remote");

  // Local pane starts at the user's disk root, while the dropdown exposes all
  // mounted Windows drives for quick navigation.
  Promise.all([LocalHome(), LocalDrives()])
    .then(([home, drives]) => {
      tab.localDrives = drives || [];
      const drive = tab.localDrives.find((root) => home.toLowerCase().startsWith(root.toLowerCase())) || tab.localDrives[0];
      tab.localPath = drive || home;
      renderDriveSelect(tab);
      return refreshSide(tab, "local");
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
      tab.remotePath = home;
      return refreshSide(tab, "remote");
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

function wireSftpPane(tab, side) {
  const pane = tab.paneEl.querySelector(`[data-side="${side}"]`);
  const pathInput = pane.querySelector("[data-path]");
  const list = pane.querySelector("[data-list]");
  const drives = pane.querySelector("[data-drives]");

  drives?.addEventListener("change", (e) => {
    if (side === "local" && e.target.value) navigate(tab, side, e.target.value);
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
      case "mkdir":
        mkdirPrompt(tab, side, current);
        break;
      case "rename":
        if (!sel) return toast("请先选择要重命名的文件或文件夹。", "info", 2500);
        renamePrompt(tab, side, sel);
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
    selectFile(entry);
  });

  list.addEventListener("dblclick", (e) => {
    if (e.target.closest("[data-open-dir]")) return;
    const row = e.target.closest("[data-name]");
    if (!row) return;
    const entry = tab[`${side}Entries`].find((x) => x.name === row.dataset.name);
    if (entry?.isDir) navigate(tab, side, entry.path);
  });

  list.addEventListener("keydown", (e) => {
    if (!e.target.matches(".file-row") || !["Enter", " "].includes(e.key)) return;
    e.preventDefault();
    if (e.repeat) return;
    const entry = tab[`${side}Entries`].find(x => x.name === e.target.dataset.name);
    if (e.key === "Enter" && entry?.isDir) navigate(tab, side, entry.path);
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

async function refreshSide(tab, side) {
  if (side === "remote" && !tab.sessionId) return;
  const target = tab[`${side}Path`] || (await (side === "local" ? LocalHome() : SftpHome(tab.sessionId)));
  await navigate(tab, side, target);
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

function renderFileList(tab, side) {
  const pane = tab.paneEl.querySelector(`[data-side="${side}"]`);
  const list = pane.querySelector("[data-list]");
  const pathInput = pane.querySelector("[data-path]");
  const entries = tab[`${side}Entries`];
  const current = tab[`${side}Path`];
  const error = tab[`${side}Error`];

  if (pathInput.value !== current) pathInput.value = current;
  if (side === "local") renderDriveSelect(tab);

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
        <div class="file-row ${entry.name === selected ? "selected" : ""}" data-name="${esc(entry.name)}" draggable="true" tabindex="0" title="${entry.isDir ? "单击名称或双击此行打开；拖到另一侧传输" : "拖到另一侧传输"}；单击选中">
        <span class="file-icon ${entry.isDir ? "is-directory" : ""}">${icon(entry.isDir ? "folder" : "file")}</span>
        ${entry.isDir ? `<button class="file-name directory-open" data-open-dir title="打开 ${esc(entry.name)}" aria-label="打开目录 ${esc(entry.name)}">${esc(entry.name)}</button>` : `<span class="file-name" title="${esc(entry.name)}">${esc(entry.name)}</span>`}
        <span class="file-size">${entry.isDir ? "" : humanSize(entry.size)}</span>
        <span class="file-date">${esc(entry.modTime)}</span>
      </div>`
    )
    .join("");
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
        <div><div class="modal-title">${icon("server")}${editing ? "编辑主机" : "新建主机"}</div><div class="modal-subtitle">配置服务器地址与身份验证方式。</div></div>
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
            ${themes.map(t => `<button class="theme-choice" data-theme-choice="${t.id}" aria-pressed="${t.id === state.appearance.theme}" style="--preview-bg:${t.colors[0]};--preview-text:${t.colors[7]};--preview-accent:${t.colors[10]}"><span class="theme-preview" aria-hidden="true"><span></span><i></i><i></i></span><span>${t.name}</span></button>`).join("")}
          </div>
        </div>
        <div class="field">
          <label for="appearance-opacity">背景不透明度 <output id="opacity-value" for="appearance-opacity">${state.appearance.opacity}%</output></label>
          <input id="appearance-opacity" type="range" min="65" max="100" step="1" value="${state.appearance.opacity}" />
          <div class="hint">向左调整更通透，100% 为实色。文字保持清晰；窗口毛玻璃效果受 Windows 版本及系统透明效果设置影响。</div>
        </div>
        <div class="appearance-actions"><span class="hint">主题与透明度自动保存，下次启动沿用。</span><button class="btn btn-sm" data-act="reset-appearance">恢复默认</button></div>
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
      state.appearance = themeId ? { ...state.appearance, theme: themeId } : { theme: "graphite", opacity: 100 };
      updateAppearance();
      for (const button of backdrop.querySelectorAll("[data-theme-choice]")) {
        button.setAttribute("aria-pressed", String(button.dataset.themeChoice === state.appearance.theme));
      }
      backdrop.querySelector("#appearance-opacity").value = state.appearance.opacity;
      backdrop.querySelector("#opacity-value").textContent = `${state.appearance.opacity}%`;
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
  const opacity = backdrop.querySelector("#appearance-opacity");
  opacity.addEventListener("input", () => {
    state.appearance.opacity = Number(opacity.value);
    backdrop.querySelector("#opacity-value").textContent = `${state.appearance.opacity}%`;
    updateAppearance();
  });
  opacity.addEventListener("change", persistAppearance);
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
    return element.classList.contains("host-card")
      ? event.clientX > rect.left + rect.width / 2
      : event.clientY > rect.top + rect.height / 2;
  };

  for (const selector of ["#tree", "#host-grid"]) {
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
  $("#btn-workspace").addEventListener("click", () => setActiveTab(null));
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

  $("#btn-new-host").addEventListener("click", () => hostEditor(null));
  $("#btn-empty-new").addEventListener("click", () => hostEditor(null));
  $("#btn-new-group").addEventListener("click", () => groupEditor(null));
  $("#btn-settings").addEventListener("click", openSettings);

  $("#host-grid").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "new-host") return hostEditor(null);
    if (act === "clear-search") {
      state.filter = "";
      $("#search").value = "";
      renderSidebar();
      $("#search").focus();
      return;
    }
    const hostId = e.target.closest("[data-host]")?.dataset.host;
    const host = state.profile.hosts.find((h) => h.id === hostId);
    if (!host) return;
    if (act === "terminal") openTerminalTab(host);
    if (act === "sftp") openSftpTab(host);
    if (act === "edit") hostEditor(host);
  });

  // Space selects a host; Enter connects. Nested buttons keep native activation.
  for (const selector of ["#tree", "#tabstrip"]) {
    $(selector).addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (!e.target.matches(".host-row, .group-head[data-group], .tab")) return;
      e.preventDefault();
      if (e.repeat) return;
      if (e.target.matches(".host-row") && e.key === "Enter") {
        selectHost(e.target.dataset.host);
        const host = state.profile.hosts.find(h => h.id === e.target.dataset.host);
        if (host) openTerminalTab(host);
        return;
      }
      e.target.click();
    });
  }

  $("#tree").addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;

    if (act) {
      const hostId = e.target.closest("[data-host]")?.dataset.host;
      const groupId = e.target.closest("[data-group]")?.dataset.group;
      const host = state.profile.hosts.find((h) => h.id === hostId);

      if (act === "terminal" && host) return openTerminalTab(host);
      if (act === "sftp" && host) return openSftpTab(host);
      if (act === "edit" && host) return hostEditor(host);

      if (act === "edit-group" && groupId) {
        const group = state.profile.groups.find((g) => g.id === groupId);
        return groupEditor(group);
      }
      if (act === "del-group" && groupId) {
        const group = state.profile.groups.find((g) => g.id === groupId);
        const ok = await confirmDialog({
          title: "删除分组",
          message: `确定删除分组“${group.name}”？组内主机将移至“未分组”。`,
          confirmLabel: "删除",
        });
        if (ok) {
          try {
            await DeleteGroup(groupId);
            await reloadProfile();
          } catch (err) {
            fail(err, "删除分组失败");
          }
        }
        return;
      }
      return;
    }

    const groupHead = e.target.closest("[data-group]");
    if (groupHead) {
      const id = groupHead.dataset.group;
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      renderSidebar();
      return;
    }

    const hostRow = e.target.closest("[data-host]");
    if (hostRow) {
      selectHost(hostRow.dataset.host);
    }
  });

  $("#tree").addEventListener("dblclick", (e) => {
    if (e.target.closest("button")) return;
    const row = e.target.closest(".host-row");
    const host = state.profile.hosts.find(h => h.id === row?.dataset.host);
    if (host) {
      selectHost(host.id);
      openTerminalTab(host);
    }
  });

  $("#tree").addEventListener("contextmenu", (e) => {
    const hostRow = e.target.closest("[data-host]");
    if (hostRow) {
      e.preventDefault();
      const host = state.profile.hosts.find((h) => h.id === hostRow.dataset.host);
      if (host) hostEditor(host);
    }
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
    if ((e.ctrlKey || e.metaKey) && ["f", "k"].includes(e.key.toLowerCase()) && !$("#modal-root").children.length) {
      e.preventDefault();
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

    // Refresh the destination pane once when a transfer lands.
    if (task.status === "done" && prev?.status !== "done") {
      const tab = state.tabs.find((t) => t.sessionId === task.sessionId);
      // The tab may have closed while the transfer was finishing.
      if (tab) refreshSide(tab, task.kind === "upload" ? "remote" : "local").catch(() => {});
    }
    if (task.status === "failed" && prev?.status !== "failed") {
      toast(`${task.kind === "upload" ? "上传" : "下载"}失败：${task.name} — ${task.error}`, "error", 7000);
    }

    // Only a new task re-opens the panel; hiding it must stick while the
    // remaining transfers keep reporting progress.
    if (!prev) showTransferPanel();
    renderTransfers();
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

function renderTransfers() {
  const tasks = [...state.transfers.values()];
  const active = tasks.filter((t) => t.status === "queued" || t.status === "running").length;
  $("#transfer-summary").textContent = active
    ? `${active} 项进行中 · 共 ${tasks.length} 项`
    : tasks.length
      ? `共 ${tasks.length} 项`
      : "暂无传输任务";

  $("#transfer-list").innerHTML = tasks
    .map((task) => {
      const pct = task.total > 0 ? Math.min(100, (task.done / task.total) * 100) : task.status === "done" ? 100 : 0;
      const actions =
        task.status === "queued" || task.status === "running"
          ? `<button class="icon-btn" data-act="cancel" data-task="${esc(task.id)}" title="取消">${icon("close")}</button>`
          : task.status === "done"
            ? ""
            : `<button class="icon-btn" data-act="retry" data-task="${esc(task.id)}" title="重试">${icon("refresh")}</button>`;
      return `
        <div class="transfer-row ${esc(task.status)}">
          ${icon(task.kind === "upload" ? "upload" : "download")}
          <div class="transfer-main">
            <div class="transfer-name" title="${esc(task.name)}">${esc(task.name)}</div>
            <div class="transfer-meta">
              <div class="transfer-track"><div class="transfer-fill${task.status === "failed" ? " failed" : ""}" style="width:${pct}%"></div></div>
              <span class="transfer-state" title="${esc(transferMeta(task))}">${esc(transferMeta(task))}</span>
            </div>
          </div>
          <span>${actions}</span>
        </div>`;
    })
    .join("");
}

/* ==================================================================== init */

async function init() {
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
  for (const row of document.querySelectorAll("#tree .host-row")) {
    row.classList.toggle("selected", row.dataset.host === id);
  }
}
