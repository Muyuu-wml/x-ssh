/* =================================================================== themes
 *
 * 每个主题用具名字段描述自己的颜色，applyAppearance 负责把它们翻译成
 * CSS 变量。这样新增或调整主题时不用记颜色在数组里的下标顺序。
 *
 * 语义层级（从深到浅）：
 *   canvas    应用底色
 *   sidebar   侧栏底色（比 canvas 更深，让侧栏"沉"下去）
 *   surface   卡片 / 面板
 *   surface2  卡片内的次级块、列表项 hover
 *   surface3  最高一层（按钮 hover、选中块）
 *   line      可见边框
 *   lineSoft  发丝级分隔线
 * ------------------------------------------------------------------------ */
export const themes = [
  {
    id: "graphite",
    name: "Graphite · 石墨",
    fill: "#3f7cf5",
    accent2: "#3fcf8e",
    accent3: "#b388ff",
    canvas: "#14171c",
    sidebar: "#0e1014",
    surface: "#1b1f26",
    surface2: "#232830",
    surface3: "#2c333e",
    line: "#2b313b",
    lineSoft: "#20252e",
    text: "#e9ecf1",
    textDim: "#a5adba",
    textMuted: "#6f7887",
    accent: "#6aa1ff",
    accentHi: "#93b9ff",
    onAccent: "#ffffff",
    danger: "#ff6b6b",
    warning: "#f2b544",
    success: "#3fcf8e",
  },
  {
    id: "vscode",
    name: "VS Code · 深邃现代",
    fill: "#0e639c",
    accent2: "#89d185",
    accent3: "#c586c0",
    canvas: "#1f1f1f",
    sidebar: "#181818",
    surface: "#252526",
    surface2: "#2d2d2d",
    surface3: "#373737",
    line: "#333333",
    lineSoft: "#292929",
    text: "#cccccc",
    textDim: "#9d9d9d",
    textMuted: "#6e6e6e",
    accent: "#4daafc",
    accentHi: "#75c2ff",
    onAccent: "#ffffff",
    danger: "#f48771",
    warning: "#cca700",
    success: "#89d185",
  },
  {
    id: "github",
    name: "GitHub · 暗夜",
    fill: "#1f6feb",
    accent2: "#3fb950",
    accent3: "#bc8cff",
    canvas: "#0d1117",
    sidebar: "#010409",
    surface: "#161b22",
    surface2: "#1f262e",
    surface3: "#2b323b",
    line: "#30363d",
    lineSoft: "#21262d",
    text: "#e6edf3",
    textDim: "#9198a1",
    textMuted: "#6e7681",
    accent: "#58a6ff",
    accentHi: "#79c0ff",
    onAccent: "#ffffff",
    danger: "#f85149",
    warning: "#d29922",
    success: "#3fb950",
  },
  {
    id: "nord",
    name: "Nord · 北欧",
    fill: "#5e81ac",
    accent2: "#a3be8c",
    accent3: "#b48ead",
    canvas: "#2e3440",
    sidebar: "#272c36",
    surface: "#3b4252",
    surface2: "#434c5e",
    surface3: "#4c566a",
    line: "#4c566a",
    lineSoft: "#39404e",
    text: "#eceff4",
    textDim: "#d8dee9",
    textMuted: "#aeb8c8",
    accent: "#88c0d0",
    accentHi: "#a8d4e2",
    onAccent: "#ffffff",
    danger: "#bf616a",
    warning: "#e5c07b",
    success: "#a3be8c",
  },
  {
    id: "mocha",
    name: "Catppuccin · 摩卡",
    fill: "#7c6cf0",
    accent2: "#a6e3a1",
    accent3: "#f5c2e7",
    canvas: "#1e1e2e",
    sidebar: "#181825",
    surface: "#2a2a3c",
    surface2: "#313244",
    surface3: "#3d3d55",
    line: "#45475a",
    lineSoft: "#313244",
    text: "#cdd6f4",
    textDim: "#a6adc8",
    textMuted: "#7f849c",
    accent: "#89b4fa",
    accentHi: "#b4befe",
    onAccent: "#ffffff",
    danger: "#f38ba8",
    warning: "#f9e2af",
    success: "#a6e3a1",
  },
  {
    id: "tokyo",
    name: "Tokyo Night · 东京夜",
    fill: "#3d59a1",
    accent2: "#9ece6a",
    accent3: "#bb9af7",
    canvas: "#1a1b26",
    sidebar: "#16161e",
    surface: "#24283b",
    surface2: "#2f334d",
    surface3: "#3b4261",
    line: "#3b4261",
    lineSoft: "#292e42",
    text: "#c0caf5",
    textDim: "#9aa5ce",
    textMuted: "#717c9f",
    accent: "#7aa2f7",
    accentHi: "#a3c1f2",
    onAccent: "#ffffff",
    danger: "#f7768e",
    warning: "#e0af68",
    success: "#9ece6a",
  },
  {
    id: "dracula",
    name: "Dracula · 德古拉",
    fill: "#7c4ddb",
    accent2: "#50fa7b",
    accent3: "#ff79c6",
    canvas: "#21222c",
    sidebar: "#1a1b24",
    surface: "#2c2f3d",
    surface2: "#363a4a",
    surface3: "#44475a",
    line: "#44475a",
    lineSoft: "#323441",
    text: "#f8f8f2",
    textDim: "#b8bac4",
    textMuted: "#7f83a0",
    accent: "#bd93f9",
    accentHi: "#d6bfff",
    onAccent: "#ffffff",
    danger: "#ff5555",
    warning: "#f1fa8c",
    success: "#50fa7b",
  },
  {
    id: "onedark",
    name: "One Dark · 原子",
    fill: "#3d78c4",
    accent2: "#98c379",
    accent3: "#c678dd",
    canvas: "#21252b",
    sidebar: "#1b1f24",
    surface: "#282c34",
    surface2: "#303540",
    surface3: "#3a3f4b",
    line: "#3a3f4b",
    lineSoft: "#2a2e37",
    text: "#abb2bf",
    textDim: "#828997",
    textMuted: "#5c6370",
    accent: "#61afef",
    accentHi: "#88c8f5",
    onAccent: "#ffffff",
    danger: "#e06c75",
    warning: "#d19a66",
    success: "#98c379",
  },
  {
    id: "gruvbox",
    name: "Gruvbox · 复古暖",
    fill: "#b5761f",
    accent2: "#a9b665",
    accent3: "#d3869b",
    canvas: "#282828",
    sidebar: "#1d2021",
    surface: "#32302f",
    surface2: "#3c3836",
    surface3: "#504945",
    line: "#5a5248",
    lineSoft: "#3c3836",
    text: "#ebdbb2",
    textDim: "#bdae93",
    textMuted: "#928374",
    accent: "#fabd2f",
    accentHi: "#fee391",
    onAccent: "#282828",
    danger: "#fb4934",
    warning: "#fabd2f",
    success: "#a9b665",
  },
  {
    id: "latte",
    name: "Catppuccin · 拿铁（浅色）",
    light: true,
    fill: "#1e66f5",
    accent2: "#40a02b",
    accent3: "#8839ef",
    canvas: "#eff1f5",
    sidebar: "#e4e7ef",
    surface: "#ffffff",
    surface2: "#f2f4f8",
    surface3: "#e4e7ee",
    line: "#d3d8e0",
    lineSoft: "#e6e9ef",
    text: "#4c4f69",
    textDim: "#6c6f85",
    textMuted: "#8c8fa1",
    accent: "#1e66f5",
    accentHi: "#0b4bc4",
    onAccent: "#ffffff",
    danger: "#d20f39",
    warning: "#df8e1d",
    success: "#40a02b",
  },
];

const storageKey = "x-ssh.appearance.v1";

export function normalizeAppearance(value = {}) {
  const theme = themes.some((t) => t.id === value?.theme) ? value.theme : "graphite";
  return { theme };
}

export function loadAppearance() {
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(storageKey)));
  } catch {
    return normalizeAppearance();
  }
}

export function saveAppearance(value) {
  localStorage.setItem(storageKey, JSON.stringify(normalizeAppearance(value)));
}

/** #rrggbb + alpha -> rgba() */
function rgba(hex, alpha) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${rgb.join(",")},${alpha})`;
}

/**
 * Writes the theme onto :root as CSS variables.
 *
 * Only the semantic tokens live here; every other value (间距、圆角、字号) stays
 * in style.css so there is exactly one place per concern.
 */
export function applyAppearance(value) {
  const { theme: id } = normalizeAppearance(value);
  const theme = themes.find((t) => t.id === id);
  const root = document.documentElement;
  root.dataset.theme = id;
  root.style.colorScheme = theme.light ? "light" : "dark";

  const tokens = {
    bg: theme.canvas,
    "sidebar-bg": theme.sidebar,
    surface: theme.surface,
    "surface-2": theme.surface2,
    "surface-3": theme.surface3,
    border: theme.line,
    "border-soft": theme.lineSoft,
    text: theme.text,
    "text-dim": theme.textDim,
    "text-faint": theme.textMuted,
    primary: theme.accent,
    "primary-hi": theme.accentHi,
    "primary-fill": theme.fill,
    "primary-fill-hover": `color-mix(in srgb, ${theme.fill} 86%, #000000)`,
    "on-accent": theme.onAccent,
    /* 选中面掺入强调色，和 hover 拉开区分 */
    selected: `color-mix(in srgb, ${theme.accent} 13%, ${theme.surface})`,
    "text-on-selected": theme.textDim,
    "focus-ring": theme.accentHi,
    danger: theme.danger,
    "danger-text": theme.danger,
    "danger-soft": rgba(theme.danger, theme.light ? 0.14 : 0.16),
    warning: theme.warning,
    success: theme.success,
    "accent-2": theme.accent2,
    "accent-3": theme.accent3,
    "accent-2-fill": theme.light ? theme.accent2 : `color-mix(in srgb, ${theme.accent2} 52%, #000000)`,
    "accent-3-fill": theme.light ? theme.accent3 : `color-mix(in srgb, ${theme.accent3} 56%, #000000)`,
    /* 终端：画布透明，由面板底色透出 */
    "term-black": theme.light ? "#4c4f69" : theme.canvas,
    "term-magenta": theme.accent3,
    "term-cyan": theme.accent2,
    "term-selection": rgba(theme.accent, 0.28),
    scrollbar: theme.line,
    "scrollbar-hover": theme.textMuted,
  };

  for (const [key, color] of Object.entries(tokens)) {
    root.style.setProperty(`--${key}`, color);
  }
}
