const PATHS = {
  grid: '<rect x="3" y="3" width="6" height="6" rx="1.4"/><rect x="11" y="3" width="6" height="6" rx="1.4"/><rect x="3" y="11" width="6" height="6" rx="1.4"/><rect x="11" y="11" width="6" height="6" rx="1.4"/>',
  box: '<path d="M3.5 7.5 10 4l6.5 3.5v5L10 16l-6.5-3.5z"/><path d="M3.5 7.5 10 11l6.5-3.5M10 11v5"/>',
  pulse: '<path d="M2.5 10h3l1.8-4 3 8 2-4h5.2"/>',
  server: '<rect x="3" y="3.5" width="14" height="5" rx="1.5"/><rect x="3" y="11.5" width="14" height="5" rx="1.5"/><path d="M6 6h.01M6 14h.01"/>',
  settings: '<path d="M8.6 2.9h2.8l.4 1.6c.4.2.8.4 1.2.7l1.5-.6 1.4 1.4-.6 1.5c.3.4.5.8.7 1.2l1.6.4v2.8l-1.6.4c-.2.4-.4.8-.7 1.2l.6 1.5-1.4 1.4-1.5-.6c-.4.3-.8.5-1.2.7l-.4 1.6H8.6l-.4-1.6c-.4-.2-.8-.4-1.2-.7l-1.5.6-1.4-1.4.6-1.5c-.3-.4-.5-.8-.7-1.2l-1.6-.4V8.6l1.6-.4c.2-.4.4-.8.7-1.2l-.6-1.5 1.4-1.4 1.5.6c.4-.3.8-.5 1.2-.7z"/><circle cx="10" cy="10" r="2.2"/>',
  search: '<circle cx="8.7" cy="8.7" r="5.4"/><path d="M12.8 12.8 17 17"/>',
  upload: '<path d="M10 13V3.6M6.4 7.2 10 3.6l3.6 3.6"/><path d="M3.5 12.4v2.4c0 .9.7 1.6 1.6 1.6h9.8c.9 0 1.6-.7 1.6-1.6v-2.4"/>',
  close: '<path d="M5 5l10 10M15 5 5 15"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  download: '<path d="M10 3.6v9.8M6.4 9.8 10 13.4l3.6-3.6"/><path d="M3.5 15.8h13"/>',
  edit: '<path d="M3.5 16.5h3.6L16 7.6a2 2 0 0 0-2.8-2.8L4.3 13.7z"/><path d="M11.8 6.2 13.8 8.2"/>',
  trash: '<path d="M3.5 5.5h13M8 5.5V3.8h4v1.7M5.2 5.5l.9 11h7.8l.9-11"/>',
  more: '<circle cx="4.5" cy="10" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="15.5" cy="10" r="1.3"/>',
  copy: '<rect x="6.5" y="6.5" width="9.5" height="9.5" rx="1.8"/><path d="M4 13V5.4c0-1 .8-1.8 1.8-1.8H13"/>',
  check: '<path d="M3.8 10.4 8 14.5l8.2-9"/>',
  back: '<path d="M12 4 6 10l6 6"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="7.2" cy="8" r="1.3"/><path d="m3.8 14 4.2-4.2 3.4 3.4 2-2 2.8 2.8"/>',
  file: '<path d="M5 3h6l4 4v10H5z"/><path d="M11 3v4h4"/>',
  refresh: '<path d="M16 8a6.2 6.2 0 1 0 .6 3.4M16 4v4h-4"/>',
  sun: '<circle cx="10" cy="10" r="3.4"/><path d="M10 2.6v1.7M10 15.7v1.7M2.6 10h1.7M15.7 10h1.7M4.7 4.7l1.2 1.2M14.1 14.1l1.2 1.2M15.3 4.7l-1.2 1.2M5.9 14.1l-1.2 1.2"/>',
  moon: '<path d="M16 11.6A6.6 6.6 0 0 1 8.4 4 6.6 6.6 0 1 0 16 11.6z"/>',
  eye: '<path d="M2.5 10S5 5.6 10 5.6 17.5 10 17.5 10 15 14.4 10 14.4 2.5 10 2.5 10z"/><circle cx="10" cy="10" r="2.4"/>',
  eyeOff: '<path d="M2.5 10S5 5.6 10 5.6c1.2 0 2.3.3 3.2.8M17.5 10s-2.5 4.4-7.5 4.4c-1.2 0-2.3-.3-3.2-.8"/><path d="M3.5 3.5 16.5 16.5"/><circle cx="10" cy="10" r="2.4"/>',
  key: '<circle cx="7" cy="12.5" r="3"/><path d="M9.2 10.3 16.5 3M13.2 6.3l2.1 2.1M11 8.5l2.1 2.1"/>',
  link: '<path d="M8.2 11.8a3.2 3.2 0 0 0 4.5 0l2.1-2.1a3.2 3.2 0 1 0-4.5-4.5L9.2 6.4"/><path d="M11.8 8.2a3.2 3.2 0 0 0-4.5 0L5.2 10.3a3.2 3.2 0 1 0 4.5 4.5l1.1-1.2"/>',
  alert: '<path d="M10 3.2 17.5 16h-15z"/><path d="M10 7.6v3.6M10 13.6h.01"/>',
  info: '<circle cx="10" cy="10" r="7.3"/><path d="M10 9.2v4.3M10 6.5h.01"/>',
  globe: '<circle cx="10" cy="10" r="7.2"/><path d="M2.8 10h14.4M10 2.8c2 2 3 4.5 3 7.2s-1 5.2-3 7.2c-2-2-3-4.5-3-7.2s1-5.2 3-7.2z"/>',
  shield: '<path d="M10 2.8 16 5v4.4c0 3.5-2.3 6.4-6 7.8-3.7-1.4-6-4.3-6-7.8V5z"/><path d="m7.2 9.8 1.9 1.9 3.7-3.7"/>',
  hash: '<path d="M8 3.5 6.5 16.5M13.5 3.5 12 16.5M3.5 7.5h13M3 12.5h13"/>',
};

export function svg(name, size = 16, strokeWidth = 1.7) {
  const path = PATHS[name] || "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
