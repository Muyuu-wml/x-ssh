// 纯色色板：文字强调色与实色按钮分开，兼顾鲜明程度和文字对比度。
const keys = ["bg", "sidebar-bg", "surface", "surface-2", "surface-3", "border", "border-soft", "text", "text-dim", "text-faint", "primary", "primary-hi", "selected", "danger", "warning", "success"];
export const themes = [
  { id: "graphite", name: "Navy · 深海", fill: "#2563eb", accent2: "#53d99b", accent3: "#bd98ff", colors: ["#1b2330", "#111925", "#29364a", "#32425a", "#3c4e68", "#485b77", "#34445a", "#f3f6fc", "#bac8dc", "#9dadc4", "#68a9ff", "#85baff", "#30486b", "#ff9696", "#ffbd59", "#53d99b"] },
  { id: "vscode", name: "VS Code · 深邃现代", fill: "#0078d4", accent2: "#42d392", accent3: "#bc8cff", colors: ["#202124", "#151619", "#2d3035", "#363b42", "#444b54", "#505862", "#3b4149", "#f0f2f5", "#bec5ce", "#a0aab7", "#59acff", "#80beff", "#294969", "#ff8b82", "#ffb454", "#42d392"] },
  { id: "github", name: "GitHub · 暗夜", fill: "#1f6feb", accent2: "#4cce86", accent3: "#b387ff", colors: ["#151b23", "#0d1117", "#212a36", "#2a3543", "#354353", "#465568", "#303e4e", "#f0f6fc", "#bac6d4", "#9ba9ba", "#58a6ff", "#79b8ff", "#263e5c", "#ff8a80", "#ffb84d", "#4cce86"] },
  { id: "nord", name: "Nord · 北欧", fill: "#356baf", accent2: "#6ee7b7", accent3: "#d0a7ff", colors: ["#2e3440", "#242b36", "#3b4252", "#434c5e", "#4c566a", "#5d6b83", "#485468", "#eceff4", "#d8dee9", "#c0c8d7", "#8fc5ff", "#a3d0ff", "#434c5e", "#ffb0b3", "#ffd080", "#6ee7b7"] },
  { id: "mocha", name: "Catppuccin · 摩卡", fill: "#7c3aed", accent2: "#54d8ab", accent3: "#ed91c9", colors: ["#1e1e2e", "#181825", "#2b2b40", "#36364e", "#45475a", "#55576e", "#3d3e55", "#e4e9ff", "#bac2de", "#a6adc8", "#c296ff", "#d0b0ff", "#45475a", "#ff92ae", "#ffc66b", "#54d8ab"] },
  { id: "tokyo", name: "Tokyo Night · 东京夜", fill: "#315cd6", accent2: "#4fd6a0", accent3: "#bb91ff", colors: ["#1a1b26", "#16161e", "#292d43", "#343a54", "#414967", "#515b7c", "#373f5b", "#dae2ff", "#b3bee0", "#97a3ca", "#7aa2ff", "#99b8ff", "#33467c", "#ff8ca4", "#ffb95c", "#4fd6a0"] },
  { id: "dracula", name: "Dracula · 德古拉", fill: "#8044d6", accent2: "#61d9a0", accent3: "#f18dc1", colors: ["#22232e", "#191a23", "#303242", "#3a3d50", "#484c62", "#595e78", "#41465a", "#f8f8f2", "#c3c7d1", "#a8aebf", "#bd93ff", "#d0afff", "#44475a", "#ff9797", "#ffcf65", "#61d9a0"] },
  { id: "onedark", name: "One Dark · 原子", fill: "#2868c7", accent2: "#58d494", accent3: "#c78cf0", colors: ["#21252b", "#1b1f24", "#2e3440", "#39414e", "#454e60", "#535f72", "#3d4758", "#e2e7f0", "#b7c0cf", "#a0acbe", "#61afff", "#8ac3ff", "#3e4451", "#ff959e", "#ffc164", "#58d494"] },
  { id: "gruvbox", name: "Gruvbox · 复古暖", fill: "#9c5700", accent2: "#8dcb75", accent3: "#e291bb", colors: ["#242322", "#191c1d", "#32302f", "#3c3836", "#48423e", "#625950", "#49423c", "#f3e6c6", "#d2c3a5", "#b6a790", "#ffc24b", "#ffd479", "#3c3836", "#ff9980", "#ffc24b", "#aacc62"] },
  { id: "latte", name: "Catppuccin · 拿铁（浅色）", light: true, fill: "#2563eb", accent2: "#137548", accent3: "#793bc5", colors: ["#eff1f5", "#e1e6ee", "#ffffff", "#e9edf4", "#dce3ed", "#b5c0d0", "#cdd6e2", "#233047", "#4e5d74", "#5e6d84", "#245dcc", "#194bb2", "#dbe7fa", "#bc303c", "#975600", "#137548"] },
];
const storageKey = "x-ssh.appearance.v1";
export function normalizeAppearance(value = {}) {
  const theme = themes.some(t => t.id === value?.theme) ? value.theme : "graphite";
  const opacity = typeof value?.opacity === "number" && Number.isFinite(value.opacity)
    ? Math.max(65, Math.min(100, Math.round(value.opacity))) : 100;
  return { theme, opacity };
}
export function loadAppearance() {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(storageKey))); }
  catch { return normalizeAppearance(); }
}
export function saveAppearance(value) {
  localStorage.setItem(storageKey, JSON.stringify(normalizeAppearance(value)));
}
export function applyAppearance(value) {
  const { theme: id, opacity } = normalizeAppearance(value);
  const theme = themes.find(t => t.id === id);
  const root = document.documentElement;
  root.dataset.theme = id;
  root.style.colorScheme = theme.light ? "light" : "dark";
  const tokens = Object.fromEntries(keys.map((key, i) => [key, theme.colors[i]]));
  Object.assign(tokens, {
    "primary-fill": theme.fill, "primary-fill-hover": `color-mix(in srgb, ${theme.fill} 86%, #000000)`,
    "on-accent": "#ffffff",
    /* 选中面掺入主题强调色，和 hover 拉开区分 */
    "selected": `color-mix(in srgb, ${tokens.primary} 14%, ${tokens.surface})`,
    "text-on-selected": tokens["text-dim"], "focus-ring": tokens.primary,
    "danger-text": tokens.danger, "danger-soft": `${tokens.danger}20`,
    "term-selection": `${tokens.primary}50`, "scrollbar": tokens.border,
    "scrollbar-hover": tokens["text-faint"],
    "glass-bg": rgba(tokens.bg, opacity / 100),
    "glass-sidebar": rgba(tokens["sidebar-bg"], opacity / 100),
    "accent-2": theme.accent2, "accent-3": theme.accent3,
    "accent-2-fill": theme.light ? theme.accent2 : `color-mix(in srgb, ${theme.accent2} 55%, #000000)`,
    "accent-3-fill": theme.light ? theme.accent3 : `color-mix(in srgb, ${theme.accent3} 60%, #000000)`,
    "term-magenta": theme.accent3,
    "term-cyan": theme.accent2,
    "term-black": theme.light ? "#4c4f69" : tokens.bg,
  });
  for (const [key, color] of Object.entries(tokens)) root.style.setProperty(`--${key}`, color);
}
function rgba(hex, alpha) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${rgb.join(",")},${alpha})`;
}
