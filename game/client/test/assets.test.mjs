import assert from "node:assert/strict";
import { test } from "node:test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { GameAssets } from "../dist/assets.js";

const url = "https://game.example/valve.zip";
const gameFiles = {
  "valve/gfx.wad": "textures",
  "cstrike/liblist.gam": "game",
  "cstrike/maps/de_dust2.bsp": "map",
};

async function archive(files) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  for (const [path, contents] of Object.entries(files)) {
    await writer.add(path, new TextReader(contents));
  }
  return writer.close();
}

function filesystem() {
  const files = new Map();
  return {
    files,
    mkdirTree() {},
    writeFile(path, data) { files.set(path, data); },
    readFile(path) {
      if (!files.has(path)) throw new Error("File missing");
      return files.get(path);
    },
  };
}

test("downloads one ZIP, then uses the extracted files on the next launch", async (context) => {
  const zip = await archive(gameFiles);
  const fetch = context.mock.method(globalThis, "fetch", async (request) => {
    assert.equal(request, url);
    return new Response(zip);
  });
  const fs = filesystem();
  let saves = 0;
  const load = () => new GameAssets(fs, url, () => {}, async () => { saves++; });
  const assets = load();
  await Promise.all([assets.ensure(), assets.ensure()]);
  for (const [path, contents] of Object.entries(gameFiles)) {
    assert.equal(new TextDecoder().decode(fs.readFile(`/rodir/${path}`)), contents);
  }
  await load().ensure();
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(saves, 1);
});

test("rejects paths outside the game directories before writing files", async (context) => {
  const zip = await archive({ ...gameFiles, "other/unexpected": "invalid" });
  context.mock.method(globalThis, "fetch", async () => new Response(zip));
  const fs = filesystem();
  const assets = new GameAssets(fs, url, () => {}, async () => assert.fail("should not save"));
  await assert.rejects(assets.ensure(), /Invalid path in valve\.zip/);
  assert.equal(fs.files.size, 0);
});

test("cancelling the download leaves no cached files", async (context) => {
  const { promise, resolve } = Promise.withResolvers();
  context.mock.method(globalThis, "fetch", async () => promise);
  const fs = filesystem();
  const assets = new GameAssets(fs, url, () => {}, async () => assert.fail("should not save"));
  const loading = assets.ensure();
  assets.cancel();
  resolve(new Response(await archive(gameFiles)));
  await assert.rejects(loading, { name: "AbortError" });
  await assets.settled();
  assert.equal(fs.files.size, 0);
});
