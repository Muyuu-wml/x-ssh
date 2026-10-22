// Palette references and adaptation notes: docs/design-system.md.
const keys = ["bg", "sidebar-bg", "surface", "surface-2", "surface-3", "border", "border-soft", "text", "text-dim", "text-faint", "primary", "primary-hi", "selected", "danger", "warning", "success"];
export const themes = [
  { id: "graphite", name: "石墨黑", colors: ["#14161a", "#181b20", "#1f2329", "#2a2f37", "#363c46", "#363c46", "#272b32", "#eceef2", "#a9b0bd", "#969eae", "#54a6ff", "#83bfff", "#2e333b", "#ff7b7b", "#fbbf24", "#34d399"] },
  { id: "vscode", name: "VS Code · 深邃现代", colors: ["#1f1f1f", "#181818", "#252526", "#2d2d30", "#383838", "#454545", "#2b2b2b", "#cccccc", "#b0b0b0", "#a0a0a0", "#75beff", "#a6d5ff", "#37373d", "#f48771", "#dcdcaa", "#89d185"] },
  { id: "github", name: "GitHub · 暗夜", colors: ["#0d1117", "#010409", "#161b22", "#21262d", "#30363d", "#30363d", "#21262d", "#e6edf3", "#b1bac4", "#9da7b3", "#58a6ff", "#a5d6ff", "#263447", "#ff7b72", "#e3b341", "#3fb950"] },
  { id: "nord", name: "Nord · 北欧", colors: ["#2e3440", "#272d38", "#3b4252", "#434c5e", "#4c566a", "#4c566a", "#434c5e", "#eceff4", "#d8dee9", "#c0c8d7", "#88c0d0", "#8fbcbb", "#434c5e", "#e58b95", "#ebcb8b", "#a3be8c"] },
  { id: "mocha", name: "Catppuccin · 摩卡", colors: ["#1e1e2e", "#181825", "#262637", "#313244", "#45475a", "#45475a", "#313244", "#cdd6f4", "#bac2de", "#a6adc8", "#cba6f7", "#b4befe", "#45475a", "#f38ba8", "#f9e2af", "#a6e3a1"] },
  { id: "tokyo", name: "Tokyo Night · 东京夜", colors: ["#1a1b26", "#16161e", "#222436", "#2d3048", "#3b4261", "#3b4261", "#292e42", "#c0caf5", "#9aa5ce", "#7e86a8", "#7aa2f7", "#b4f9f8", "#33467c", "#f7768e", "#e0af68", "#9ece6a"] },
  { id: "dracula", name: "Dracula · 德古拉", colors: ["#1e1f29", "#191a21", "#282a36", "#343746", "#44475a", "#44475a", "#2f323f", "#f8f8f2", "#c3c7d1", "#9ea3b0", "#bd93f9", "#ff79c6", "#44475a", "#ff5555", "#f1fa8c", "#50fa7b"] },
  { id: "onedark", name: "One Dark · 原子", colors: ["#21252b", "#1b1f24", "#282c34", "#323842", "#3e4451", "#3e4451", "#2c313a", "#abb2bf", "#9198a5", "#7a818e", "#61afef", "#c678dd", "#3e4451", "#e06c75", "#e5c07b", "#98c379"] },
  { id: "gruvbox", name: "Gruvbox · 复古暖", colors: ["#1d2021", "#191c1d", "#282828", "#32302f", "#3c3836", "#504945", "#2e2c2b", "#ebdbb2", "#c9b98f", "#a89984", "#fabd2f", "#fe8019", "#3c3836", "#fb4934", "#d79921", "#b8bb26"] },
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
    /* 选中面掺入主题强调色，和 hover 拉开区分 */
    "selected": `color-mix(in srgb, ${tokens.primary} 14%, ${tokens.surface})`,
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
