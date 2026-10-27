import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import viewerJs from '../build-archive/viewer.js?raw';
import { sha256Hex } from './hash';
import type { Loaded } from './loader';
import type { ArchiveData, Chat } from './types';
import { VERSION, REPO_URL } from './version';

/** Single-file archives embed every attachment in the page; past this they get too heavy to open. */
export const SINGLE_FILE_LIMIT = 150 * 1024 * 1024;

const ARCHIVE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'self' file: data: blob:",
  "media-src 'self' file: data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

export type Progress = (message: string, fraction: number) => void;

export function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'WhatsApp chat';
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function archiveHtml(data: ArchiveData): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const js = viewerJs.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${ARCHIVE_CSP}">
<meta name="generator" content="Chat Keeper ${VERSION}">
<title>${escapeHtml(data.chat.title)} – WhatsApp archive</title>
</head>
<body>
<div id="app"></div>
<script>window.__CHAT_KEEPER__ = ${json};</script>
<script>${js}</script>
</body>
</html>
`;
}

function referenced(chat: Chat, has: (n: string) => boolean): string[] {
  const names = new Set<string>();
  for (const m of chat.messages) if (m.media && has(m.media)) names.add(m.media);
  return [...names];
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** One self-contained .html file with every attachment inside it. */
export async function exportSingleFile(loaded: Loaded, chat: Chat, progress: Progress): Promise<Blob> {
  const { store } = loaded;
  const names = referenced(chat, (n) => !!store.find(n));
  const media: Record<string, string> = {};
  const sizes: Record<string, number> = {};
  for (const [i, name] of names.entries()) {
    progress(`Adding ${name}`, i / Math.max(1, names.length));
    media[name] = await dataUrl(await store.read(name));
    sizes[name] = store.size(name);
  }
  const evidence = { ...loaded.evidence, generatedAt: new Date().toISOString() };
  progress('Writing the page', 1);
  return new Blob([archiveHtml({ version: VERSION, chat, evidence, media, sizes })], { type: 'text/html' });
}

/**
 * A zip with the archive page, every attachment, the original chat text and a SHA-256 list,
 * written to `target` when the browser can stream to disk, otherwise built as a Blob.
 */
export async function exportZip(loaded: Loaded, chat: Chat, progress: Progress, target?: WritableStream): Promise<Blob | undefined> {
  const { store, evidence: ev } = loaded;
  const root = `${safeName(chat.title)} (WhatsApp archive)/`;
  const writer = target ? new ZipWriter(target) : new ZipWriter(new BlobWriter('application/zip'));
  const sums: { path: string; sha256: string; size: number }[] = [];
  const add = async (path: string, blob: Blob) => {
    sums.push({ path, sha256: await sha256Hex(blob), size: blob.size });
    // Photos and videos are already compressed; storing them is much faster.
    const level = /\.(txt|html|json|vcf|csv)$/i.test(path) ? 6 : 0;
    await writer.add(root + path, new BlobReader(blob), { level });
  };

  const names = store.names().filter((n) => n !== ev.chatFileName);
  const total = store.totalSize || 1;
  let done = 0;
  const media: Record<string, string> = {};
  const sizes: Record<string, number> = {};
  for (const name of names) {
    progress(`Adding ${name}`, done / total);
    await add(`media/${name}`, await store.read(name));
    media[name] = 'media/' + encodeURIComponent(name);
    sizes[name] = store.size(name);
    done += store.size(name);
  }
  progress('Adding the original chat text', done / total);
  await add(`original/${ev.chatFileName}`, loaded.chatFile);

  const evidence = { ...ev, generatedAt: new Date().toISOString() };
  const html = archiveHtml({ version: VERSION, chat, evidence, media, sizes });
  await add('index.html', new Blob([html], { type: 'text/html' }));

  const manifest = {
    tool: { name: 'Chat Keeper', version: VERSION, url: REPO_URL },
    generatedAt: evidence.generatedAt,
    source: { name: ev.sourceName, size: ev.sourceSize, sha256: ev.sourceSha256 ?? null },
    chat: {
      title: chat.title,
      platform: chat.platform,
      dateOrder: chat.dateOrder,
      messages: chat.messages.length,
      first: chat.messages[0] ? new Date(chat.messages[0].ts).toISOString().slice(0, 19) : null,
      last: chat.messages.length ? new Date(chat.messages[chat.messages.length - 1].ts).toISOString().slice(0, 19) : null,
      participants: chat.senders,
    },
    files: [...sums],
  };
  await add('manifest.json', new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
  await writer.add(root + 'SHA256SUMS.txt', new TextReader(sums.map((s) => `${s.sha256}  ${s.path}`).join('\n') + '\n'));
  await writer.add(root + 'README.txt', new TextReader(readme(chat.title, ev.sourceName, ev.sourceSha256)));

  progress('Finishing the zip', 1);
  const out = await writer.close();
  return target ? undefined : (out as Blob);
}

function readme(title: string, source: string, sourceSha?: string): string {
  return `${title} – WhatsApp archive
Made with Chat Keeper ${VERSION} (${REPO_URL}) on ${new Date().toString()}.

Open index.html in any web browser to read the chat. It works offline and makes no
network requests. Keep index.html next to the media folder.

  index.html       the chat, searchable, with photos and videos inline
  media/           every file that came with the export, byte for byte
  original/        the chat text exactly as WhatsApp exported it
  manifest.json    what was archived, with sizes and SHA-256 hashes
  SHA256SUMS.txt   the same hashes, for checking with a terminal:
                     shasum -a 256 -c SHA256SUMS.txt      (macOS, Linux)

Original export: ${source}${sourceSha ? `\nSHA-256 of original export: ${sourceSha}` : ''}

Times are shown exactly as written in the export, in the phone's time zone at the time.
These hashes show the files have not changed since this archive was made. They do not, on
their own, prove where the original export came from.
`;
}
