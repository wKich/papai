// Client test preload: registers happy-dom DOM globals on globalThis.
//
// Used by `bun test:client` (added in a later task) and any test runner that
// includes `--preload ./tests/client-setup.ts`. After this file runs, tests can
// use `document`, `window`, `HTMLElement`, etc. directly without importing
// happy-dom in each test file.
//
// happy-dom 20.x does not ship `@happy-dom/global-registrator`, so we instead
// instantiate a `GlobalWindow` and reflectively copy its own properties onto
// `globalThis`. `GlobalWindow` (unlike `Window`) wires built-ins such as
// `SyntaxError` onto itself, which happy-dom's internals rely on.

import { GlobalWindow } from 'happy-dom'

const browserWindow = new GlobalWindow()

for (const key of Object.getOwnPropertyNames(browserWindow)) {
  if (key in globalThis) {
    continue
  }
  try {
    Reflect.set(globalThis, key, Reflect.get(browserWindow, key))
  } catch {
    // Some properties are non-writable on globalThis (e.g. `undefined`);
    // skip them rather than failing the whole preload.
  }
}

// Force-assign the critical DOM entry points so tests can rely on them even
// if a prior preload left stale values behind.
Reflect.set(globalThis, 'window', browserWindow)
Reflect.set(globalThis, 'document', browserWindow.document)
