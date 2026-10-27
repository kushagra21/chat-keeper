import { describe, expect, it } from 'vitest';
import { looksLikeChat, mediaKind, parseChat } from './parser';

const LRM = '\u200e';
const NNBSP = '\u202f';

const iso = (ts: number) => new Date(ts).toISOString().slice(0, 19);

describe('iPhone exports', () => {
  const text = [
    `[05/01/2023, 10:22:33] Family: ${LRM}Messages and calls are end-to-end encrypted.`,
    `[05/01/2023, 10:23:01] Asha Rao: Morning all`,
    `[05/01/2023, 10:23:40] Ravi: ${LRM}<attached: 00000012-PHOTO-2023-01-05-10-23-40.jpg>`,
    `[05/01/2023, 10:24:00] Asha Rao: ${LRM}image omitted`,
    `[05/01/2023, 10:25:00] Ravi: First line`,
    `second line`,
    ``,
    `fourth line`,
    `[14/01/2023, 18:02:11] Family: ${LRM}Asha Rao added Meera`,
    `[14/01/2023, 18:03:00] Meera: ${LRM}This message was deleted.`,
    `[14/01/2023, 18:04:00] Meera: Typo fixed ${LRM}<This message was edited>`,
    `[14/01/2023, 18:05:00] Ravi: ${LRM}Missed voice call`,
    `[14/01/2023, 18:06:00] ~${NNBSP}Unknown Person: hello`,
  ].join('\n');
  const chat = parseChat(text);

  it('detects the platform and the date order', () => {
    expect(chat.platform).toBe('ios');
    expect(chat.dateOrder).toBe('DMY');
    expect(chat.dateOrderGuessed).toBe(false);
    expect(iso(chat.messages[5].ts)).toBe('2023-01-14T18:02:11');
  });

  it('treats lines sent under the group name as system lines', () => {
    expect(chat.messages[0].sender).toBeNull();
    expect(chat.messages[5]).toMatchObject({ sender: null, text: 'Asha Rao added Meera' });
    expect(chat.senders).toEqual(['Asha Rao', 'Ravi', 'Meera', 'Unknown Person']);
  });

  it('finds attachments and omitted media', () => {
    expect(chat.messages[2]).toMatchObject({ sender: 'Ravi', media: '00000012-PHOTO-2023-01-05-10-23-40.jpg', text: '' });
    expect(chat.messages[3]).toMatchObject({ omitted: 'image', text: '' });
  });

  it('keeps multi-line messages together', () => {
    expect(chat.messages[4].text).toBe('First line\nsecond line\n\nfourth line');
  });

  it('flags deleted and edited messages, keeps calls with their sender', () => {
    expect(chat.messages[6]).toMatchObject({ sender: 'Meera', deleted: true });
    expect(chat.messages[7]).toMatchObject({ text: 'Typo fixed', edited: true });
    expect(chat.messages[8]).toMatchObject({ sender: 'Ravi', text: 'Missed voice call' });
  });
});

describe('iPhone exports with two-digit years (shapes from a real export, names changed)', () => {
  const text = [
    `[02/06/25, 10:45:14${NNBSP}AM] Weekend Plans: ${LRM}Messages and calls are end-to-end encrypted.`,
    `[02/06/25, 10:45:14${NNBSP}AM] Sam Lee: ${LRM}Sam Lee created group “Weekend Plans”`,
    `[02/06/25, 10:45:15${NNBSP}AM] Weekend Plans: ${LRM}Sam Lee added you`,
    `[03/06/25, 10:01:21${NNBSP}AM] Jo: ${LRM}<attached: 00000043-STICKER-2025-06-03-10-01-21.webp>`,
    `[09/11/25, 9:18:55${NNBSP}PM] Jo: ${LRM}<attached: 00000140-GIF-2025-11-09-21-18-55.mp4>`,
    `[10/11/25, 8:00:00${NNBSP}PM] Sam Lee: ${LRM}Voice call, ${LRM}${LRM}9 min ${LRM}• ${LRM}3 joined`,
    `[11/11/25, 8:00:00${NNBSP}PM] Weekend Plans: ${LRM}Your security code with Jo changed.`,
  ].join('\r\n');
  const chat = parseChat(text);

  it('reads the dates and times', () => {
    expect(chat.dateOrder).toBe('DMY');
    expect(iso(chat.messages[0].ts)).toBe('2025-06-02T10:45:14');
    expect(iso(chat.messages[4].ts)).toBe('2025-11-09T21:18:55');
  });

  it('treats group events as system lines, even when sent under a person', () => {
    expect(chat.messages.slice(0, 3).every((m) => m.sender === null)).toBe(true);
    expect(chat.messages[1].text).toBe('Sam Lee created group “Weekend Plans”');
    expect(chat.messages[6].sender).toBeNull();
    expect(chat.senders).toEqual(['Jo', 'Sam Lee']);
  });

  it('keeps stickers, GIFs and call summaries', () => {
    expect(chat.messages[3].media).toBe('00000043-STICKER-2025-06-03-10-01-21.webp');
    expect(mediaKind(chat.messages[3].media!)).toBe('sticker');
    expect(chat.messages[4].media).toBe('00000140-GIF-2025-11-09-21-18-55.mp4');
    expect(chat.messages[5]).toMatchObject({ sender: 'Sam Lee', text: 'Voice call, 9 min • 3 joined' });
  });
});

describe('Android exports', () => {
  const text = [
    `1/5/23, 10:22 AM - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.`,
    `1/5/23, 10:23 AM - Asha: Morning`,
    `1/5/23, 12:05 PM - Ravi: IMG-20230105-WA0003.jpg (file attached)`,
    `Look at this`,
    `1/5/23, 12:30 AM - Ravi: <Media omitted>`,
    `1/13/23, 9:15${NNBSP}PM - Asha changed the subject from "Trip: day 1" to "Trip"`,
    `1/13/23, 9:16 PM - Asha: PTT-20230113-WA0001.opus (Datei angehängt)`,
  ].join('\n');
  const chat = parseChat(text);

  it('reads US dates and 12-hour times', () => {
    expect(chat.platform).toBe('android');
    expect(chat.dateOrder).toBe('MDY');
    expect(iso(chat.messages[2].ts)).toBe('2023-01-05T12:05:00');
    expect(iso(chat.messages[3].ts)).toBe('2023-01-05T00:30:00');
    expect(iso(chat.messages[4].ts)).toBe('2023-01-13T21:15:00');
  });

  it('finds attachments with captions, in any language', () => {
    expect(chat.messages[2]).toMatchObject({ media: 'IMG-20230105-WA0003.jpg', text: 'Look at this' });
    expect(chat.messages[5]).toMatchObject({ media: 'PTT-20230113-WA0001.opus' });
    expect(chat.messages[3]).toMatchObject({ omitted: 'media' });
  });

  it('does not mistake system lines with colons for messages', () => {
    expect(chat.messages[0].sender).toBeNull();
    expect(chat.messages[4].sender).toBeNull();
    expect(chat.senders).toEqual(['Asha', 'Ravi']);
  });
});

describe('other formats', () => {
  it('reads German dates', () => {
    const chat = parseChat('05.01.23, 22:10 - Jonas: Hallo\n06.01.23, 08:00 - Lena: Morgen');
    expect(iso(chat.messages[1].ts)).toBe('2023-01-06T08:00:00');
  });

  it('reads year-first dates', () => {
    const chat = parseChat('[2023-01-05 22:10:00] Mei: hi\n[2023-01-06 08:00:00] Jun: hey');
    expect(chat.dateOrder).toBe('YMD');
    expect(iso(chat.messages[0].ts)).toBe('2023-01-05T22:10:00');
  });

  it('uses time order when every day is 12 or below', () => {
    const lines = ['03/01/2023, 10:00 - A: x', '04/01/2023, 10:00 - B: y', '05/01/2023, 10:00 - A: z'];
    expect(parseChat(lines.join('\n')).dateOrder).toBe('DMY');
    const swapped = ['12/01/2023, 10:00 - A: x', '01/02/2023, 10:00 - B: y', '02/02/2023, 10:00 - A: z'];
    expect(parseChat(swapped.join('\n')).dateOrder).toBe('DMY');
    const us = ['01/12/2023, 10:00 - A: x', '02/01/2023, 10:00 - B: y', '02/02/2023, 10:00 - A: z'];
    expect(parseChat(us.join('\n')).dateOrder).toBe('MDY');
  });

  it('can be forced to a date order', () => {
    const chat = parseChat('03/04/2023, 10:00 - A: x', { dateOrder: 'MDY' });
    expect(iso(chat.messages[0].ts)).toBe('2023-03-04T10:00:00');
  });

  it('recognises known file names without a marker', () => {
    const chat = parseChat('03/04/2023, 10:00 - A: scan.pdf', { knownFiles: new Set(['scan.pdf']) });
    expect(chat.messages[0]).toMatchObject({ media: 'scan.pdf', text: '' });
  });

  it('strips a byte-order mark and handles CRLF', () => {
    const chat = parseChat('﻿[05/01/2023, 10:22:33] A: one\r\n[05/01/2023, 10:23:33] B: two\r\n');
    expect(chat.messages.map((m) => m.text)).toEqual(['one', 'two']);
  });

  it('tells chats from other text files', () => {
    expect(looksLikeChat('[05/01/2023, 10:22:33] A: one')).toBe(true);
    expect(looksLikeChat('Shopping list\nmilk\neggs')).toBe(false);
  });

  it('classifies media by extension', () => {
    expect(mediaKind('00000012-PHOTO-2023.jpg')).toBe('image');
    expect(mediaKind('VID-1.mp4')).toBe('video');
    expect(mediaKind('PTT-1.opus')).toBe('audio');
    expect(mediaKind('STK-1.webp')).toBe('sticker');
    expect(mediaKind('Asha.vcf')).toBe('contact');
    expect(mediaKind('lease.pdf')).toBe('document');
  });
});
