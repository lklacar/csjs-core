import { CSClientError } from "./errors.js";

const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 500;

export function retryDelay(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function downloadBytes(
  url: string | URL,
  options: RequestInit,
  label: string,
  expectedBytes?: number,
  progress?: (receivedBytes: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const signal = options.signal;
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let receivedBytes = 0;
    let retryable = true;
    let timeout: ReturnType<typeof setTimeout>;
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => controller.abort(new Error("No download progress for 30 seconds.")), DOWNLOAD_IDLE_TIMEOUT_MS);
    };
    const cancelReader = () => { void reader?.cancel().catch(() => undefined); };
    controller.signal.addEventListener("abort", cancelReader, { once: true });
    const context = `${label}; attempt ${attempt}/${DOWNLOAD_ATTEMPTS}`;
    try {
      if (attempt > 1) progress?.(0);
      resetTimeout();
      const cache = attempt > 1 && (!options.method || options.method === "GET") && options.cache !== "no-store"
        ? "reload" : options.cache;
      const response = await fetch(url, { ...options, cache, signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!response.ok) {
        retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        void response.body?.cancel().catch(() => undefined);
        throw new CSClientError("network_error", `${context}: download failed (HTTP ${response.status}).`);
      }
      reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      while (reader) {
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        receivedBytes += value.byteLength;
        if (expectedBytes !== undefined && receivedBytes > expectedBytes) break;
        chunks.push(value);
        progress?.(receivedBytes);
        resetTimeout();
      }
      controller.signal.throwIfAborted();
      if (expectedBytes !== undefined && receivedBytes !== expectedBytes) {
        throw new CSClientError("asset_integrity_error", `Game file download has an unexpected size (${context}; expected ${expectedBytes} bytes, received ${receivedBytes}). Please retry.`);
      }
      const bytes = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    } catch (error) {
      signal?.throwIfAborted();
      const cause = controller.signal.aborted ? controller.signal.reason : error;
      const failure = cause instanceof CSClientError ? cause : new CSClientError("network_error",
        `${context}: ${cause instanceof Error ? cause.message : String(cause || "Download failed") } (${receivedBytes} bytes received).`);
      if (!retryable || attempt === DOWNLOAD_ATTEMPTS) throw failure;
    } finally {
      clearTimeout(timeout!);
      signal?.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", cancelReader);
      cancelReader();
    }
    await retryDelay(RETRY_DELAY_MS * attempt, signal);
  }
}
