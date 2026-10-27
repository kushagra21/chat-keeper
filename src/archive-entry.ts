// The read-only viewer bundled into every exported archive page.
import type { ArchiveData } from './types';
import { el } from './viewer/format';
import { mountViewer } from './viewer/viewer';

declare global {
  interface Window {
    __CHAT_KEEPER__?: ArchiveData;
  }
}

const data = window.__CHAT_KEEPER__;
const root = document.getElementById('app')!;
if (!data) {
  root.textContent = 'This archive page is missing its chat data.';
} else {
  const { chat, evidence, media, sizes } = data;
  const made = evidence.generatedAt ? new Date(evidence.generatedAt).toLocaleDateString() : '';
  mountViewer(root, {
    chat,
    evidence,
    mediaUrl: async (name) => media[name],
    hasMedia: (name) => name in media,
    mediaSize: (name) => sizes[name] ?? 0,
    banner: el('div', { class: 'archive-banner' },
      `Archive made ${made} with Chat Keeper ${data.version}. It works offline; keep this page next to its media folder.`),
  });
}
