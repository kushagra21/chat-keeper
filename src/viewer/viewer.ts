import css from './viewer.css?inline';
import { mediaKind } from '../parser';
import type { Chat, DateOrder, Evidence, Message } from '../types';
import { dayKey, el, formatDay, formatShort, formatSize, formatTime, isoDate, kindLabel, matches, richText, senderHue } from './format';
import { openPrintDialog } from './print';

export interface ViewerOptions {
  chat: Chat;
  evidence?: Evidence;
  /** A URL for an attached file, or undefined when it is not in the export. */
  mediaUrl: (name: string) => Promise<string | undefined>;
  hasMedia: (name: string) => boolean;
  mediaSize?: (name: string) => number;
  /** Extra buttons for the toolbar (the app adds Save archive and Close). */
  actions?: HTMLElement[];
  onDateOrder?: (order: DateOrder) => void;
  /** Shown at the top of the page, e.g. the archive's "made with" line. */
  banner?: HTMLElement;
}

export interface Viewer {
  refreshInfo(): void;
  destroy(): void;
}

const CHUNK = 200;

export function injectViewerStyles() {
  if (document.getElementById('ck-viewer-css')) return;
  document.head.append(el('style', { id: 'ck-viewer-css' }, css));
}

export function mountViewer(root: HTMLElement, opts: ViewerOptions): Viewer {
  injectViewerStyles();
  const { chat } = opts;
  const msgs = chat.messages;
  const indexById = new Map(msgs.map((m, i) => [m.id, i]));
  const meKey = `chat-keeper:me:${chat.title}:${chat.senders.join('|')}`;
  let me = load(meKey) ?? '';
  if (!chat.senders.includes(me)) me = '';
  const group = chat.senders.length > 2;

  // ---- media, filled in as it scrolls into view
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        void hydrate(e.target as HTMLElement);
      }
    },
    { rootMargin: '1200px 0px' },
  );

  async function hydrate(box: HTMLElement) {
    const name = box.dataset.name!;
    const url = await opts.mediaUrl(name).catch(() => undefined);
    box.replaceChildren(url ? mediaElement(name, url, box.dataset.id ? Number(box.dataset.id) : undefined) : missing(name));
  }

  function mediaElement(name: string, url: string, id?: number): HTMLElement {
    const kind = mediaKind(name);
    if (kind === 'image' || kind === 'sticker') {
      const img = el('img', { src: url, alt: name, loading: 'lazy', class: kind === 'sticker' ? 'sticker' : undefined });
      img.addEventListener('click', () => openLightbox(name, url, id));
      img.addEventListener('error', () => img.replaceWith(fileCard(name, url)), { once: true });
      return img;
    }
    if (kind === 'video') {
      const v = el('video', { src: url, controls: '', preload: 'metadata', playsinline: '' });
      v.addEventListener('error', () => v.replaceWith(fileCard(name, url)), { once: true });
      return v;
    }
    if (kind === 'audio') {
      const a = el('audio', { src: url, controls: '', preload: 'none' });
      const wrap = el('div', { class: 'audio' }, a, el('a', { href: url, download: name, class: 'small' }, 'Download'));
      return wrap;
    }
    return fileCard(name, url);
  }

  function fileCard(name: string, url: string) {
    const size = opts.mediaSize?.(name);
    return el('a', { class: 'file', href: url, download: name },
      el('span', { class: 'file-kind' }, kindLabel(mediaKind(name))),
      el('span', { class: 'file-name' }, name),
      size ? el('span', { class: 'small' }, formatSize(size)) : null);
  }

  const missing = (name: string) => el('div', { class: 'omitted' }, `${kindLabel(mediaKind(name))} not in the export: ${name}`);

  // ---- one message
  function renderMessage(m: Message, prev: Message | undefined, query: string, showDate: boolean): HTMLElement {
    if (m.sender === null) {
      return el('div', { class: 'sys', 'data-id': String(m.id) }, el('span', {}, richText(m.text, query)));
    }
    const mine = m.sender === me;
    const first = !prev || prev.sender !== m.sender || dayKey(prev.ts) !== dayKey(m.ts) || showDate;
    const bubble = el('div', { class: 'bubble' });
    // Names are needed in groups, and in two-person chats until "You are" says which side is which.
    if (first && !mine && (group || !me)) {
      bubble.append(el('div', { class: 'name', style: `--hue:${senderHue(m.sender)}` }, m.sender));
    }
    if (m.media) {
      const box = el('div', { class: 'media', 'data-name': m.media, 'data-id': String(m.id) });
      if (opts.hasMedia(m.media)) {
        box.append(el('div', { class: 'media-placeholder' }, kindLabel(mediaKind(m.media))));
        io.observe(box);
      } else box.append(missing(m.media));
      bubble.append(box);
    }
    if (m.omitted) bubble.append(el('div', { class: 'omitted' }, `${kindLabel(m.omitted)} not included in the export`));
    if (m.deleted) bubble.append(el('div', { class: 'text deleted' }, m.text));
    else if (m.text) bubble.append(el('div', { class: 'text' }, richText(m.text, query)));
    bubble.append(el('div', { class: 'meta' },
      m.edited ? 'edited · ' : '',
      showDate ? `${formatShort(m.ts)}, ${formatTime(m.ts)}` : formatTime(m.ts)));
    return el('div', { class: `msg ${mine ? 'me' : 'them'}${first ? ' first' : ''}`, 'data-id': String(m.id) }, bubble);
  }

  // ---- the list, rendered in chunks so long chats open at once
  let renderToken = 0;
  let current: Message[] = msgs;
  let renderedUpTo = 0;
  let query = '';
  let sender = '';
  const list = el('main', { class: 'list' });

  function renderList(items: Message[], q: string, results: boolean) {
    renderToken++;
    current = items;
    renderedUpTo = 0;
    list.replaceChildren();
    list.classList.toggle('results', results);
    if (!items.length) {
      list.append(el('p', { class: 'empty' }, results ? 'No messages match.' : 'This chat has no messages.'));
      return;
    }
    const token = renderToken;
    renderChunk(q, results);
    const step = () => {
      if (token !== renderToken || renderedUpTo >= current.length) return;
      renderChunk(q, results);
      setTimeout(step, 0);
    };
    setTimeout(step, 50);
  }

  function renderChunk(q: string, results: boolean) {
    const chunk = el('section', { class: 'chunk' });
    const end = Math.min(renderedUpTo + CHUNK, current.length);
    for (let i = renderedUpTo; i < end; i++) {
      const m = current[i];
      const prev = current[i - 1];
      if (!results && (!prev || dayKey(prev.ts) !== dayKey(m.ts))) {
        chunk.append(el('div', { class: 'day' }, el('span', {}, formatDay(m.ts))));
      }
      const node = renderMessage(m, results ? undefined : prev, q, results);
      if (results) {
        node.classList.add('result');
        node.title = 'Show in chat';
        node.addEventListener('click', (ev) => {
          if ((ev.target as HTMLElement).closest('a, video, audio, img')) return;
          showInChat(m.id);
        });
      }
      chunk.append(node);
    }
    renderedUpTo = end;
    list.append(chunk);
  }

  function ensureRendered(index: number) {
    while (renderedUpTo <= index && renderedUpTo < current.length) renderChunk('', false);
  }

  function scrollToIndex(index: number, flash: boolean) {
    ensureRendered(index);
    const node = list.querySelector<HTMLElement>(`[data-id="${current[index].id}"]`);
    if (!node) return;
    const go = () => node.scrollIntoView({ block: 'center' });
    go();
    requestAnimationFrame(() => requestAnimationFrame(go));
    if (flash) {
      node.classList.remove('flash');
      void node.offsetWidth;
      node.classList.add('flash');
    }
  }

  function showInChat(id: number) {
    closeOverlays();
    search.value = '';
    senderSel.value = '';
    query = sender = '';
    renderList(msgs, '', false);
    updateCount();
    scrollToIndex(indexById.get(id) ?? 0, true);
  }

  // ---- header and toolbar
  const first = msgs[0];
  const last = msgs[msgs.length - 1];
  const sub = `${chat.senders.length} ${chat.senders.length === 1 ? 'person' : 'people'} · ${msgs.length.toLocaleString()} messages`
    + (first ? ` · ${formatShort(first.ts)} – ${formatShort(last.ts)}` : '');

  const search = el('input', { type: 'search', placeholder: 'Search messages', 'aria-label': 'Search messages' });
  const senderSel = el('select', { 'aria-label': 'Only messages from' }, el('option', { value: '' }, 'Everyone'),
    ...chat.senders.map((s) => el('option', { value: s }, s)));
  const jump = el('input', { type: 'date', 'aria-label': 'Go to date', title: 'Go to date' });
  if (first) {
    jump.min = isoDate(first.ts);
    jump.max = isoDate(last.ts);
  }
  const meSel = el('select', { 'aria-label': 'You are' }, el('option', { value: '' }, 'Not set'),
    ...chat.senders.map((s) => el('option', { value: s }, s)));
  meSel.value = me;
  const count = el('span', { class: 'count', 'aria-live': 'polite' });

  const btn = (label: string, onClick: () => void, cls = 'btn') => {
    const b = el('button', { type: 'button', class: cls }, label);
    b.addEventListener('click', onClick);
    return b;
  };

  const header = el('header', { class: 'top' },
    el('div', { class: 'title-row' },
      el('div', { class: 'titles' }, el('h1', {}, chat.title), el('p', { class: 'sub' }, sub)),
      el('div', { class: 'actions' },
        btn('Media', openGallery),
        btn('Info', openInfo),
        btn('Print / PDF', () => openPrintDialog(root, chat, opts, me)),
        ...(opts.actions ?? []))),
    el('div', { class: 'tools' },
      search, senderSel,
      el('label', { class: 'field' }, el('span', {}, 'Go to'), jump),
      el('label', { class: 'field' }, el('span', {}, 'You are'), meSel),
      count));

  function updateCount() {
    count.textContent = query || sender ? `${current.length.toLocaleString()} match${current.length === 1 ? '' : 'es'}` : '';
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const applyFilter = () => {
    query = search.value.trim().toLowerCase();
    sender = senderSel.value;
    const filtering = !!(query || sender);
    renderList(filtering ? msgs.filter((m) => matches(m, query, sender)) : msgs, query, filtering);
    updateCount();
    window.scrollTo({ top: 0 });
  };
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(applyFilter, 180);
  });
  senderSel.addEventListener('change', applyFilter);
  jump.addEventListener('change', () => {
    if (!jump.value) return;
    if (query || sender) showInChat(msgs[0].id);
    const target = Date.parse(jump.value + 'T00:00:00Z');
    let i = msgs.findIndex((m) => m.ts >= target);
    if (i < 0) i = msgs.length - 1;
    scrollToIndex(i, false);
  });
  meSel.addEventListener('change', () => {
    me = meSel.value;
    save(meKey, me);
    const y = window.scrollY;
    renderList(current, query, !!(query || sender));
    ensureRendered(Math.min(current.length - 1, Math.ceil(y / 50)));
    window.scrollTo({ top: y });
  });

  // ---- overlays: gallery, info, lightbox
  const overlays: HTMLElement[] = [];
  function overlay(title: string, body: Node, wide = false): HTMLElement {
    closeOverlays();
    const close = btn('Close', closeOverlays, 'btn');
    const panel = el('div', { class: `panel${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'panel-head' }, el('h2', {}, title), close), body);
    const back = el('div', { class: 'overlay' }, panel);
    back.addEventListener('click', (e) => e.target === back && closeOverlays());
    root.append(back);
    overlays.push(back);
    close.focus();
    return panel;
  }
  function closeOverlays() {
    while (overlays.length) overlays.pop()!.remove();
  }
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeOverlays();
  document.addEventListener('keydown', onKey);

  function openLightbox(name: string, url: string, id?: number) {
    const kind = mediaKind(name);
    const media = kind === 'video' ? el('video', { src: url, controls: '', autoplay: '' }) : el('img', { src: url, alt: name });
    const actions = el('div', { class: 'lightbox-actions' }, el('a', { href: url, download: name, class: 'btn' }, 'Download'));
    if (id !== undefined) actions.append(btn('Show in chat', () => showInChat(id)));
    const panel = overlay(name, el('div', { class: 'lightbox' }, media, actions), true);
    panel.classList.add('dark');
  }

  function openGallery() {
    const items = msgs.filter((m) => m.media && opts.hasMedia(m.media) && ['image', 'video', 'sticker'].includes(mediaKind(m.media)));
    const grid = el('div', { class: 'grid' });
    if (!items.length) grid.append(el('p', { class: 'empty' }, 'No photos or videos in this export.'));
    for (const m of items) {
      const cell = el('button', { type: 'button', class: 'cell', title: `${m.sender}, ${formatShort(m.ts)}` });
      const box = el('div', { class: 'media', 'data-name': m.media });
      cell.append(box);
      void opts.mediaUrl(m.media!).then((url) => {
        if (!url) return;
        const kind = mediaKind(m.media!);
        box.append(kind === 'video'
          ? el('video', { src: url + '#t=0.1', preload: 'metadata', muted: '' })
          : el('img', { src: url, alt: m.media!, loading: 'lazy' }));
        if (kind === 'video') box.append(el('span', { class: 'play' }, '▶'));
        cell.addEventListener('click', () => openLightbox(m.media!, url, m.id));
      });
      grid.append(cell);
    }
    overlay(`Photos and videos (${items.length.toLocaleString()})`, grid, true);
  }

  let infoBody: HTMLElement | undefined;
  function openInfo() {
    infoBody = el('div', { class: 'info' });
    fillInfo(infoBody);
    overlay('About this chat', infoBody);
  }

  function fillInfo(box: HTMLElement) {
    const perSender = new Map<string, number>();
    let media = 0;
    let missingCount = 0;
    for (const m of msgs) {
      if (m.sender) perSender.set(m.sender, (perSender.get(m.sender) ?? 0) + 1);
      if (m.media) {
        media++;
        if (!opts.hasMedia(m.media)) missingCount++;
      }
    }
    const rows: [string, Node | string][] = [
      ['Messages', msgs.length.toLocaleString()],
      ['First message', first ? `${formatDay(first.ts)}, ${formatTime(first.ts)}` : '–'],
      ['Last message', last ? `${formatDay(last.ts)}, ${formatTime(last.ts)}` : '–'],
      ['Attachments', `${media.toLocaleString()}${missingCount ? ` (${missingCount} not in the export)` : ''}`],
      ['Exported from', chat.platform === 'ios' ? 'iPhone' : chat.platform === 'android' ? 'Android' : 'Unknown'],
    ];
    const ev = opts.evidence;
    if (ev) {
      rows.push(['Original file', `${ev.sourceName} (${formatSize(ev.sourceSize)})`]);
      rows.push(['SHA-256 of original', el('code', {}, ev.sourceSha256 ?? 'calculating…')]);
      if (ev.chatFileName !== ev.sourceName) {
        rows.push([`SHA-256 of ${ev.chatFileName}`, el('code', {}, ev.chatFileSha256 ?? 'calculating…')]);
      }
      if (ev.generatedAt) rows.push(['Archive made', new Date(ev.generatedAt).toLocaleString()]);
    }
    const dl = el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
    const people = el('table', { class: 'people' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Person'), el('th', {}, 'Messages'))),
      el('tbody', {}, ...chat.senders.map((s) =>
        el('tr', {}, el('td', { style: `--hue:${senderHue(s)}`, class: 'name' }, s), el('td', {}, (perSender.get(s) ?? 0).toLocaleString())))));
    box.replaceChildren(dl, people);
    if (opts.onDateOrder) {
      const other: DateOrder = chat.dateOrder === 'DMY' ? 'MDY' : 'DMY';
      if (chat.dateOrder !== 'YMD') {
        box.append(el('p', { class: 'small' },
          `Dates are read as ${chat.dateOrder === 'DMY' ? 'day/month' : 'month/day'}${chat.dateOrderGuessed ? ' (a guess: nothing in the file settles it)' : ''}. `,
          btn(`Read as ${other === 'DMY' ? 'day/month' : 'month/day'}`, () => opts.onDateOrder!(other), 'link')));
      }
    }
  }

  root.replaceChildren(...(opts.banner ? [opts.banner] : []), header, list);
  root.classList.add('ck-viewer');
  renderList(msgs, '', false);
  if (chat.dateOrderGuessed && opts.onDateOrder) {
    header.after(el('div', { class: 'notice' },
      'Dates could be day/month or month/day; this file doesn’t say which. If they look wrong, switch under Info.'));
  }

  return {
    refreshInfo() {
      if (infoBody?.isConnected) fillInfo(infoBody);
    },
    destroy() {
      renderToken++;
      io.disconnect();
      document.removeEventListener('keydown', onKey);
      root.replaceChildren();
      root.classList.remove('ck-viewer');
    },
  };
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}
