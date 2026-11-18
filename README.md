# CSJS

The core of CSJS runs Counter-Strike 1.6 in a browser. It includes the WebAssembly client, the Xash3D dedicated server, and a small Next.js page for joining a match. The original hosted CSJS service has shut down. The CSJS integration code is source-available under the self-hosting terms in [LICENSE](LICENSE). Bundled components retain their own licenses.

## Run a local match

Install Docker with Linux/amd64 build support, Node.js 24 or newer, pnpm 11, Python 3.11 or newer, and the Steam versions of Half-Life and Counter-Strike 1.6. Use a complete installation with both the `valve/` and `cstrike/` directories, or an equivalent loose copy of your own game files.

```sh
pnpm install --frozen-lockfile
make assets STEAM_HALF_LIFE="/path/to/Steam/steamapps/common/Half-Life"
make client
make server
```

Start the dedicated server and the launcher in separate terminals.

```sh
make server-run
pnpm dev
```

Open [the local launcher](http://127.0.0.1:3000), and select **Join game** to open the full-viewport play page. Click the canvas after the map loads to capture the mouse. Native clients can join on UDP port 27015.

The launcher connects to `ws://localhost:27016/ws` by default. Set `NEXT_PUBLIC_CSJS_SERVER_URL` before starting development or building the site to point it at a different instance.

The default map is `de_dust2`. Set `MAP=de_inferno` on both `make assets` and `make server-run` to use a different installed map. `make assets` creates `website/public/valve.zip` and the loose files used by the dedicated server. The browser downloads the ZIP once, then keeps the extracted game files in IndexedDB. If you replace the ZIP, clear the site’s stored game data to load the new copy. The site and game ports bind to loopback in the commands above.

## AMX Mod X

`make server` installs Metamod-P and the Xash-compatible AMX Mod X base and Counter-Strike packs. The server loads AMXX automatically with the standard plugins, modules, and configuration. In the dedicated server console, run `meta list`, `amxx plugins`, or `amxx modules` to check the installation.

For a local admin list, use `server/local/amxx-users.ini`. `make server-run` reads that file when it exists. The local directory is excluded from Git and Docker builds. For name-and-password authentication, enter `setinfo _pw "<your password>"` in the browser game console, then reconnect under the name in the list.

To include your own AMXX plugins in the image, put compiled `.amxx` files under `server/defaults/cstrike/addons/amxmodx/plugins/` and register them in `server/defaults/cstrike/addons/amxmodx/configs/plugins.ini`. A file at that path replaces the packaged list, so include the standard plugin entries you want to keep. Rebuild and restart the server after editing the files.

## Player occlusion

`mp_player_occlusion` is a dedicated-server setting. It defaults to `0` (off). At `1`, the server skips enemy player updates for a living player when its line-of-sight checks find the enemy fully hidden. A short movement prediction can keep updates flowing just before a player peeks around a corner, which helps avoid visible pop-in. Teammates, spectators, and relay proxies are exempt. The setting does not affect map geometry, sounds, or other entities.

In the dedicated server console, enter `mp_player_occlusion 1` to turn it on immediately. Enter `mp_player_occlusion` on its own to check the current value, or `mp_player_occlusion 0` to turn it off.

To enable it by default, add `mp_player_occlusion 1` to [server/defaults/cstrike/server.cfg](server/defaults/cstrike/server.cfg), rebuild with `make server`, and restart with `make server-run`.

## Source

- `game/client/` contains the TypeScript API and WebAssembly build.
- `game/engine/` and `game/cs16-client/` contain the engine, client, and game-server sources.
- `server/` builds and runs the dedicated server with its native WebSocket listener.
- `website/` serves the launcher and local game files. It needs no API, database, or accounts.

## Self-hosting and credit

You can host your own Counter-Strike service using this code. Keep access and features free for players. If your service is available to others, make the exact CSJS integration source you run, including your changes, available for free under the same terms. Link to the source from the launcher or a linked credits page.

Use your own name, logo, and visual identity. Credit **Based on [CSJS](https://github.com/lklacar/csjs-core) by LK** on the launcher or on a credits page linked from it. The credit must link to the original repository.

See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the self-hosting terms and upstream licenses. Your Steam files and generated game data belong outside source control.
