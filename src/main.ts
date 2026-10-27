import './app.css';
import { SINGLE_FILE_LIMIT, exportSingleFile, exportZip, safeName } from './export';
import { sha256Hex } from './hash';
import { LoadError, loadFiles, type Loaded } from './loader';
import type { Chat } from './types';
import { el, formatSize } from './viewer/format';
import { injectViewerStyles, mountViewer, type Viewer } from './viewer/viewer';

injectViewerStyles();

const landing = document.getElementById('landing')!;
const app = document.getElementById('app')!;
const drop = document.getElementById('drop')!;
const status = document.getElementById('status')!;
const pickFiles = document.getElementById('pick-files') as HTMLInputElement;
const pickFolder = document.getElementById('pick-folder') as HTMLInputElement;

if (!('webkitdirectory' in pickFolder) || /iPhone|iPad|Android/.test(navigator.userAgent)) {
  document.getElementById('folder-label')!.hidden = true;
}

let session: { loaded: Loaded; chat: Chat; viewer: Viewer; urls: Map<string, string>; hashing: Promise<void>; closed: boolean } | undefined;

function setStatus(text: string, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

async function open(files: File[]) {
  if (!files.length) return;
  setStatus('Reading the export…');
  try {
    const loaded = await loadFiles(files);
    show(loaded, loaded.chat);
    setStatus('');
  } catch (e) {
    console.error(e);
    setStatus(e instanceof LoadError ? e.message : `Something went wrong reading that file: ${(e as Error).message}`, true);
  }
}

function show(loaded: Loaded, chat: Chat) {
  const urls = session?.loaded === loaded ? session.urls : new Map<string, string>();
  const hashing = session?.loaded === loaded ? session.hashing : hashEvidence(loaded);
  session?.viewer.destroy();

  const saveBtn = el('button', { type: 'button', class: 'btn primary' }, 'Save archive');
  const closeBtn = el('button', { type: 'button', class: 'btn' }, 'Close');
  saveBtn.addEventListener('click', () => openExport());
  closeBtn.addEventListener('click', close);

  const viewer = mountViewer(app, {
    chat,
    evidence: loaded.evidence,
    hasMedia: (name) => !!loaded.store.find(name),
    mediaSize: (name) => loaded.store.size(name),
    mediaUrl: async (name) => {
      const found = loaded.store.find(name);
      if (!found) return undefined;
      let url = urls.get(found);
      if (!url) {
        url = URL.createObjectURL(await loaded.store.blob(found));
        urls.set(found, url);
      }
      return url;
    },
    actions: [saveBtn, closeBtn],
    onDateOrder: (order) => show(loaded, loaded.reparse(order)),
  });
  session = { loaded, chat, viewer, urls, hashing, closed: false };
  landing.hidden = true;
  document.title = `${chat.title} – Chat Keeper`;
  window.scrollTo({ top: 0 });
}

async function hashEvidence(loaded: Loaded) {
  const ev = loaded.evidence;
  ev.sourceSha256 = await sha256Hex(loaded.source);
  session?.viewer.refreshInfo();
  ev.chatFileSha256 = loaded.chatFile === loaded.source ? ev.sourceSha256 : await sha256Hex(loaded.chatFile);
  session?.viewer.refreshInfo();
}

function close() {
  if (!session) return;
  session.viewer.destroy();
  for (const url of session.urls.values()) URL.revokeObjectURL(url);
  session.closed = true;
  session = undefined;
  pickFiles.value = pickFolder.value = '';
  landing.hidden = false;
  document.title = 'Chat Keeper';
}

// ---- saving an archive

interface SaveFilePicker {
  showSaveFilePicker?: (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) =>
    Promise<{ createWritable(): Promise<WritableStream> }>;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function openExport() {
  if (!session) return;
  const s = session;
  const { loaded, chat } = s;
  const mediaSize = loaded.store.totalSize - loaded.chatFile.size;
  const tooBig = mediaSize > SINGLE_FILE_LIMIT;

  const zipRadio = el('input', { type: 'radio', name: 'fmt', value: 'zip', checked: '' });
  const htmlRadio = el('input', { type: 'radio', name: 'fmt', value: 'html', disabled: tooBig ? '' : undefined });
  const bar = el('div');
  const progressBox = el('div', { hidden: '' }, el('div', { class: 'progress' }, bar), el('p', { class: 'small' }));
  const note = progressBox.lastElementChild as HTMLElement;
  const go = el('button', { type: 'button', class: 'btn primary' }, 'Save');
  const cancel = el('button', { type: 'button', class: 'btn' }, 'Cancel');

  const panel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Save archive' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Save archive')),
    el('label', { class: 'choice' }, zipRadio, el('b', {}, 'Archive folder (.zip)'),
      el('span', { class: 'small' }, `A page to open in any browser, every file byte for byte (${formatSize(mediaSize)}), the original chat text and SHA-256 checksums. Best for keeping and for evidence.`)),
    el('label', { class: `choice${tooBig ? ' disabled' : ''}` }, htmlRadio, el('b', {}, 'Single page (.html)'),
      el('span', { class: 'small' }, tooBig
        ? `Not available: the attachments (${formatSize(mediaSize)}) are too big to fit in one page.`
        : 'One file with the photos and videos inside it. Easy to email or keep on a phone.')),
    progressBox,
    el('div', { class: 'panel-foot' }, cancel, go));
  const back = el('div', { class: 'overlay' }, panel);
  app.append(back);
  cancel.addEventListener('click', () => back.remove());

  const progress = (message: string, fraction: number) => {
    note.textContent = message;
    bar.style.width = `${Math.round(fraction * 100)}%`;
  };

  go.addEventListener('click', async () => {
    const base = `${safeName(chat.title)} – WhatsApp archive`;
    const single = htmlRadio.checked;
    go.disabled = true;
    cancel.disabled = true;
    try {
      // Ask where to save first, while the click still counts as the user's.
      const picker = (window as unknown as SaveFilePicker).showSaveFilePicker;
      let target: WritableStream | undefined;
      if (!single && picker) {
        try {
          const handle = await picker({ suggestedName: `${base}.zip`, types: [{ description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }] });
          target = await handle.createWritable();
        } catch (e) {
          if ((e as Error).name === 'AbortError') {
            go.disabled = cancel.disabled = false;
            return;
          }
        }
      }
      progressBox.hidden = false;
      progress('Checking the original export…', 0);
      await s.hashing;
      if (single) {
        download(await exportSingleFile(loaded, chat, progress), `${base}.html`);
      } else {
        const blob = await exportZip(loaded, chat, progress, target);
        if (blob) download(blob, `${base}.zip`);
      }
      progress('Saved.', 1);
      cancel.textContent = 'Close';
    } catch (e) {
      console.error(e);
      progress(`Could not save: ${(e as Error).message}`, 0);
    } finally {
      cancel.disabled = false;
    }
  });
}

// ---- picking files

pickFiles.addEventListener('change', () => open([...(pickFiles.files ?? [])]));
pickFolder.addEventListener('change', () => open([...(pickFolder.files ?? [])]));

document.getElementById('sample')!.addEventListener('click', async () => {
  const { sampleZip } = await import('./sample');
  const bytes = Uint8Array.from(atob(sampleZip.split(',')[1]), (c) => c.charCodeAt(0));
  void open([new File([bytes], 'WhatsApp Chat - Hill Walk Club.zip', { type: 'application/zip' })]);
});

async function filesFromDrop(items: DataTransferItemList): Promise<File[]> {
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  const entries = [...items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  for (const e of entries) await walk(e);
  return out;
}

for (const type of ['dragenter', 'dragover'] as const) {
  window.addEventListener(type, (e) => {
    e.preventDefault();
    if (!session) drop.classList.add('over');
  });
}
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) drop.classList.remove('over');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (session || !e.dataTransfer) return;
  const files = e.dataTransfer.items.length && 'webkitGetAsEntry' in DataTransferItem.prototype
    ? await filesFromDrop(e.dataTransfer.items)
    : [...e.dataTransfer.files];
  void open(files);
});
