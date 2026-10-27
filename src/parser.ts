import type { Chat, DateOrder, MediaKind, Message } from './types';

// One header per message. iPhone: "[05/01/2023, 10:22:33] Asha: hi". Android: "05/01/2023, 10:22 - Asha: hi".
// Dates may use / . or -, years may come first or last, times may be 12h or 24h.
const DATE = String.raw`(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?`;
const IOS_HEADER = new RegExp(String.raw`^\[${DATE}\]\s?(.*)$`);
const ANDROID_HEADER = new RegExp(String.raw`^${DATE}\s[-\u2013]\s(.*)$`);

const BIDI_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const IOS_ATTACHED = /<[^<>:]{2,30}:\s*([^<>]+?\.[A-Za-z0-9]{2,5})>/;
const ANDROID_ATTACHED = /^(\S[^\n]*?\.[A-Za-z0-9]{2,5}) \([^()\n]+\)$/;
const IOS_OMITTED = /^(image|video|audio|sticker|GIF|Contact card|document)\s+omitted$|document omitted$/i;
const DELETED = /^(this message was deleted|you deleted this message)\.?$/i;
const EDITED = /\s*<this message was edited>$/i;
const CALL = /^(missed )?(voice|video|group voice|group video) call/i;

export interface ParseOptions {
  title?: string;
  /** Force a date order instead of detecting it. */
  dateOrder?: DateOrder;
  /** File names present next to the chat, so attachments are recognised in any language. */
  knownFiles?: Set<string>;
}

interface RawEntry {
  parts: number[]; // a, b, c, hour, minute, second
  ampm: string | undefined;
  body: string;
}

export function mediaKind(name: string): MediaKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (/^(jpe?g|png|gif|heic|heif|bmp|avif)$/.test(ext)) return 'image';
  if (ext === 'webp') return name.toUpperCase().includes('STK') || name.includes('STICKER') ? 'sticker' : 'image';
  if (/^(mp4|mov|3gp|m4v|mkv|webm)$/.test(ext)) return 'video';
  if (/^(opus|ogg|m4a|mp3|aac|amr|wav)$/.test(ext)) return 'audio';
  if (ext === 'vcf') return 'contact';
  if (/^(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rtf|odt|pages|numbers|key)$/.test(ext)) return 'document';
  return 'other';
}

export function looksLikeChat(text: string): boolean {
  const lines = text.slice(0, 20000).split(/\r?\n/).slice(0, 50);
  return lines.some((l) => {
    const n = clean(l);
    return IOS_HEADER.test(n) || ANDROID_HEADER.test(n);
  });
}

function clean(line: string): string {
  return line.replace(/[\u202f\u00a0]/g, ' ').replace(/^[\u200e\u200f\ufeff]+/, '');
}

export function parseChat(text: string, opts: ParseOptions = {}): Chat {
  const entries: RawEntry[] = [];
  let ios = 0;
  let android = 0;

  for (const line of text.split(/\r?\n/)) {
    const n = clean(line);
    const m = IOS_HEADER.exec(n) ?? ANDROID_HEADER.exec(n);
    if (m) {
      if (m.input.startsWith('[')) ios++;
      else android++;
      entries.push({
        parts: [1, 2, 3, 4, 5, 6].map((i) => (m[i] === undefined ? 0 : Number(m[i]))),
        ampm: m[7],
        body: m[8],
      });
    } else if (entries.length) {
      entries[entries.length - 1].body += '\n' + line.replace(/^\ufeff/, '');
    }
  }

  const { order, guessed } = opts.dateOrder
    ? { order: opts.dateOrder, guessed: false }
    : detectDateOrder(entries);

  const senders: string[] = [];
  const seen = new Set<string>();
  const messages: Message[] = entries.map((e, id) => {
    const msg = toMessage(e, id, order, ios > 0, opts.knownFiles);
    if (msg.sender && !seen.has(msg.sender)) {
      seen.add(msg.sender);
      senders.push(msg.sender);
    }
    return msg;
  });

  return {
    title: opts.title ?? 'WhatsApp chat',
    platform: ios > android ? 'ios' : android > 0 ? 'android' : 'unknown',
    dateOrder: order,
    dateOrderGuessed: guessed,
    senders,
    messages,
  };
}

function toMessage(e: RawEntry, id: number, order: DateOrder, ios: boolean, knownFiles?: Set<string>): Message {
  const ts = timestamp(e, order);
  let sender: string | null = null;
  let body = e.body;

  const colon = body.indexOf(': ');
  if (colon > 0 && !/["\u201c\u201d]/.test(body.slice(0, colon))) {
    sender = body.slice(0, colon).replace(BIDI_MARKS, '').replace(/^~\s*/, '').trim();
    body = body.slice(colon + 2);
  }
  const lrm = /^[\u200e\u200f]/.test(body);
  let text = body.replace(BIDI_MARKS, '');
  const msg: Message = { id, ts, sender, text };

  if (EDITED.test(text)) {
    msg.edited = true;
    text = text.replace(EDITED, '');
  }

  const firstLine = text.split('\n')[0].trim();
  const rest = text.slice(text.indexOf('\n') + 1);
  const hasRest = text.includes('\n');

  const attached = IOS_ATTACHED.exec(text);
  const androidAttached = ANDROID_ATTACHED.exec(firstLine);
  if (attached) {
    msg.media = attached[1].trim();
    text = text.replace(attached[0], '').trim();
  } else if (androidAttached) {
    msg.media = androidAttached[1];
    text = hasRest ? rest.trim() : '';
  } else if (knownFiles?.has(firstLine)) {
    msg.media = firstLine;
    text = hasRest ? rest.trim() : '';
  } else if (IOS_OMITTED.test(firstLine)) {
    const kind = firstLine.toLowerCase();
    msg.omitted = kind.startsWith('gif') ? 'image' : kind.startsWith('contact') ? 'contact'
      : (kind.split(/\s/)[0] as MediaKind);
    if (kind.endsWith('document omitted')) msg.omitted = 'document';
    text = '';
  } else if (/^<[^<>]*\s[^<>]*>$/.test(firstLine) && !hasRest && sender) {
    // "<Media omitted>" and its translations
    msg.omitted = 'media';
    text = '';
  } else if (DELETED.test(text.trim())) {
    msg.deleted = true;
  } else if (ios && lrm && !CALL.test(text)) {
    // On iPhone, "Family: Asha added Ravi" (text starting with U+200E) is a system line sent under the group's name.
    msg.sender = null;
  }

  msg.text = text.replace(/\s+$/, '');
  if (msg.sender === null) delete msg.media;
  return msg;
}

function year(n: number): number {
  return n < 100 ? 2000 + n : n;
}

function timestamp(e: RawEntry, order: DateOrder): number {
  const [a, b, c, h, min, s] = e.parts;
  const [y, mo, d] = order === 'YMD' ? [a, b, c] : order === 'DMY' ? [c, b, a] : [c, a, b];
  let hour = h;
  if (e.ampm) {
    const pm = e.ampm[0].toLowerCase() === 'p';
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  return Date.UTC(year(y), mo - 1, d, hour, min, s);
}

function detectDateOrder(entries: RawEntry[]): { order: DateOrder; guessed: boolean } {
  if (entries.some((e) => e.parts[0] > 31)) return { order: 'YMD', guessed: false };
  const firstOver12 = entries.some((e) => e.parts[0] > 12);
  const secondOver12 = entries.some((e) => e.parts[1] > 12);
  if (firstOver12 && !secondOver12) return { order: 'DMY', guessed: false };
  if (secondOver12 && !firstOver12) return { order: 'MDY', guessed: false };
  // Nothing settles it: messages are in time order, so pick the reading that goes backwards least.
  const backwards = (order: DateOrder) => {
    let count = 0;
    let prev = -Infinity;
    for (const e of entries) {
      const t = timestamp(e, order);
      if (t < prev) count++;
      prev = t;
    }
    return count;
  };
  const dmy = backwards('DMY');
  const mdy = backwards('MDY');
  return { order: mdy < dmy ? 'MDY' : 'DMY', guessed: dmy === mdy };
}
