import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import * as persistence from "../dist/persistence.js";

let ensureAssets;
let syncFiles;
mock.module("../dist/persistence.js", { namedExports: {
  ...persistence,
  preparePersistence: async () => true,
  syncFileSystem: (...args) => syncFiles(...args),
} });
mock.module("../dist/assets.js", { namedExports: { GameAssets: class {
  constructor(_filesystem, _url, _report, persist) { this.persist = persist; }
  async ensure() { await ensureAssets(); await this.persist(); }
  cancel() {} async settled() {}
} } });
let runtime;
let runtimeOptions;
mock.module("../dist/runtime/xash.js", { defaultExport: async (options) => { runtimeOptions = options; return runtime; } });
const { createCSClient } = await import("../dist/client.js");

beforeEach((context) => {
  ensureAssets = async () => undefined;
  syncFiles = async () => undefined;
  runtime = createRuntime();
  globalThis.window = Object.assign(new EventTarget(), {
    alert: () => undefined,
    location: { href: "https://game.example/", search: "" },
    setInterval: mock.fn(() => 1),
    clearInterval: mock.fn(),
    setTimeout: mock.fn(() => 1),
    clearTimeout: mock.fn(),
  });
  globalThis.document = Object.assign(new EventTarget(), {
    baseURI: "https://game.example/",
    createElement: () => ({}),
    pointerLockElement: null,
    exitPointerLock: mock.fn(() => { document.pointerLockElement = null; }),
  });
  context.mock.method(globalThis, "fetch", async () => new Response("asset"));
  context.after(() => {
    delete globalThis.window;
    delete globalThis.document;
  });
});

function createRuntime({ deferSave = false, saveError, shutdownError, startupError } = {}) {
  const events = [];
  const pendingSaves = [];
  return {
    events, pendingSaves, running: false,
    FS: {
      mkdirTree() {}, writeFile() {}, chdir() {},
      syncfs(populate, callback) {
        events.push("save");
        if (deferSave) pendingSaves.push(callback);
        else callback(saveError);
      },
    },
    IDBFS: { quit() { events.push("close-database"); } },
    _Host_WriteConfig() { events.push("write-config"); },
    _Host_WriteOpenGLConfig() {},
    _Host_WriteVideoConfig() {},
    _CL_Disconnect() { events.push("disconnect"); },
    async precompileLibraries() {},
    callMain() {
      this.running = true;
      if (startupError) throw startupError;
    },
    shutdown() {
      events.push("shutdown");
      this.running = false;
      if (shutdownError) throw shutdownError;
    },
  };
}

test("leaving stops the runtime immediately, finishes its save, and allows a fresh launch", async () => {
  const originalAlert = window.alert;
  runtime = createRuntime({ deferSave: true });
  const firstRuntime = runtime;
  const canvas = {};
  const client = await createCSClient({ canvas });
  document.pointerLockElement = canvas;

  const disposal = client.dispose();
  assert.equal(client.dispose(), disposal);
  assert.equal(firstRuntime.running, false);
  assert.deepEqual(firstRuntime.events, ["write-config", "disconnect", "shutdown"]);
  assert.equal(document.exitPointerLock.mock.callCount(), 1);
  assert.equal(window.clearInterval.mock.callCount(), 1);
  await setImmediate();
  assert.deepEqual(firstRuntime.events, ["write-config", "disconnect", "shutdown", "save"]);
  firstRuntime.pendingSaves[0]();
  await disposal;
  assert.equal(firstRuntime.events.at(-1), "close-database");
  assert.equal(window.alert, originalAlert);
  window.dispatchEvent(new Event("pagehide"));
  assert.equal(firstRuntime.events.filter((event) => event === "write-config").length, 1);

  runtime = createRuntime();
  const reopenedClient = await createCSClient({ canvas: {} });
  assert.equal(runtime.running, true);
  assert.equal(firstRuntime.running, false);
  await reopenedClient.dispose();
  assert.equal(runtime.running, false);
  assert.equal(runtime.events.at(-1), "close-database");
});

for (const failure of ["saveError", "shutdownError"]) {
  test(`closes persistence and restores the page after ${failure}`, async () => {
    const originalAlert = window.alert;
    const error = new Error(failure);
    runtime = createRuntime({ [failure]: error });
    const client = await createCSClient({ canvas: {} });
    await assert.rejects(client.dispose(), error);
    assert.equal(runtime.running, false);
    assert.equal(runtime.events.at(-1), "close-database");
    assert.equal(window.alert, originalAlert);
  });
}

test("cleans up a runtime when starting the engine fails", async () => {
  const originalAlert = window.alert;
  const startupError = new Error("Engine startup failed");
  runtime = createRuntime({ startupError });
  await assert.rejects(createCSClient({ canvas: {} }), startupError);
  assert.equal(runtime.running, false);
  assert.deepEqual(runtime.events, ["shutdown", "close-database"]);
  assert.equal(window.alert, originalAlert);
});

test("cleans up the client when its ready callback throws", async () => {
  const readyError = new Error("Ready callback failed");
  runtime = createRuntime();
  await assert.rejects(createCSClient({ canvas: {}, onReady() { throw readyError; } }), readyError);
  assert.equal(runtime.running, false);
  assert.equal(runtime.events.at(-1), "close-database");
  assert.equal(window.clearInterval.mock.callCount(), 1);
});

test("restores the game's full control table without overwriting a custom binding", async (context) => {
  const stock = '"w" "+forward"\n"r" "+reload"\n"e" "+use"\n"b" "buy"\n"CTRL" "+duck"\n"TAB" "+showscores"\n';
  const saved = 'unbindall\nbind "w" "+back"\nbind "CTRL" "+attack"\n';
  runtime.FS.readFile = (path) => ({
    "/rodir/cstrike/gfx/shell/kb_def.lst": stock,
    "/persist/cstrike/config.cfg": saved,
  })[path] ?? "";
  const writes = context.mock.method(runtime.FS, "writeFile");
  const client = await createCSClient({ canvas: {} });
  const startup = writes.mock.calls.find(({ arguments: [path] }) => path === "/rodir/cstrike/cstrike.rc").arguments[1];
  assert.equal(startup, 'exec config.cfg\nbind "r" "+reload"\nbind "e" "+use"\nbind "b" "buy"\nbind "CTRL" "+duck"\nbind "TAB" "+showscores"\nstuffcmds\n');
  await client.dispose();
});

test("runtime initialization is not playable; only the native first-frame callback reports success", async () => {
  runtime = createRuntime();
  const onReady = mock.fn();
  const onPlayable = mock.fn();
  const controller = new AbortController();
  const client = await createCSClient({ canvas: {}, signal: controller.signal, onReady, onPlayable });
  assert.equal(onReady.mock.callCount(), 1);
  assert.equal(onPlayable.mock.callCount(), 0);
  assert.equal(runtimeOptions.onMapResources, undefined, "the browser loads the manifest before connecting");
  runtimeOptions.onGamePlayable();
  runtimeOptions.onGamePlayable();
  assert.equal(onPlayable.mock.callCount(), 1);
  controller.abort();
  await client.dispose();
});

for (const [callback, code] of [["onAbort", "engine_aborted"], ["onEngineError", "engine_error"], ["onServerReject", "server_rejected"]]) {
  test(`${callback} preserves the error and prevents duplicate failures or a later success`, async () => {
    runtime = createRuntime();
    const onError = mock.fn();
    const onPlayable = mock.fn();
    const client = await createCSClient({ canvas: {}, onError, onPlayable });
    runtimeOptions[callback]("The actual failure reason");
    runtimeOptions[callback]("The actual failure reason");
    runtimeOptions.onGamePlayable();
    assert.equal(onError.mock.callCount(), 1);
    assert.equal(onError.mock.calls[0].arguments[0].message, "The actual failure reason");
    assert.equal(onError.mock.calls[0].arguments[0].code, code);
    assert.equal(onPlayable.mock.callCount(), 0);
    await client.dispose();
  });
}

test("callbacks after user cancellation do not record success or failure", async () => {
  runtime = createRuntime();
  const controller = new AbortController();
  const onError = mock.fn();
  const onPlayable = mock.fn();
  const client = await createCSClient({ canvas: {}, signal: controller.signal, onError, onPlayable });
  controller.abort();
  runtimeOptions.onAbort("Runtime stopped");
  runtimeOptions.onGamePlayable();
  assert.equal(onError.mock.callCount(), 0);
  assert.equal(onPlayable.mock.callCount(), 0);
  await client.dispose();
});

test("native shutdown stops config writes and late callbacks without misreporting a crash", async () => {
  const onExit = mock.fn();
  const onError = mock.fn();
  const onPlayable = mock.fn();
  const client = await createCSClient({ canvas: {}, onExit, onError, onPlayable });
  const timerCallback = window.setInterval.mock.calls[0].arguments[0];
  runtimeOptions.onEngineShutdown();
  runtimeOptions.onEngineShutdown();
  runtimeOptions.onGamePlayable();
  runtimeOptions.onEngineError("late callback");
  await timerCallback();
  await client.sync();
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("pagehide"));
  await client.dispose();
  assert.equal(onExit.mock.callCount(), 1);
  assert.equal(onError.mock.callCount(), 0);
  assert.equal(onPlayable.mock.callCount(), 0);
  assert.equal(runtime.events.includes("write-config"), false);
  assert.equal(runtime.events.includes("disconnect"), false);
  assert.equal(runtime.events.at(-1), "close-database");
});

function mockSocket(context) {
  let socket;
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class {
    constructor() { socket = this; }
    close() { queueMicrotask(() => this.onclose?.({ code: 1000, reason: "", wasClean: true })); }
  };
  context.after(() => { globalThis.WebSocket = previousWebSocket; });
  return () => socket;
}

for (const failure of ["error", "close", "timeout"]) {
  test(`WebSocket ${failure} reports one specific startup failure after three attempts`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const socket = mockSocket(context);
    const onError = mock.fn();
    const launch = createCSClient({ canvas: {}, server: { websocketUrl: "wss://game.example/ws" }, onError });
    const rejected = assert.rejects(launch, { code: "websocket_error" });
    await setImmediate();
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (failure === "error") socket().onerror();
      if (failure === "close") socket().onclose({ code: 1006 });
      if (failure === "timeout") window.setTimeout.mock.calls.at(-1).arguments[0]();
      await setImmediate();
      context.mock.timers.tick(500 * attempt);
      await setImmediate();
    }
    await rejected;
    assert.equal(onError.mock.callCount(), 1);
    assert.equal(onError.mock.calls[0].arguments[0].code, "websocket_error");
    assert.ok(window.clearTimeout.mock.callCount() > 0);
    assert.equal(runtime.running, false);
    assert.equal(runtime.events.at(-1), "close-database");
  });
}

for (const stop of ["disconnect", "engine", "dispose", "pagehide"]) {
  test(`pre-play ${stop} only reports failure for an unexpected disconnection`, async (context) => {
    runtime = createRuntime();
    const socket = mockSocket(context);
    const onError = mock.fn();
    const onPlayable = mock.fn();
    const launch = createCSClient({ canvas: {}, server: { websocketUrl: "wss://game.example/ws" }, onError, onPlayable });
    await setImmediate();
    socket().onopen();
    const client = await launch;
    if (stop === "disconnect") socket().onclose({ code: 1001, reason: "Server restarting", wasClean: true });
    if (stop === "engine") runtimeOptions.onClientDisconnect();
    if (stop === "dispose") await client.dispose();
    if (stop === "pagehide") window.dispatchEvent(new Event("pagehide"));
    await setImmediate();
    runtimeOptions.onGamePlayable();
    assert.equal(onPlayable.mock.callCount(), 0);
    assert.equal(onError.mock.callCount(), stop === "disconnect" || stop === "engine" ? 1 : 0);
    if (stop === "engine") assert.match(onError.mock.calls[0].arguments[0].message, /Game engine disconnected/);
    if (stop === "disconnect") {
      const error = onError.mock.calls[0].arguments[0];
      assert.equal(error.code, "server_disconnected");
      assert.match(error.message, /1001/);
      assert.match(error.message, /Server restarting/);
      assert.match(error.message, /clean close/);
    }
    await client.dispose();
  });
}

test("downloads and persistence finish before opening the socket, and the engine waits for it", async (context) => {
  const socket = mockSocket(context);
  const download = Promise.withResolvers();
  const persistenceSave = Promise.withResolvers();
  ensureAssets = () => download.promise;
  syncFiles = () => persistenceSave.promise;
  const launch = createCSClient({ canvas: {}, server: { websocketUrl: "wss://game.example/ws" } });
  await setImmediate();
  assert.equal(socket(), undefined, "an arbitrarily slow download must not leave an idle connection open");
  assert.equal(runtime.running, false);
  download.resolve();
  await setImmediate();
  assert.equal(socket(), undefined, "persistence must not hold an idle connection either");
  persistenceSave.resolve();
  await setImmediate();
  assert.ok(socket());
  assert.equal(runtime.running, false, "the engine must wait for the WebSocket handshake");
  socket().onopen();
  const client = await launch;
  assert.equal(runtime.running, true);
  await client.dispose();
});

test("cancelling during downloads never connects to the game server", async (context) => {
  const socket = mockSocket(context);
  const download = Promise.withResolvers();
  ensureAssets = () => download.promise;
  const controller = new AbortController();
  const onError = mock.fn();
  const launch = createCSClient({ canvas: {}, server: { websocketUrl: "wss://game.example/ws" }, signal: controller.signal, onError });
  const rejected = assert.rejects(launch, { name: "AbortError" });
  await setImmediate();
  controller.abort();
  download.resolve();
  await rejected;
  assert.equal(socket(), undefined);
  assert.equal(onError.mock.callCount(), 0);
  assert.equal(runtime.running, false);
  assert.equal(runtime.events.at(-1), "close-database");
});

test("compiles dynamic libraries before opening the socket or starting the engine", async (context) => {
  const socket = mockSocket(context);
  const compiling = Promise.withResolvers();
  const precompile = context.mock.method(runtime, "precompileLibraries", () => compiling.promise);
  const launch = createCSClient({ canvas: {}, server: { websocketUrl: "wss://game.example/ws" } });
  await setImmediate();
  assert.equal(precompile.mock.callCount(), 1);
  assert.equal(precompile.mock.calls[0].arguments[0].length, 4);
  assert.ok(runtimeOptions.wasmBinary instanceof ArrayBuffer);
  assert.equal(socket(), undefined);
  assert.equal(runtime.running, false);
  compiling.resolve();
  await setImmediate();
  socket().onopen();
  await (await launch).dispose();
});

test("cancelling during the WebSocket handshake closes it without starting the engine or reporting failure", async (context) => {
  const socket = mockSocket(context);
  const controller = new AbortController();
  const onError = mock.fn();
  const onReady = mock.fn();
  const launch = createCSClient({ canvas: {}, server: { websocketUrl: "wss://game.example/ws" }, signal: controller.signal, onError, onReady });
  const rejected = assert.rejects(launch, { name: "AbortError" });
  await setImmediate();
  assert.ok(socket());
  controller.abort();
  await rejected;
  assert.equal(runtime.running, false);
  assert.equal(onReady.mock.callCount(), 0);
  assert.equal(onError.mock.callCount(), 0);
  assert.ok(window.clearTimeout.mock.callCount() > 0);
  assert.equal(runtime.events.at(-1), "close-database");
});


test("retries a failed handshake without reporting failure or accepting stale socket events", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const socket = mockSocket(context);
  const onError = mock.fn();
  const launch = createCSClient({ canvas: {}, server: { websocketUrl: "wss://game.example/ws" }, onError });
  await setImmediate();
  const first = socket();
  const staleClose = first.onclose;
  const staleMessage = first.onmessage;
  first.onerror();
  await setImmediate();
  context.mock.timers.tick(500);
  await setImmediate();
  assert.notEqual(socket(), first);
  socket().onopen();
  const client = await launch;
  staleClose({ code: 1006 });
  staleMessage({ data: new Uint8Array([1]).buffer });
  assert.equal(client.connected, true);
  assert.equal(globalThis.__csjsNetwork.receive(), undefined);
  assert.equal(onError.mock.callCount(), 0);
  await client.dispose();
});

test("native disconnect reason wins over the generic transport closure", async () => {
  const onError = mock.fn();
  const client = await createCSClient({ canvas: {}, onError });
  runtimeOptions.onClientDisconnect("Game server stopped sending packets (connection timed out).");
  assert.equal(onError.mock.callCount(), 1);
  assert.match(onError.mock.calls[0].arguments[0].message, /stopped sending packets/);
  await client.dispose();
});

test("a full asset cache does not prevent starting with verified files in memory", async () => {
  syncFiles = async () => { throw new DOMException("Disk is full", "QuotaExceededError"); };
  const onError = mock.fn();
  const onConsole = mock.fn();
  const client = await createCSClient({ canvas: {}, onError, onConsole });
  assert.equal(runtime.running, true);
  assert.equal(onError.mock.callCount(), 0);
  assert.match(onConsole.mock.calls[0].arguments[1], /continuing with game files in memory/);
  await client.dispose();
});


test("explicit player disconnect reports an exit and leaves time to send the final packet", async (context) => {
  const socket = mockSocket(context);
  const onError = mock.fn();
  const onExit = mock.fn();
  const launch = createCSClient({ canvas: {}, server: { websocketUrl: "wss://game.example/ws" }, onError, onExit });
  await setImmediate(); socket().onopen();
  const client = await launch;
  runtimeOptions.onClientDisconnect("Player chose to disconnect.", true);
  runtimeOptions.onClientDisconnect();
  assert.equal(client.connected, true);
  await setImmediate();
  assert.equal(client.disconnected, true);
  assert.equal(onExit.mock.callCount(), 1);
  assert.equal(onError.mock.callCount(), 0);
  await client.dispose();
});


test("transport loss after becoming playable is still reported with its actual close reason", async (context) => {
  const socket = mockSocket(context);
  const onError = mock.fn();
  const launch = createCSClient({ canvas: {}, server: { websocketUrl: "wss://game.example/ws" }, onError });
  await setImmediate(); socket().onopen();
  const client = await launch;
  runtimeOptions.onGamePlayable();
  socket().onclose({ code: 1006, wasClean: false });
  await setImmediate();
  assert.equal(onError.mock.callCount(), 1);
  assert.equal(onError.mock.calls[0].arguments[0].code, "server_disconnected");
  assert.match(onError.mock.calls[0].arguments[0].message, /1006/);
  await client.dispose();
});

test("launches when the production bundler emits relative runtime asset URLs", async () => {
  const NativeURL = globalThis.URL;
  let bundledClient;
  try {
    globalThis.URL = class extends NativeURL {
      constructor(input, base) {
        super(input, base);
        if (String(base).startsWith("file:") && String(input).startsWith("./runtime/")) {
          Object.defineProperty(this, "href", { value: `/_next/static/media/${String(input).split("/").at(-1)}` });
        }
      }
    };
    bundledClient = await import("../dist/client.js?relative-runtime-urls");
  } finally {
    globalThis.URL = NativeURL;
  }
  const client = await bundledClient.createCSClient({ canvas: {} });
  assert.equal(runtime.running, true);
  assert.equal(fetch.mock.calls.filter(({ arguments: [url] }) => String(url).startsWith("/_next/static/media/")).length, 5);
  await client.dispose();
});
