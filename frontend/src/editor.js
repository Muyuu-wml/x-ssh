/* =================================================================== editor
 *
 * 内置远程编辑器的高亮层。用 CodeMirror 6 换掉原来的 textarea：
 * 语法着色、行号、括号匹配都是现成的，主题色全部走 CSS 变量，
 * 所以切换 Monokai / 拿铁时不用重建编辑器。
 *
 * 语言按扩展名挑 legacy stream mode：这些是 CodeMirror 5 的模式移植，
 * 一行 import 就能覆盖常见脚本和配置文件，不需要每个语言一个 lang 包。
 * ------------------------------------------------------------------------ */
import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { css, less, sCSS } from "@codemirror/legacy-modes/mode/css";
import { c, cpp, csharp, dart, java, kotlin, objectiveC, objectiveCpp, scala } from "@codemirror/legacy-modes/mode/clike";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { go } from "@codemirror/legacy-modes/mode/go";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { javascript, json, typescript } from "@codemirror/legacy-modes/mode/javascript";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { python } from "@codemirror/legacy-modes/mode/python";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { sass } from "@codemirror/legacy-modes/mode/sass";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { vbScript } from "@codemirror/legacy-modes/mode/vbscript";
import { html, xml } from "@codemirror/legacy-modes/mode/xml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";

// 扩展名 -> stream mode。没列到的当纯文本（不猜语言，猜错比不着色更烦）。
const modeByExtension = {
  // 脚本与后端
  sh: shell, bash: shell, zsh: shell, ksh: shell, fish: shell,
  go,
  py: python, pyw: python,
  rb: ruby, pl: perl, pm: perl,
  lua,
  ps1: powerShell, psm1: powerShell,
  sql: standardSQL,
  php: java, // legacy-modes 没有 php，clike 至少把关键字和字符串标出来
  // 前端
  js: javascript, mjs: javascript, cjs: javascript, jsx: javascript,
  ts: typescript, tsx: typescript, vue: javascript, svelte: javascript,
  json, jsonc: json, lock: json,
  css, scss: sCSS, sass, less,
  html, htm: html, xml, svg: xml,
  // 配置
  yml: yaml, yaml, toml,
  ini: properties, conf: properties, cnf: properties, cfg: properties,
  env: properties, properties, service: properties,
  // 编译型
  c, h: c,
  cpp, cc: cpp, cxx: cpp, hpp: cpp, hh: cpp,
  cs: csharp, java, kt: kotlin, kts: kotlin, scala,
  rs: rust, swift,
  m: objectiveC, mm: objectiveCpp,
  dart, groovy,
  // 其它
  diff, patch: diff,
  cmake,
  hs: haskell, jl: julia,
  vb, vbs: vbScript,
};

// 光看扩展名不够的特例：整名匹配优先于后缀。
const modeByFileName = {
  dockerfile: dockerFile,
  "nginx.conf": nginx,
  "cmakelists.txt": cmake,
};

/** 给文件名挑语言；挑不到返回 null 表示纯文本。 */
function modeFor(filename) {
  const name = String(filename || "").toLowerCase();
  const exact = modeByFileName[name];
  if (exact) return exact;
  if (name.startsWith("dockerfile")) return dockerFile;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return modeByExtension[ext] || null;
}

// 颜色只用语义变量：换主题时语法色跟着走，不用维护两套高亮表。
const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "var(--text-faint)", fontStyle: "italic" },
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--danger)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--warning)" },
  { tag: [tags.number, tags.bool, tags.atom, tags.null], color: "var(--accent-3)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--success)" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.name)], color: "var(--primary)" },
  { tag: [tags.variableName, tags.propertyName, tags.labelName], color: "var(--text)" },
  { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], color: "var(--accent-2)" },
  { tag: [tags.tagName], color: "var(--danger)" },
  { tag: [tags.attributeName], color: "var(--warning)" },
  { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: "var(--text-faint)" },
  { tag: [tags.link, tags.url], color: "var(--primary)", textDecoration: "underline" },
  { tag: tags.heading, color: "var(--primary)", fontWeight: "600" },
  { tag: tags.invalid, color: "var(--danger)", textDecoration: "underline wavy" },
]);

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: "var(--fs-sm)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--mono)",
    lineHeight: "1.55",
    overflow: "auto",
  },
  ".cm-content": { padding: "var(--space-12) 0", caretColor: "var(--text)" },
  ".cm-line": { padding: "0 var(--space-12)" },
  ".cm-gutters": {
    background: "var(--bg)",
    color: "var(--text-faint)",
    border: "none",
    paddingRight: "var(--space-4)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 var(--space-4) 0 var(--space-12)" },
  ".cm-activeLine": { background: "color-mix(in srgb, var(--primary) 8%, transparent)" },
  ".cm-activeLineGutter": {
    background: "color-mix(in srgb, var(--primary) 8%, transparent)",
    color: "var(--text-dim)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
    background: "var(--selected)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  ".cm-selectionMatch": { background: "color-mix(in srgb, var(--primary) 22%, transparent)" },
  "&.cm-focused .cm-matchingBracket": {
    background: "color-mix(in srgb, var(--primary) 26%, transparent)",
    outline: "1px solid var(--primary)",
  },
  ".cm-panels": { background: "var(--surface)", color: "var(--text)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-textfield": {
    background: "var(--surface-2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
  },
  ".cm-button": {
    background: "var(--surface-3)",
    backgroundImage: "none",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
  },
  ".cm-searchMatch": { background: "color-mix(in srgb, var(--warning) 30%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { background: "color-mix(in srgb, var(--warning) 55%, transparent)" },
  ".cm-tooltip": {
    background: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
  ".cm-specialChar": { color: "var(--danger)" },
});

/**
 * 在 parent 里挂一个高亮编辑器。
 *
 * onChange 只在文档真的改了才回调（用于标记 dirty）。
 * Ctrl+S / Esc 不在这里绑：弹层的 keydown 已经在处理，重复绑会互相盖住。
 */
export function mountCodeEditor(parent, { value, filename, onChange }) {
  const language = modeFor(filename);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        EditorState.tabSize.of(4),
        // 代码文件里 Tab 应该缩进而不是把焦点移出去
        keymap.of([indentWithTab]),
        syntaxHighlighting(highlightStyle),
        editorTheme,
        ...(language ? [StreamLanguage.define(language)] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange?.();
        }),
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
