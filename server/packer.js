// Packs one connection's outgoing messages into one deflate stream (see PACKED in
// shared/protocol.js). This is WebSocket compression done inside the app: Render's proxy drops
// the browser's offer of permessage-deflate, so the server can't turn that on.

import zlib from 'node:zlib';
import { PACKED } from '../shared/protocol.js';

const TAIL = Buffer.from(PACKED.tail);
// The same settings as the WebSocket compression in server.js: fast, with a 16 KB window, which
// keeps zlib's memory to about 128 KB a player.
const OPTIONS = { level: zlib.constants.Z_BEST_SPEED, memLevel: 7, windowBits: 14 };

export class Packer {
  constructor() {
    this.deflate = zlib.createDeflateRaw(OPTIONS);
    this.chunks = [];
    this.closed = false;
    this.deflate.on('data', (chunk) => this.chunks.push(chunk));
    this.deflate.on('error', () => this.close());
  }

  /**
   * Packs `text` and calls `done(frame)` with its bytes. Frames come out in the order the texts
   * went in, a moment later (zlib runs off the main thread). Nothing is called once closed.
   * @param {string} text
   * @param {(frame: Buffer) => void} done
   */
  pack(text, done) {
    if (this.closed) return;
    this.deflate.write(text + '\n');
    this.deflate.flush(zlib.constants.Z_SYNC_FLUSH, () => {
      if (this.closed) return;
      const out = Buffer.concat(this.chunks);
      this.chunks = [];
      done(out.subarray(-TAIL.length).equals(TAIL) ? out.subarray(0, -TAIL.length) : out);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.chunks = [];
    this.deflate.close();
  }
}
