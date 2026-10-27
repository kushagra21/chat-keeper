import type { MediaKind, Message } from '../types';

// Times are stored as UTC so they show exactly as written in the export.
const dayFmt = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });

export const formatDay = (ts: number) => dayFmt.format(ts);
export const formatShort = (ts: number) => shortFmt.format(ts);
export const formatTime = (ts: number) => timeFmt.format(ts);
export const dayKey = (ts: number) => Math.floor(ts / 86_400_000);
export const isoDate = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

const KIND_LABEL: Record<MediaKind | 'media', string> = {
  image: 'Photo', video: 'Video', audio: 'Audio', sticker: 'Sticker', document: 'Document',
  contact: 'Contact card', other: 'File', media: 'Media',
};
export const kindLabel = (kind: MediaKind | 'media') => KIND_LABEL[kind];

/** A stable colour for each sender's name. */
export function senderHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}

const URL_RE = /\bhttps?:\/\/[^\s<>]+[^\s<>.,:;"')\]!?]/g;

/** Message text with links made clickable and search matches marked; never parsed as HTML. */
export function richText(text: string, query: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    appendMarked(frag, text.slice(last, m.index), query);
    const a = el('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' });
    appendMarked(a, m[0], query);
    frag.append(a);
    last = m.index! + m[0].length;
  }
  appendMarked(frag, text.slice(last), query);
  return frag;
}

function appendMarked(parent: Node, text: string, query: string) {
  if (!query || !text) {
    if (text) parent.appendChild(document.createTextNode(text));
    return;
  }
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(query); i !== -1; i = lower.indexOf(query, at)) {
    parent.appendChild(document.createTextNode(text.slice(at, i)));
    parent.appendChild(el('mark', {}, text.slice(i, i + query.length)));
    at = i + query.length;
  }
  parent.appendChild(document.createTextNode(text.slice(at)));
}

export function matches(m: Message, query: string, sender: string): boolean {
  if (sender && m.sender !== sender) return false;
  if (!query) return true;
  return m.text.toLowerCase().includes(query) || (!!m.media && m.media.toLowerCase().includes(query));
}
