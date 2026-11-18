import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import type { CSClientProgress, CSFileSystem } from "./types.js";

const GAME_ROOT = "/rodir";
const CACHE_MARKER = `${GAME_ROOT}/.valve-zip-source`;

export class GameAssets {
  readonly #controller = new AbortController();
  #pending?: Promise<void>;

  constructor(
    readonly filesystem: CSFileSystem,
    readonly archiveUrl: string,
    readonly report: (progress: CSClientProgress) => void,
    readonly persist: () => Promise<void>,
  ) {}

  ensure(): Promise<void> {
    return this.#pending ??= this.#load();
  }

  cancel(): void { this.#controller.abort(); }
  async settled(): Promise<void> { await this.#pending?.catch(() => undefined); }

  async #load(): Promise<void> {
    const signal = this.#controller.signal;
    signal.throwIfAborted();
    if (this.#isCached()) return;

    this.report({ phase: "loading-assets", loadedBytes: 0, totalBytes: 0, currentAsset: "valve.zip" });
    const response = await fetch(this.archiveUrl, { signal });
    if (!response.ok) {
      throw new Error(`Could not download valve.zip (HTTP ${response.status}). Run make assets to prepare it.`);
    }

    const reader = new ZipReader(new BlobReader(await response.blob()), { useWebWorkers: false });
    try {
      const files = (await reader.getEntries()).filter((entry) => !entry.directory);
      const paths = new Set<string>();
      for (const { filename } of files) {
        if (!/^(valve|cstrike)\//.test(filename) || /[\\:\x00-\x1f\x7f]/.test(filename)
          || filename.split("/").some((part) => !part || part.startsWith("."))
          || paths.has(filename.toLowerCase())) {
          throw new Error(`Invalid path in valve.zip: ${filename}`);
        }
        paths.add(filename.toLowerCase());
      }
      if (!paths.has("valve/gfx.wad") || !paths.has("cstrike/liblist.gam")) {
        throw new Error("valve.zip must contain the valve/ and cstrike/ game directories.");
      }

      for (const [index, entry] of files.entries()) {
        signal.throwIfAborted();
        const data = await entry.getData(new Uint8ArrayWriter(), { signal, checkSignature: true });
        signal.throwIfAborted();
        const path = `${GAME_ROOT}/${entry.filename}`;
        this.filesystem.mkdirTree(path.slice(0, path.lastIndexOf("/")));
        this.filesystem.writeFile(path, data);
        if (index % 25 === 0 || index + 1 === files.length) {
          this.report({ phase: "preparing-filesystem", loadedBytes: index + 1, totalBytes: files.length, currentAsset: "valve.zip" });
        }
      }
      signal.throwIfAborted();
      this.filesystem.writeFile(CACHE_MARKER, this.archiveUrl);
      await this.persist();
    } finally {
      await reader.close();
    }
  }

  #isCached(): boolean {
    try {
      return this.filesystem.readFile(CACHE_MARKER, { encoding: "utf8" }) === this.archiveUrl;
    } catch {
      return false;
    }
  }
}
