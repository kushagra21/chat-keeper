export type MediaKind = 'image' | 'video' | 'audio' | 'sticker' | 'document' | 'contact' | 'other';

export interface Message {
  id: number;
  /** Wall-clock time as written in the export, stored as a UTC timestamp so no time zone shifts it. */
  ts: number;
  /** null for system lines ("Asha added Ravi", the encryption notice, ...). */
  sender: string | null;
  text: string;
  /** Attached file name, when the export included media. */
  media?: string;
  /** Kind of media that WhatsApp left out of the export ("image omitted", "<Media omitted>"). */
  omitted?: MediaKind | 'media';
  deleted?: boolean;
  edited?: boolean;
}

export type DateOrder = 'DMY' | 'MDY' | 'YMD';

export interface Chat {
  title: string;
  platform: 'ios' | 'android' | 'unknown';
  dateOrder: DateOrder;
  /** True when nothing in the file settled whether it was day/month or month/day. */
  dateOrderGuessed: boolean;
  senders: string[];
  messages: Message[];
}

/** Facts about the original export, shown in the archive and the PDF so a copy can be checked later. */
export interface Evidence {
  sourceName: string;
  sourceSize: number;
  sourceSha256?: string;
  chatFileName: string;
  chatFileSha256?: string;
  generatedAt?: string;
}

/** What an exported archive page carries: the parsed chat plus where each attachment lives. */
export interface ArchiveData {
  version: string;
  chat: Chat;
  evidence: Evidence;
  /** Attachment name to a relative path ("media/x.jpg") or, in a single-file archive, a data URL. */
  media: Record<string, string>;
  sizes: Record<string, number>;
}
