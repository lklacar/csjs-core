export type CSClientPhase =
  | "loading-engine"
  | "preparing-filesystem"
  | "loading-assets"
  | "connecting"
  | "starting"
  | "ready";

export interface CSClientProgress {
  phase: CSClientPhase;
  loadedBytes: number;
  totalBytes: number;
  currentAsset?: string;
}

export interface CSPlayerOptions {
  name?: string;
  touchControls?: boolean;
}

export interface CSServerOptions {
  websocketUrl: string | URL;
  /** Virtual address passed to Xash3D; packets use websocketUrl. */
  address?: string;
}

export interface CSRuntimeOptions {
  /** Game ZIP URL. Defaults to /valve.zip. */
  assetArchiveUrl?: string | URL;
}

export interface CSClientOptions {
  canvas: HTMLCanvasElement;
  signal?: AbortSignal;
  player?: CSPlayerOptions;
  server?: CSServerOptions;
  runtime?: CSRuntimeOptions;
  /** Enabled by default. Set to false to keep all files in memory. */
  persistence?: boolean;
  additionalArguments?: readonly string[];
  onProgress?: (progress: CSClientProgress) => void;
  onReady?: (client: import("./client.js").CSClient) => void;
  /** First active map frame rendered; onReady only means the engine has started. */
  onPlayable?: () => void;
  onExit?: () => void;
  onConnectionChange?: (connected: boolean) => void;
  onConsole?: (level: "info" | "error", message: string) => void;
  onError?: (error: Error) => void;
}

export interface CSFileSystem {
  filesystems?: { IDBFS?: unknown };
  mkdirTree(path: string): void;
  mount(type: unknown, options: Record<string, unknown>, mountpoint: string): unknown;
  rmdir(path: string): void;
  readFile(path: string): Uint8Array;
  readdir(path: string): string[];
  unlink(path: string): void;
  readFile(path: string, options: { encoding: "utf8" }): string;
  stat(path: string): { mode: number; size: number };
  syncfs(populate: boolean, callback: (error: unknown) => void): void;
  unmount(mountpoint: string): void;
  writeFile(path: string, data: string | ArrayBufferView): void;
  chdir(path: string): void;
}
