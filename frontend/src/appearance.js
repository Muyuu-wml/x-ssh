/* =================================================================== themes
 *
 * 每个主题用具名字段描述自己的颜色，applyAppearance 负责把它们翻译成
 * CSS 变量。这样新增或调整主题时不用记颜色在数组里的下标顺序。
 *
 * 只保留一黑一白两套：黑色是 Monokai 经典配色，白色是拿铁浅色。
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
    // Monokai 的辨识度来自暖灰黑底 + 粉/绿/黄/青/紫这套高饱和前景色。
    // 强调色用青色（#66d9ef）：它是 Monokai 里少有的高对比色，
    // 粉色留给 danger，绿色留给 success，终端 ANSI 才对得上。
    id: "monokai",
    name: "Monokai · 经典",
    fill: "#66d9ef",
    accent2: "#a6e22e",
    accent3: "#ae81ff",
    canvas: "#272822",
    sidebar: "#1f201b",
    surface: "#30312b",
    surface2: "#3a3b33",
    surface3: "#46473c",
    line: "#4b4c40",
    lineSoft: "#36372e",
    text: "#f8f8f2",
    textDim: "#c8c8ba",
    textMuted: "#9a9b8c",
    accent: "#66d9ef",
    accentHi: "#9be9f7",
    onAccent: "#1b1c17",
    danger: "#f92672",
    warning: "#e6db74",
    success: "#a6e22e",
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
  const theme = themes.some((t) => t.id === value?.theme) ? value.theme : "monokai";
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
  // 必须写在 body 上：写在 :root 会让 Chromium 用主题底色铺满窗口画布，
  // 透明窗口就变成实心了（原生控件配色仍然生效，因为 color-scheme 会继承）。
  document.body.style.colorScheme = theme.light ? "light" : "dark";

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
