// Test-only game. The server needs a client file to load a game; the tests never open a browser.

import { defineClientGame } from '/client/kit/index.js';

export default defineClientGame({
  mount() {
    return { destroy() {} };
  },
});
