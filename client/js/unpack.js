// Unpacks the server's packed messages (PACKED in shared/protocol.js): one inflater per
// connection, fed every binary frame in order, giving back the JSON text of each message.
//
// This file imports only by relative path and uses web APIs Node has too, so the tests' client
// unpacks with this same code.

import { PACKED } from '../../shared/protocol.js';

const TAIL = new Uint8Array(PACKED.tail);

/** True where this browser can unpack (DecompressionStream with raw deflate). */
export function canUnpack() {
  try {
    // eslint-disable-next-line no-new
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {(text: string) => void} onText   called with each message's JSON, in order
 * @param {(err: Error) => void} onError    the stream is broken (nothing more will come)
 * @returns {{ push(frame: ArrayBuffer | Uint8Array): void, end(): Promise<void> }}
 *   end(): no more frames are coming. Resolves once the ones already pushed have been handed over.
 */
export function createUnpacker(onText, onError) {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.pipeThrough(new TextDecoderStream()).getReader();
  let broken = false;
  let ended = false;
  let text = '';
  // Every frame holds exactly one message, so the counts say when all pushed ones are out.
  let pushed = 0;
  let handed = 0;
  let drained = null; // resolves end()'s promise
  const settle = () => {
    if (drained && (broken || handed >= pushed)) {
      drained();
      writer.abort().catch(() => {});
    }
  };
  const fail = (err) => {
    // Once ended and empty, the writer is aborted on purpose: what that breaks is expected.
    if (broken || (ended && handed >= pushed)) return;
    broken = true;
    onError(err);
    settle();
  };

  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || broken) return;
      text += value;
      let end;
      while ((end = text.indexOf('\n')) !== -1) {
        const line = text.slice(0, end);
        text = text.slice(end + 1);
        handed++;
        onText(line);
      }
      settle();
    }
  })().catch(fail);

  return {
    push(frame) {
      if (ended || broken) return;
      const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
      const whole = new Uint8Array(bytes.length + TAIL.length);
      whole.set(bytes);
      whole.set(TAIL, bytes.length);
      pushed++;
      writer.write(whole).catch(fail);
    },
    end() {
      ended = true;
      const done = new Promise((resolve) => { drained = resolve; });
      settle();
      return done;
    },
  };
}
