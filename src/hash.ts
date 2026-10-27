import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const SLICE = 8 * 1024 * 1024;

/** SHA-256 of a file or blob, read in slices so multi-gigabyte exports never sit in memory at once. */
export async function sha256Hex(blob: Blob, onProgress?: (done: number) => void): Promise<string> {
  const h = sha256.create();
  for (let at = 0; at < blob.size; at += SLICE) {
    h.update(new Uint8Array(await blob.slice(at, at + SLICE).arrayBuffer()));
    onProgress?.(Math.min(at + SLICE, blob.size));
  }
  return bytesToHex(h.digest());
}
