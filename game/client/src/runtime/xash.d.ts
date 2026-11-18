import type { CSFileSystem } from "../types.js";

export interface XashModule {
  FS: CSFileSystem;
  IDBFS?: unknown;
  _CL_Disconnect(): void;
  _CSJS_WantsPointerLock?(): number;
  _Host_WriteConfig(): void;
  _Host_WriteOpenGLConfig(): void;
  _Host_WriteVideoConfig(): void;
  ccall(name: string, returnType: "string", argumentTypes: string[], args: string[]): string;
  callMain(arguments_: string[]): void;
  precompileLibraries(paths: string[]): Promise<void>;
  shutdown(): void;
}

export interface XashModuleOptions {
  canvas: HTMLCanvasElement;
  noInitialRun: boolean;
  wasmBinary?: ArrayBuffer;
  locateFile?: (path: string, prefix: string) => string;
  onClientDisconnect?: (reason?: string, voluntary?: boolean) => void;
  onGamePlayable?: () => void;
  onEngineError?: (message: string) => void;
  onEngineShutdown?: () => void;
  onServerReject?: (message: string) => void;
  onAbort?: (reason: unknown) => void;
  onMapResources?: (map: string, resources: string[]) => Promise<void>;
  onConsoleVisibility?: (visible: boolean) => boolean;
  onMenuVisibility?: (visible: boolean, inGame: boolean) => boolean;
  onConsoleOutput?: (text: string | null) => void;
  print?: (line: string) => void;
  printErr?: (line: string) => void;
}

export default function createXashModule(options: XashModuleOptions): Promise<XashModule>;
