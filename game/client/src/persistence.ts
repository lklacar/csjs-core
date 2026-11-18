import type { XashModule } from "./runtime/xash.js";
import type { CSClientOptions } from "./types.js";

const PERSISTENT_ROOT = "/rodir";
const USER_ROOT = "/persist";
const LEGACY_CONFIG = `${PERSISTENT_ROOT}/cstrike/config.cfg`;
const USER_CONFIG = `${USER_ROOT}/cstrike/config.cfg`;

interface IDBFSBackend {
  quit?: () => void;
  syncfs?: (mount: unknown, populate: boolean, callback: (error: unknown) => void) => void;
}

const pendingSyncs = new WeakMap<XashModule, Promise<void>>();
const pendingUserSyncs = new WeakMap<XashModule, Promise<void>>();
const userMounts = new WeakMap<XashModule, { backend: IDBFSBackend; mount: unknown }>();

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function rawSyncFileSystem(module: XashModule, populate: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    module.FS.syncfs(populate, (error) => {
      if (error) reject(normalizeError(error));
      else resolve();
    });
  });
}

export function syncFileSystem(module: XashModule, populate: boolean): Promise<void> {
  const previous = pendingSyncs.get(module) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => rawSyncFileSystem(module, populate));
  pendingSyncs.set(module, current);
  return current;
}

export function syncUserFileSystem(module: XashModule): Promise<void> {
  const persistentMount = userMounts.get(module);
  const syncMount = persistentMount?.backend.syncfs;
  if (!persistentMount || !syncMount) return syncFileSystem(module, false);

  const previous = pendingUserSyncs.get(module) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => new Promise<void>((resolve, reject) => {
    syncMount(persistentMount.mount, false, (error) => {
      if (error) reject(normalizeError(error));
      else resolve();
    });
  }));
  pendingUserSyncs.set(module, current);
  return current;
}

function readTextFile(module: XashModule, path: string): string | undefined {
  try {
    const value = module.FS.readFile(path, { encoding: "utf8" });
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

async function restoreMount(module: XashModule, onConsole: CSClientOptions["onConsole"]): Promise<boolean> {
  try {
    await syncFileSystem(module, true);
    return true;
  } catch (error) {
    // Keep the database intact: an unavailable browser store is not evidence of corrupt player data.
    onConsole?.("error", `Browser storage could not be restored (${normalizeError(error).message}); continuing without saving.`);
    return false;
  }
}

export async function preparePersistence(
  module: XashModule,
  options: CSClientOptions,
): Promise<boolean> {
  module.FS.mkdirTree(PERSISTENT_ROOT);
  module.FS.mkdirTree(USER_ROOT);
  if (options.persistence === false) return false;

  const idbfs = (module.FS.filesystems?.IDBFS ?? module.IDBFS) as IDBFSBackend | string | undefined;
  if (!idbfs || typeof idbfs === "string") {
    options.onConsole?.("error", "IDBFS is unavailable; continuing without persistence.");
    return false;
  }

  // Keep mutable player state separate from the large, replaceable asset cache.
  const userMount = module.FS.mount(idbfs, { autoPersist: false }, USER_ROOT);
  const userRestored = await restoreMount(module, options.onConsole);
  const idbfsMount = (userMount as { mount?: unknown }).mount;
  if (userRestored && idbfsMount) userMounts.set(module, { backend: idbfs, mount: idbfsMount });
  module.FS.mount(idbfs, { autoPersist: false }, PERSISTENT_ROOT);
  const assetsRestored = await restoreMount(module, options.onConsole);
  if (!userRestored || !assetsRestored) return false;

  // Migrate configs written by releases that used /rodir as both the asset and
  // writable root. Never overwrite a config already stored in the new home.
  if (!readTextFile(module, USER_CONFIG)) {
    const legacyConfig = readTextFile(module, LEGACY_CONFIG);
    if (legacyConfig) {
      module.FS.mkdirTree(`${USER_ROOT}/cstrike`);
      module.FS.writeFile(USER_CONFIG, legacyConfig);
      try { await syncUserFileSystem(module); }
      catch (error) {
        options.onConsole?.("error", `Browser settings could not be saved: ${normalizeError(error).message}`);
        return false;
      }
    }
  }
  return true;
}

export function closePersistence(module: XashModule): void {
  const idbfs = (module.FS.filesystems?.IDBFS ?? module.IDBFS) as IDBFSBackend | string | undefined;
  if (idbfs && typeof idbfs !== "string") idbfs.quit?.();
}
