import { BlobReader, BlobWriter, TextWriter, ZipReader, configure, type FileEntry } from '@zip.js/zip.js';
import { looksLikeChat, parseChat } from './parser';
import type { Chat, DateOrder, Evidence } from './types';

// Everything runs on the page itself: no worker scripts, native (de)compression only.
configure({ useWebWorkers: false, useCompressionStream: true });

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', avif: 'image/avif', mp4: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp',
  webm: 'video/webm', m4v: 'video/mp4', opus: 'audio/ogg', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp3: 'audio/mpeg', aac: 'audio/aac', wav: 'audio/wav', amr: 'audio/amr', pdf: 'application/pdf',
  vcf: 'text/vcard', txt: 'text/plain',
};

export const mimeOf = (name: string) => MIME[name.toLowerCase().split('.').pop() ?? ''] ?? 'application/octet-stream';
const basename = (path: string) => path.split('/').pop() ?? path;

/** The media files that came with the chat, read lazily: a 2 GB export never sits in memory at once. */
export class MediaStore {
  private byName = new Map<string, { size: number; read: () => Promise<Blob> }>();
  private lower = new Map<string, string>();
  private cache = new Map<string, Promise<Blob>>();

  add(name: string, size: number, read: () => Promise<Blob>) {
    this.byName.set(name, { size, read });
    this.lower.set(name.toLowerCase(), name);
  }

  /** The stored name for a file the chat refers to, matching case-insensitively. */
  find(name: string): string | undefined {
    return this.byName.has(name) ? name : this.lower.get(name.toLowerCase());
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  size(name: string): number {
    return this.byName.get(name)?.size ?? 0;
  }

  get totalSize(): number {
    let n = 0;
    for (const f of this.byName.values()) n += f.size;
    return n;
  }

  blob(name: string): Promise<Blob> {
    let p = this.cache.get(name);
    if (!p) {
      const f = this.byName.get(name);
      if (!f) return Promise.reject(new Error(`No file named ${name}`));
      p = f.read();
      this.cache.set(name, p);
    }
    return p;
  }

  /** Reads a file without keeping it, for one-off passes such as building an archive. */
  read(name: string): Promise<Blob> {
    return this.cache.get(name) ?? this.byName.get(name)!.read();
  }
}

export interface Loaded {
  chat: Chat;
  chatText: string;
  chatFile: Blob;
  store: MediaStore;
  evidence: Evidence;
  /** The original zip or text file, hashed for the evidence record. */
  source: Blob;
  reparse: (order: DateOrder) => Chat;
}

export class LoadError extends Error {}

export function titleFrom(name: string): string | undefined {
  const base = name.replace(/\.(zip|txt)$/i, '').replace(/\s*\(\d+\)$/, '');
  const m = /^WhatsApp Chat(?: with| -)\s*(.+)$/i.exec(base);
  return m ? m[1].trim() : undefined;
}

export async function loadFiles(files: File[]): Promise<Loaded> {
  const zip = files.find((f) => /\.zip$/i.test(f.name));
  if (zip) return loadZip(zip);

  const store = new MediaStore();
  const texts: File[] = [];
  for (const f of files) {
    if (/\.txt$/i.test(f.name)) texts.push(f);
    store.add(f.name, f.size, async () => f);
  }
  const chatFile = await pickChat(texts, (f) => f.text(), (f) => f.name, (f) => f.size);
  if (!chatFile) throw new LoadError('No WhatsApp chat (.txt) found. Choose the .zip that WhatsApp made, or its _chat.txt file.');
  const text = await chatFile.text();
  return finish(text, chatFile, chatFile.name, store, chatFile, chatFile.name);
}

async function loadZip(zip: File): Promise<Loaded> {
  let entries;
  try {
    entries = await new ZipReader(new BlobReader(zip)).getEntries();
  } catch {
    throw new LoadError(`${zip.name} could not be opened as a zip file.`);
  }
  const files = entries.filter((e): e is FileEntry => !e.directory && !basename(e.filename).startsWith('._') && !e.filename.startsWith('__MACOSX/'));
  const store = new MediaStore();
  for (const e of files) {
    store.add(basename(e.filename), e.uncompressedSize, () => e.getData(new BlobWriter(mimeOf(e.filename))));
  }
  const texts = files.filter((e) => /\.txt$/i.test(e.filename));
  const readText = (e: FileEntry) => e.getData(new TextWriter('utf-8'));
  const entry = await pickChat(texts, readText, (e) => basename(e.filename), (e) => e.uncompressedSize);
  if (!entry) throw new LoadError(`${zip.name} has no WhatsApp chat in it.`);
  // Keep the chat file's exact bytes, so its hash matches the file inside the zip.
  const chatFile = await entry.getData(new BlobWriter('text/plain'));
  return finish(await chatFile.text(), chatFile, basename(entry.filename), store, zip, zip.name);
}

async function pickChat<T>(
  candidates: T[],
  read: (c: T) => Promise<string>,
  name: (c: T) => string,
  size: (c: T) => number,
): Promise<T | undefined> {
  const named = candidates.find((c) => /^(_chat\.txt|WhatsApp Chat.*\.txt)$/i.test(name(c)));
  if (named) return named;
  for (const c of [...candidates].sort((a, b) => size(b) - size(a))) {
    if (looksLikeChat(await read(c))) return c;
  }
  return undefined;
}

function finish(text: string, chatFile: Blob, chatFileName: string, store: MediaStore, source: Blob, sourceName: string): Loaded {
  const knownFiles = new Set(store.names());
  const title = titleFrom(sourceName) ?? titleFrom(chatFileName);
  const parse = (dateOrder?: DateOrder) => {
    const chat = parseChat(text, { knownFiles, dateOrder });
    if (!chat.messages.length) throw new LoadError(`${chatFileName} does not look like a WhatsApp chat export.`);
    chat.title = title ?? (chat.senders.length === 2 ? chat.senders.join(' & ') : 'WhatsApp chat');
    for (const m of chat.messages) if (m.media) m.media = store.find(m.media) ?? m.media;
    return chat;
  };
  return {
    chat: parse(),
    chatText: text,
    chatFile,
    store,
    source,
    evidence: { sourceName, sourceSize: source.size, chatFileName },
    reparse: (order) => parse(order),
  };
}
