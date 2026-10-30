// One stroke weight, rounded caps. Color comes from currentColor.
import { h } from './core.js';

const stroke = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  calculator: stroke('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8"/><path d="M8 11h.01M12 11h.01M16 11h.01"/><path d="M8 15h.01M12 15h.01M16 15h.01"/><path d="M8 18h.01M12 18h.01"/>'),
  estimate: stroke('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/>'),
  file: stroke('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/>'),
  folder: stroke('<path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  user: stroke('<path d="M19.5 20.5a7.5 7.5 0 0 0-15 0"/><circle cx="12" cy="8" r="3.25"/>'),
  window: stroke('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 4v16M4 12h16"/>'),
  options: stroke('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 4v16M4 12h16"/>'),
  image: stroke('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.25"/><path d="M20.5 15.5l-4.2-4.2L7 19"/>'),
  gallery: stroke('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.25"/><path d="M20.5 15.5l-4.2-4.2L7 19"/>'),
  book: stroke('<path d="M12 6.2C10.4 4.8 7.8 4.2 4 4.2v14.2c3.8 0 6.4.6 8 2 1.6-1.4 4.2-2 8-2V4.2c-3.8 0-6.4.6-8 2z"/><path d="M12 6.2v14.2"/>'),
  brochures: stroke('<path d="M12 6.2C10.4 4.8 7.8 4.2 4 4.2v14.2c3.8 0 6.4.6 8 2 1.6-1.4 4.2-2 8-2V4.2c-3.8 0-6.4.6-8 2z"/><path d="M12 6.2v14.2"/>'),
  camera: stroke('<path d="M4 8.5h3.2L8.6 6h6.8l1.4 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3"/>'),
  preview: stroke('<path d="M4 8.5h3.2L8.6 6h6.8l1.4 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3"/>'),
  gear: stroke('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  settings: stroke('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  plus: stroke('<path d="M12 5v14M5 12h14"/>'),
  minus: stroke('<path d="M5 12h14"/>'),
  x: stroke('<path d="M6 6l12 12M18 6L6 18"/>'),
  chevron: stroke('<path d="M9 5.5l6.5 6.5L9 18.5"/>'),
  arrow: stroke('<path d="M19 12H5"/><path d="M11 6L5 12l6 6"/>'),
  play: stroke('<path d="M8 5.5v13l11-6.5z"/>'),
  pause: stroke('<path d="M8 5v14M16 5v14"/>'),
  sun: stroke('<circle cx="12" cy="12" r="3.4"/><path d="M12 3v2.1M12 18.9V21M3 12h2.1M18.9 12H21M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5"/>'),
  cloud: stroke('<path d="M7 18h10.2a3.8 3.8 0 0 0 .5-7.6 5.6 5.6 0 0 0-10.8-1.4A3.7 3.7 0 0 0 7 18z"/>'),
  shield: stroke('<path d="M12 3.2l7 2.8v5.6c0 4.2-2.9 7-7 8.6-4.1-1.6-7-4.4-7-8.6V6z"/>'),
  eye: stroke('<path d="M2.5 12S6 6.8 12 6.8 21.5 12 21.5 12 18 17.2 12 17.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.4"/>'),
  grid: stroke('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 4v16M4 12h16"/>'),
  screen: stroke('<rect x="4.5" y="3.5" width="15" height="17" rx="1.5"/><path d="M4.5 8h15M9 8v12.5M14.5 8v12.5M4.5 13h15"/>'),
  frame: stroke('<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><rect x="7.5" y="7.5" width="9" height="9" rx="1"/>'),
  edge: stroke('<path d="M3.5 7.5h17v9h-17z"/><path d="M8 7.5v9"/>'),
  layers: stroke('<path d="M12 3.5l8.5 4.5L12 12.5 3.5 8z"/><path d="M3.5 12l8.5 4.5L20.5 12"/><path d="M3.5 15.5L12 20l8.5-4.5"/>'),
};

export function svg(name) {
  return ICON[name] || ICON.frame;
}

export function icon(name, className = 'ico-svg') {
  return h('span', { class: className, html: svg(name), 'aria-hidden': 'true' });
}
