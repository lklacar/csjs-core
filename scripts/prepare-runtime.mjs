import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , sourceDirectory, outputDirectory] = process.argv;
if (!sourceDirectory || !outputDirectory) {
  throw new Error("Usage: prepare-runtime.mjs <source-directory> <output-directory>");
}

const sourceJavaScript = path.join(sourceDirectory, "xash.js");
const outputJavaScript = path.join(outputDirectory, "xash.js");
const bundlerSafeDirectoryProbe = '_scriptName.slice(0,_scriptName.lastIndexOf("/")+1)';
const generatedJavaScript = await readFile(sourceJavaScript, "utf8");
const directoryProbe = /new URL\((['"])\.\1,\s*_scriptName\)\.href/g;
const occurrences = [...generatedJavaScript.matchAll(directoryProbe)].length;
if (occurrences !== 1) {
  throw new Error(`Expected exactly one Emscripten script-directory probe, found ${occurrences}.`);
}

const moduleDeclaration = "var Module = moduleArg;";
const mainExport = "Module['callMain'] = callMain;";
const eventTargetLookup = "var findEventTarget = (target) => {";
const libraryLoader = "function loadLibData() {";
for (const marker of [moduleDeclaration, mainExport, eventTargetLookup, libraryLoader]) {
  if (generatedJavaScript.split(marker).length !== 2) {
    throw new Error(`Expected exactly one Emscripten lifecycle marker: ${marker}`);
  }
}

// Keep generated-runtime listeners scoped to this instance without changing browser globals.
const runtimeListeners = /(?<![\w$.])(?:(\w+(?:\.\w+)*)\??\.)?addEventListener\(/g;
const preparedJavaScript = generatedJavaScript
  .replace(directoryProbe, bundlerSafeDirectoryProbe)
  .replace(runtimeListeners, (_, target) => `csjsAddEventListener(${target ?? "globalThis"}, `)
  // React may detach or replace #canvas before SDL unregisters its event handlers.
  .replace(eventTargetLookup, `${eventTargetLookup}
    if (maybeCStringToJsString(target) === '#canvas') return Module['canvas'];`)
  .replace(moduleDeclaration, `${moduleDeclaration}
const csjsEventController = new AbortController();
const csjsCompiledLibraries = new Map();
Module['precompileLibraries'] = async (paths) => {
  await Promise.all(paths.map(async (path) => {
    const compiled = await WebAssembly.compile(FS.readFile(path));
    csjsCompiledLibraries.set(FS.lookupPath(path).path, compiled);
    csjsCompiledLibraries.set(PATH.basename(path), compiled);
  }));
};
let csjsStarted = false;
let csjsStopped = false;
const csjsOnEngineShutdown = Module['onEngineShutdown'];
Module['onEngineShutdown'] = () => {
  csjsStopped = true;
  _emscripten_cancel_main_loop();
  JSEvents.removeAllEventListeners();
  csjsEventController.abort();
  csjsOnEngineShutdown?.();
};
function csjsAddEventListener(target, type, listener, options) {
  target?.addEventListener(type, listener, {
    ...(typeof options === 'boolean' ? { capture: options } : options),
    signal: csjsEventController.signal,
  });
}`)
  .replace(mainExport, `Module['callMain'] = (args) => {
  if (csjsStopped) throw new Error('Cannot restart a stopped game runtime.');
  csjsStarted = true;
  return callMain(args);
};
Module['shutdown'] = () => {
  if (csjsStopped) return;
  csjsStopped = true;
  _emscripten_cancel_main_loop();
  try {
    if (csjsStarted) {
      (wasmExports['Host_ShutdownWithReason'] ?? wasmExports['Host_Shutdown'])(0);
    }
  } finally {
    ABORT = true;
    JSEvents.removeAllEventListeners();
    csjsEventController.abort();
  }
};`)
  .replace(libraryLoader, `${libraryLoader}
        // Native dlopen may supply heap bytes; consult the cache before that path too.
        var compiledPath = findLibraryFS(libName, flags.rpath);
        var compiled = csjsCompiledLibraries.get(compiledPath ? FS.lookupPath(compiledPath).path : PATH.basename(libName));
        if (compiled) return flags.loadAsync ? Promise.resolve(compiled) : compiled;`);

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputJavaScript, preparedJavaScript);
await Promise.all([
  copyFile(path.join(sourceDirectory, "xash.wasm"), path.join(outputDirectory, "xash.wasm")),
  copyFile(path.join(sourceDirectory, "filesystem_stdio.so"), path.join(outputDirectory, "filesystem_stdio.wasm")),
  copyFile(path.join(sourceDirectory, "libref_gles3compat.so"), path.join(outputDirectory, "libref_gles3compat.wasm")),
  copyFile(path.join(sourceDirectory, "client_emscripten_wasm32.wasm"), path.join(outputDirectory, "client_emscripten_wasm32.wasm")),
  copyFile(path.join(sourceDirectory, "menu_emscripten_wasm32.wasm"), path.join(outputDirectory, "menu_emscripten_wasm32.wasm")),
  copyFile(path.join(sourceDirectory, "extras.pk3"), path.join(outputDirectory, "extras.pk3")),
]);
