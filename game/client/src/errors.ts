export type CSClientErrorCode =
  | "network_error"
  | "asset_integrity_error"
  | "websocket_error"
  | "server_disconnected"
  | "server_rejected"
  | "engine_error"
  | "engine_aborted"
  | "graphics_error";

export class CSClientError extends Error {
  constructor(readonly code: CSClientErrorCode, message: string) {
    super(message);
    this.name = "CSClientError";
  }
}
