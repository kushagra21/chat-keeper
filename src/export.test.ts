import { BlobReader, BlobWriter, TextWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { exportZip } from './export';
import { sha256Hex } from './hash';
import { loadFiles } from './loader';
import { sampleZip } from './sample';

const sampleFile = () =>
  new File([Buffer.from(sampleZip.split(',')[1], 'base64')], 'WhatsApp Chat - Hill Walk Club.zip', { type: 'application/zip' });

describe('loading and exporting the sample chat', async () => {
  const loaded = await loadFiles([sampleFile()]);

  it('loads the chat, its title and its media', () => {
    expect(loaded.chat.title).toBe('Hill Walk Club');
    expect(loaded.chat.senders).toEqual(['Priya Nair', 'Tom Okafor', 'Lena Brandt']);
    expect(loaded.chat.messages.filter((m) => m.media).every((m) => loaded.store.find(m.media!))).toBe(true);
  });

  it('hashes like the system tools do', async () => {
    const bytes = Buffer.from(await loaded.source.arrayBuffer());
    expect(await sha256Hex(loaded.source)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('writes an archive whose checksums match its contents', async () => {
    loaded.evidence.sourceSha256 = await sha256Hex(loaded.source);
    const blob = (await exportZip(loaded, loaded.chat, () => {}))!;
    const entries = (await new ZipReader(new BlobReader(blob)).getEntries()) as FileEntry[];
    const root = 'Hill Walk Club (WhatsApp archive)/';
    const names = entries.map((e) => e.filename.slice(root.length)).sort();
    expect(names).toEqual([
      'README.txt', 'SHA256SUMS.txt', 'index.html', 'manifest.json',
      'media/00000007-DOCUMENT-ridge-loop.pdf',
      'media/00000012-PHOTO-2024-03-09-10-15-44.jpg',
      'media/00000013-PHOTO-2024-03-09-12-40-09.jpg',
      'media/00000014-PHOTO-2024-03-10-09-12-31.jpg',
      'original/_chat.txt',
    ]);

    const byName = new Map(entries.map((e) => [e.filename.slice(root.length), e]));
    const sums = await byName.get('SHA256SUMS.txt')!.getData(new TextWriter());
    for (const line of sums.trim().split('\n')) {
      const [hash, path] = line.split('  ');
      const data = await byName.get(path)!.getData(new BlobWriter());
      expect(await sha256Hex(data), path).toBe(hash);
    }

    const html = await byName.get('index.html')!.getData(new TextWriter());
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('"media/00000012-PHOTO-2024-03-09-10-15-44.jpg"');
    expect(html.match(/<\/script>/g)).toHaveLength(2);

    const manifest = JSON.parse(await byName.get('manifest.json')!.getData(new TextWriter()));
    expect(manifest.source.sha256).toBe(loaded.evidence.sourceSha256);
    expect(manifest.chat.messages).toBe(loaded.chat.messages.length);
  });
});
