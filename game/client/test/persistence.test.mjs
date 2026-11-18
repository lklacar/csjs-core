import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { preparePersistence } from "../dist/persistence.js";

function runtime(restoreError, saveError) {
  const writes = [];
  const storedConfig = "bind w +forward";
  const module = {
    IDBFS: { syncfs(_mount, _populate, callback) { callback(saveError); } },
    FS: {
      mkdirTree() {}, mount() { return { mount: {} }; },
      syncfs(_populate, callback) { callback(restoreError); },
      readFile(path) { if (path.startsWith("/rodir")) return storedConfig; throw Error("missing"); },
      writeFile(path, value) { writes.push([path, value]); },
    },
  };
  return { module, writes, storedConfig };
}

test("unavailable storage keeps existing databases intact and runs without persistence", async () => {
  const { module, writes } = runtime(Error("IndexedDB connection is closing"));
  const onConsole = mock.fn();
  assert.equal(await preparePersistence(module, { onConsole }), false);
  assert.equal(writes.length, 0, "must not replace unreadable player settings");
  assert.match(onConsole.mock.calls[0].arguments[1], /continuing without saving/);
});

test("legacy settings migrate into the user store without replacing existing settings", async () => {
  const { module, writes, storedConfig } = runtime();
  assert.equal(await preparePersistence(module, {}), true);
  assert.deepEqual(writes, [["/persist/cstrike/config.cfg", storedConfig]]);
  writes.length = 0;
  module.FS.readFile = () => "existing user settings";
  assert.equal(await preparePersistence(module, {}), true);
  assert.deepEqual(writes, []);
});

test("a failed settings migration save keeps the in-memory config and disables persistence", async () => {
  const { module, writes, storedConfig } = runtime(undefined, Error("Disk is full"));
  assert.equal(await preparePersistence(module, {}), false);
  assert.deepEqual(writes, [["/persist/cstrike/config.cfg", storedConfig]]);
});
