import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

test("packaged runtime lifecycle", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "csjs-runtime-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const browser = new EventTarget();
  let attachedCanvas;
  browser.querySelector = (selector) => selector === "#canvas" ? attachedCanvas : browser;
  globalThis.document = browser;
  globalThis.addEventListener = browser.addEventListener.bind(browser);
  context.after(() => {
    delete globalThis.document;
    delete globalThis.addEventListener;
  });
  const runtimeSource = await readFile(new URL("../../dist/runtime/xash.js", import.meta.url), "utf8");
  const libraryLoader = runtimeSource.slice(runtimeSource.indexOf("function loadLibData() {"), runtimeSource.indexOf("// libName -> exports"));
  const fixture = `export default function createXashModule(moduleArg = {}) {
    var Module = moduleArg;
    var _scriptName = 'https://game.example/xash.js';
    var scriptDirectory = new URL('.', _scriptName).href;
    var FS = {};
    var HEAP8 = new Uint8Array();
    var assert = (condition) => { if (!condition) throw new Error('Runtime assertion failed'); };
    Module['FS'] = FS;
    var PATH = { basename: path => path.split('/').pop() };
    var findLibraryFS = (name) => Module.nativeFilesystem ? undefined : FS.lookupPath(name).path;
    Module.loadLibrary = (libName, flags = {}, handle = 0) => {
      ${libraryLoader}
      return loadLibData();
    };
    var HEAPU32 = Module.HEAPU32 = new Uint32Array(32);
    HEAP8 = new Uint8Array(HEAPU32.buffer);
    var ABORT = false;
    var maybeCStringToJsString = (target) => target;
    var findEventTarget = (target) => {
      target = maybeCStringToJsString(target);
      return document.querySelector(target);
    };
    var findCanvasEventTarget = findEventTarget;
    var wasmExports = {
      [Module.legacy ? 'Host_Shutdown' : 'Host_ShutdownWithReason']() {
        Module.shutdowns++;
        Module.removedCanvas = findEventTarget('#canvas');
        Module.resizedCanvas = findCanvasEventTarget('#canvas');
        Module.documentTarget = findEventTarget('body');
        if (Module.failShutdown) throw new Error('Native shutdown failed');
      },
    };
    var _emscripten_cancel_main_loop = () => { Module.running = false; };
    var JSEvents = { removeAllEventListeners() { Module.inputRemoved = true; } };
    function callMain() {
      Module.running = true;
      document.addEventListener('input', () => Module.inputs++);
      addEventListener('message', () => Module.messages++, true);
    }
    Module['callMain'] = callMain;
    return Module;
  }`;
  await writeFile(path.join(directory, "xash.js"), fixture);
  for (const file of ["xash.wasm", "filesystem_stdio.so", "libref_gles3compat.so",
    "client_emscripten_wasm32.wasm", "menu_emscripten_wasm32.wasm", "extras.pk3"]) {
    await writeFile(path.join(directory, file), "fixture");
  }
  const output = path.join(directory, "output");
  execFileSync(process.execPath, [new URL("../../../scripts/prepare-runtime.mjs", import.meta.url).pathname, directory, output]);
  const generated = await readFile(path.join(output, "xash.js"), "utf8");
  const { default: createRuntime } = await import(`data:text/javascript;base64,${Buffer.from(generated).toString("base64")}`);
  const first = createRuntime({ canvas: new EventTarget(), inputs: 0, messages: 0, shutdowns: 0, legacy: true });
  const second = createRuntime({ canvas: new EventTarget(), inputs: 0, messages: 0, shutdowns: 0 });
  attachedCanvas = first.canvas;
  first.callMain();
  attachedCanvas = second.canvas;
  second.callMain();
  browser.dispatchEvent(new Event("input"));
  assert.equal(first.inputs, 1);
  first.shutdown();
  first.shutdown();
  browser.dispatchEvent(new Event("input"));
  browser.dispatchEvent(new Event("message"));
  assert.equal(first.running, false);
  assert.equal(first.shutdowns, 1);
  assert.equal(first.removedCanvas, first.canvas);
  assert.equal(first.resizedCanvas, first.canvas);
  assert.equal(first.documentTarget, browser);
  assert.equal(first.inputRemoved, true);
  assert.equal(first.inputs, 1);
  assert.equal(first.messages, 0);
  assert.equal(second.inputs, 2);
  assert.equal(second.messages, 1);
  second.failShutdown = true;
  attachedCanvas = null;
  assert.throws(() => second.shutdown(), /Native shutdown failed/);
  assert.equal(second.removedCanvas, second.canvas);
  assert.equal(second.resizedCanvas, second.canvas);
  browser.dispatchEvent(new Event("input"));
  assert.equal(second.running, false);
  assert.equal(second.inputs, 2);
  assert.equal(second.inputRemoved, true);
  const unstarted = createRuntime({ shutdowns: 0 });
  unstarted.shutdown();
  assert.equal(unstarted.shutdowns, 0);
  assert.equal(unstarted.inputRemoved, true);

  const nativeExit = createRuntime({ canvas: new EventTarget(), inputs: 0, messages: 0, shutdowns: 0 });
  nativeExit.callMain();
  nativeExit.onEngineShutdown();
  browser.dispatchEvent(new Event("input"));
  browser.dispatchEvent(new Event("message"));
  nativeExit.shutdown();
  assert.equal(nativeExit.running, false);
  assert.equal(nativeExit.inputs, 0);
  assert.equal(nativeExit.messages, 0);
  assert.equal(nativeExit.shutdowns, 0, "native shutdown must not be entered again");
  assert.throws(() => nativeExit.callMain(), /Cannot restart/);

  await context.test("native library loads reuse asynchronously compiled modules", async (context) => {
    const runtime = createRuntime();
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    runtime.FS.readFile = () => bytes;
    runtime.FS.lookupPath = () => ({ path: "/rodir/filesystem_stdio.so" });
    await runtime.precompileLibraries(["/rodir/filesystem_stdio.so"]);
    context.mock.method(runtime.FS, "readFile", () => assert.fail("cached modules must not be synchronously recompiled"));
    assert.ok(runtime.loadLibrary("filesystem_stdio.so") instanceof WebAssembly.Module);
    // Native dlopen supplies bytes through its handle before the filesystem fallback.
    runtime.HEAPU32[(4 + 28) / 4] = 64;
    runtime.HEAPU32[(4 + 32) / 4] = bytes.length;
    assert.ok(runtime.loadLibrary("filesystem_stdio.so", {}, 4) instanceof WebAssembly.Module);
    assert.ok(await runtime.loadLibrary("filesystem_stdio.so", { loadAsync: true }, 4) instanceof WebAssembly.Module);
    runtime.nativeFilesystem = true;
    assert.ok(runtime.loadLibrary("filesystem_stdio.so", {}, 4) instanceof WebAssembly.Module);
    assert.ok(runtime.loadLibrary("./filesystem_stdio.so", {}, 4) instanceof WebAssembly.Module);
  });
});
