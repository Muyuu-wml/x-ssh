// Palette references and adaptation notes: docs/design-system.md.
const keys = ["bg", "sidebar-bg", "surface", "surface-2", "surface-3", "border", "border-soft", "text", "text-dim", "text-faint", "primary", "primary-hi", "selected", "danger", "warning", "success"];
export const themes = [
  { id: "graphite", name: "石墨黑", colors: ["#17191d", "#1b1d21", "#22252b", "#2b2e35", "#343942", "#343942", "#2a2d34", "#eceef2", "#a9b0bd", "#969eae", "#54a6ff", "#83bfff", "#2e333b", "#ff7b7b", "#fbbf24", "#34d399"] },
  { id: "vscode", name: "VS Code · 深邃现代", colors: ["#1f1f1f", "#181818", "#252526", "#2d2d30", "#383838", "#454545", "#2b2b2b", "#cccccc", "#b0b0b0", "#a0a0a0", "#75beff", "#a6d5ff", "#37373d", "#f48771", "#dcdcaa", "#89d185"] },
  { id: "github", name: "GitHub · 暗夜", colors: ["#0d1117", "#010409", "#161b22", "#21262d", "#30363d", "#30363d", "#21262d", "#e6edf3", "#b1bac4", "#9da7b3", "#58a6ff", "#a5d6ff", "#263447", "#ff7b72", "#e3b341", "#3fb950"] },
  { id: "nord", name: "Nord · 北欧", colors: ["#2e3440", "#272d38", "#3b4252", "#434c5e", "#4c566a", "#4c566a", "#434c5e", "#eceff4", "#d8dee9", "#c0c8d7", "#88c0d0", "#8fbcbb", "#434c5e", "#e58b95", "#ebcb8b", "#a3be8c"] },
  { id: "mocha", name: "Catppuccin · 摩卡", colors: ["#1e1e2e", "#181825", "#262637", "#313244", "#45475a", "#45475a", "#313244", "#cdd6f4", "#bac2de", "#a6adc8", "#cba6f7", "#b4befe", "#45475a", "#f38ba8", "#f9e2af", "#a6e3a1"] },
  { id: "latte", name: "Catppuccin · 拿铁（浅色）", light: true, colors: ["#eff1f5", "#e6e9ef", "#ffffff", "#e6e9ef", "#dce0e8", "#bcc0cc", "#ccd0da", "#4c4f69", "#5c5f77", "#62657d", "#8839ef", "#7287fd", "#dce0e8", "#d20f39", "#8a5900", "#287a18"] },
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
    "primary-fill": tokens.primary, "primary-fill-hover": theme.light ? "#762bd0" : tokens["primary-hi"],
    "on-accent": theme.light ? "#ffffff" : id === "graphite" ? "#101923" : tokens.bg,
    "text-on-selected": id === "graphite" ? "#b0b6c2" : tokens["text-dim"], "focus-ring": tokens.primary,
    "danger-text": tokens.danger, "danger-soft": `${tokens.danger}20`,
    "term-selection": `${tokens.primary}50`, "scrollbar": tokens.border,
    "scrollbar-hover": tokens["text-faint"],
    "glass-bg": rgba(tokens.bg, opacity / 100),
    "glass-sidebar": rgba(tokens["sidebar-bg"], opacity / 100),
    "term-magenta": theme.light ? "#8839ef" : "#cba6f7",
    "term-cyan": theme.light ? "#007f8b" : "#89dceb",
    "term-black": theme.light ? "#4c4f69" : tokens.bg,
  });
  for (const [key, color] of Object.entries(tokens)) root.style.setProperty(`--${key}`, color);
}
function rgba(hex, alpha) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${rgb.join(",")},${alpha})`;
}
