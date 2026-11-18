# @csjs/client

Browser client for Xash3D and CS16Client. Run `make client` at the repository root to build it.

`createCSClient` takes a canvas and a server WebSocket URL. It downloads `/valve.zip` once, extracts the `valve/` and `cstrike/` directories into IndexedDB-backed storage, and reuses them on later launches. To use a replacement ZIP, pass a new URL with `runtime.assetArchiveUrl`, or clear this site's game data in your browser. Dispose the client before launching another instance.
