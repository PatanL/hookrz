// Emblems for the six block families (match the banner's cube faces) + a few UI glyphs.
// All use currentColor so .cube can tint them ice (pass) or coral (refused).
const sw = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter"';

export const EMBLEM = {
  guard: `<svg viewBox="0 0 24 24" ${sw}><path d="M12 2.5 20 5.5v6.2c0 4.7-3.3 8.2-8 9.8-4.7-1.6-8-5.1-8-9.8V5.5z"/><path d="M12 6v12" stroke-width="1.6" opacity=".55"/></svg>`,
  pace: `<svg viewBox="0 0 24 24" ${sw}><path d="M5 20v-5M12 20V10M19 20V4"/><path d="M3 21.5h18" stroke-width="1.6" opacity=".55"/></svg>`,
  burn: `<svg viewBox="0 0 24 24" ${sw}><path d="M12 21.5c-4 0-6.5-2.6-6.5-6.3 0-3.3 2.3-5.4 3.6-7.6.4 1.7 1.4 2.8 2.4 3.2C11 7.6 12.6 4.4 15 2.5c-.3 3.2 3.5 6 3.5 11.4 0 4.6-2.6 7.6-6.5 7.6z"/><path d="M12 21.5c-1.7 0-2.8-1.1-2.8-2.9 0-1.7 1.6-2.7 2.3-4.3.8 1.2 3.3 2.4 3.3 4.4 0 1.7-1.1 2.8-2.8 2.8z" stroke-width="1.6" opacity=".6"/></svg>`,
  flow: `<svg viewBox="0 0 24 24" ${sw}><path d="M12 2.5c3 4.2 6.5 8 6.5 12a6.5 6.5 0 0 1-13 0c0-4 3.5-7.8 6.5-12z"/><path d="M8.8 15a3.3 3.3 0 0 0 3.2 3.2" stroke-width="1.6" opacity=".6"/></svg>`,
  crown: `<svg viewBox="0 0 24 24" ${sw}><path d="M3 7.5 7.5 12 12 5l4.5 7L21 7.5 19.2 18H4.8z"/><path d="M4.8 21h14.4" stroke-width="1.6" opacity=".6"/></svg>`,
  custom: `<svg viewBox="0 0 24 24" ${sw} stroke-width="3"><path d="M12 4v16M4 12h16"/></svg>`,
};

export const ICON = {
  arrow: `<svg class="arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8h11M9 4l4 4-4 4"/></svg>`,
  ext: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2h6v6M10 2 3 9"/></svg>`,
  remix: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 2v4a3 3 0 0 0 3 3h2a3 3 0 0 1 3 3v2M12 2v3M4 14v-2"/><rect x="2.5" y="1" width="3" height="3"/><rect x="10.5" y="1" width="3" height="3"/></svg>`,
  copy: `<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4.5" y="4.5" width="8" height="8"/><path d="M2 9.5V2h7.5"/></svg>`,
  menu: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 4h14M2 9h14M2 14h14"/></svg>`,
  x: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 2.5h3.3l-7.2 8.2 8.5 11.2h-6.6l-5.2-6.8-5.9 6.8H1.4l7.7-8.8L1 2.5h6.8l4.7 6.2zm-1.2 17.4h1.8L6.6 4.4H4.6z"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 7.5 5.5 10.5 11.5 3.5"/></svg>`,
  stop: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l8 8M11 3l-8 8"/></svg>`,
  lock: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="6" width="9" height="6.5"/><path d="M4.5 6V4a2.5 2.5 0 0 1 5 0v2"/></svg>`,
};

/** A CSS chrome cube with a family emblem. size in px. state: '' | 'lit' | 'refused' | 'empty'. */
export function cube(family, { size = 56, state = '', title = '' } = {}) {
  const glass = family === 'custom' ? ' glass' : '';
  const em = state === 'empty' ? '' : (EMBLEM[family] ?? EMBLEM.custom);
  return `<span class="cube${glass}${state ? ' ' + state : ''}" style="--s:${size}px"${title ? ` title="${title}"` : ''} aria-hidden="true">${em}</span>`;
}
