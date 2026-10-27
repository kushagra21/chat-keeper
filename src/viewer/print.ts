import { mediaKind } from '../parser';
import type { Chat, Message } from '../types';
import { dayKey, el, formatDay, formatShort, formatSize, formatTime, isoDate, kindLabel, senderHue } from './format';
import type { ViewerOptions } from './viewer';

const BIG = 5000;

/** Lets the reader pick a date range, then lays the chat out as a transcript and opens the print dialog. */
export function openPrintDialog(root: HTMLElement, chat: Chat, opts: ViewerOptions, me: string) {
  const msgs = chat.messages;
  if (!msgs.length) return;
  const from = el('input', { type: 'date', value: isoDate(msgs[0].ts), min: isoDate(msgs[0].ts), max: isoDate(msgs[msgs.length - 1].ts) });
  const to = el('input', { type: 'date', value: isoDate(msgs[msgs.length - 1].ts), min: from.min, max: from.max });
  const photos = el('input', { type: 'checkbox', checked: '' });
  const status = el('p', { class: 'small', 'aria-live': 'polite' });
  const go = el('button', { type: 'button', class: 'btn primary' }, 'Print / Save as PDF');
  const cancel = el('button', { type: 'button', class: 'btn' }, 'Cancel');

  const selected = () => {
    const a = Date.parse(from.value + 'T00:00:00Z');
    const b = Date.parse(to.value + 'T00:00:00Z') + 86_400_000;
    return msgs.filter((m) => m.ts >= a && m.ts < b);
  };
  const describe = () => {
    const n = selected().length;
    status.textContent = `${n.toLocaleString()} messages.` + (n > BIG ? ' That is a lot for one PDF; the browser may be slow or run out of memory. A shorter range is safer.' : '');
  };
  from.addEventListener('change', describe);
  to.addEventListener('change', describe);
  describe();

  const panel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Print or save as PDF' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Print or save as PDF')),
    el('p', { class: 'small' }, 'Choose “Save as PDF” as the printer to get a PDF. Photos print inline; videos print as a still frame.'),
    el('div', { class: 'form' },
      el('label', { class: 'field' }, el('span', {}, 'From'), from),
      el('label', { class: 'field' }, el('span', {}, 'To'), to),
      el('label', { class: 'check' }, photos, el('span', {}, 'Include photos and video frames'))),
    status,
    el('div', { class: 'panel-foot' }, cancel, go));
  const back = el('div', { class: 'overlay' }, panel);
  root.append(back);
  const close = () => back.remove();
  cancel.addEventListener('click', close);
  back.addEventListener('click', (e) => e.target === back && close());

  go.addEventListener('click', async () => {
    go.disabled = true;
    const list = selected();
    try {
      const page = await buildTranscript(chat, list, opts, me, photos.checked, (done, total) => {
        status.textContent = `Preparing attachments: ${done} of ${total}…`;
      });
      close();
      document.body.append(page);
      document.body.classList.add('ck-printing');
      const done = () => {
        document.body.classList.remove('ck-printing');
        page.remove();
      };
      window.addEventListener('afterprint', done, { once: true });
      window.print();
    } catch (e) {
      status.textContent = `Could not prepare the PDF: ${(e as Error).message}`;
      go.disabled = false;
    }
  });
}

async function buildTranscript(
  chat: Chat,
  list: Message[],
  opts: ViewerOptions,
  me: string,
  withMedia: boolean,
  progress: (done: number, total: number) => void,
): Promise<HTMLElement> {
  const page = el('div', { class: 'print-root' });
  const first = list[0];
  const last = list[list.length - 1];
  const ev = opts.evidence;

  const head = el('header', { class: 'p-head' },
    el('h1', {}, chat.title),
    el('p', {}, `${chat.senders.join(', ')}`),
    el('p', {}, first
      ? `${list.length.toLocaleString()} messages, ${formatShort(first.ts)} to ${formatShort(last.ts)}` + (list.length < chat.messages.length ? ` (of ${chat.messages.length.toLocaleString()} in the chat)` : '')
      : 'No messages in this range.'));
  if (ev) {
    head.append(el('p', { class: 'p-evidence' },
      `Original export: ${ev.sourceName} (${formatSize(ev.sourceSize)})`,
      ev.sourceSha256 ? el('br') : null, ev.sourceSha256 ? `SHA-256: ${ev.sourceSha256}` : null,
      el('br'), `Printed ${new Date().toLocaleString()} with Chat Keeper. Times are as written in the export.`));
  }
  page.append(head);

  const jobs: (() => Promise<void>)[] = [];
  let prev: Message | undefined;
  for (const m of list) {
    if (!prev || dayKey(prev.ts) !== dayKey(m.ts)) page.append(el('h2', { class: 'p-day' }, formatDay(m.ts)));
    prev = m;
    if (m.sender === null) {
      page.append(el('div', { class: 'p-sys' }, `${formatTime(m.ts)} · ${m.text}`));
      continue;
    }
    const body = el('div', { class: 'p-body' },
      el('span', { class: 'p-name', style: `--hue:${senderHue(m.sender)}` }, m.sender + (m.sender === me ? ' (you)' : '')));
    if (m.deleted) body.append(el('div', { class: 'p-text deleted' }, m.text));
    else if (m.text) body.append(el('div', { class: 'p-text' }, m.text));
    if (m.edited) body.append(el('span', { class: 'p-note' }, ' (edited)'));
    if (m.omitted) body.append(el('div', { class: 'p-note' }, `[${kindLabel(m.omitted)} not included in the export]`));
    if (m.media) {
      const name = m.media;
      const kind = mediaKind(name);
      const box = el('div', { class: 'p-media' });
      const label = `${kindLabel(kind)}: ${name}`;
      box.append(el('div', { class: 'p-note' }, opts.hasMedia(name) ? label : `${label} (not in the export)`));
      body.append(box);
      if (withMedia && opts.hasMedia(name) && (kind === 'image' || kind === 'sticker' || kind === 'video')) {
        jobs.push(async () => {
          const url = await opts.mediaUrl(name);
          if (!url) return;
          const visual = kind === 'video' ? await videoFrame(url) : await image(url, name);
          if (visual) box.prepend(visual);
        });
      }
    }
    page.append(el('div', { class: 'p-msg' }, el('div', { class: 'p-time' }, formatTime(m.ts)), body));
  }

  let done = 0;
  progress(0, jobs.length);
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await job().catch(() => undefined);
      progress(++done, jobs.length);
    }
  }));
  return page;
}

async function image(url: string, name: string): Promise<HTMLImageElement | null> {
  const img = el('img', { src: url, alt: name });
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

function once(target: EventTarget, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    target.addEventListener(event, () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/** A still from early in the video, drawn on a canvas so it prints like a photo. */
async function videoFrame(url: string): Promise<HTMLCanvasElement | null> {
  const v = el('video', { muted: '', playsinline: '', preload: 'auto' });
  v.muted = true;
  v.src = url;
  try {
    await once(v, 'loadeddata', 10_000);
    v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
    await once(v, 'seeked', 5_000);
    const scale = Math.min(1, 640 / (v.videoWidth || 640));
    const c = el('canvas', { class: 'p-video' });
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    return c;
  } catch {
    return null;
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}
