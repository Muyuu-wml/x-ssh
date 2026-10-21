// One stroke weight and viewBox for every UI icon. No font/emoji dependency.
const paths = {
  terminal: '<path d="m5 6 5 6-5 6m8 0h6"/>',
  server: '<rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M8 6.5h.01M8 17.5h.01M12 6.5h5M12 17.5h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  minimise: '<path d="M5 12h14"/>',
  maximise: '<rect x="5" y="5" width="14" height="14"/>',
  restore: '<path d="M9 5V3h12v12h-2"/><rect x="3" y="9" width="12" height="12"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  up: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  paste: '<path d="M9 5h6m-5-2h4a1 1 0 0 1 1 1v1H9V4a1 1 0 0 1 1-1Z"/><rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 10h6m-6 4h6m-6 4h4"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/><path d="M12 10v6m-3-3h6"/>',
  file: '<path d="M14 3H5v18h14V8Zm0 0v5h5M8 13h8M8 17h5"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  transfer: '<path d="M8 3v18m-4-4 4 4 4-4M16 21V3m-4 4 4-4 4 4"/>',
  monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5m-5 0h10"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  settings: '<path d="m9 3-.7 2.5-2.5 1L3.5 6 2 9l2 1.7v2.6L2 15l1.5 3 2.3-.5 2.5 1L9 21h6l.7-2.5 2.5-1 2.3.5 1.5-3-2-1.7v-2.6L22 9l-1.5-3-2.3.5-2.5-1L15 3Z"/><circle cx="12" cy="12" r="3"/>',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.terminal}</svg>`;
}

export function mountIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    node.innerHTML = icon(node.dataset.icon);
  });
}
