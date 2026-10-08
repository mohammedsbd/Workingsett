import { sha256Hex } from '../canonical-json';
import { ImageRef } from './internal-model';

const DATA_URL = /^data:([^;,]+)?(;base64)?,(.*)$/s;

/** Approximate decoded size of base64 data, without decoding it. */
function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/** A reference to inline base64 image data: its hash, type and size. */
export function dataImageRef(mediaType: string | null, data: string): ImageRef {
  return {
    source: 'data',
    mediaType,
    sha256: sha256Hex(data),
    bytes: base64Bytes(data),
  };
}

/** OpenAI image_url values: an http(s) URL or a data: URL. */
export function imageRefFromUrl(url: string): ImageRef {
  const match = DATA_URL.exec(url);
  if (!match) return { source: 'url', url };
  return dataImageRef(match[1] ?? null, match[3]);
}
