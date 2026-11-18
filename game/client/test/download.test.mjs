import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { downloadBytes } from "../dist/download.js";

test("retries a transient HTTP error and a truncated response, resetting byte progress", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  const progress = [];
  context.mock.method(globalThis, "fetch", async () => {
    requests++;
    return requests === 1 ? new Response("unavailable", { status: 503 }) : new Response(requests === 2 ? "ma" : "map!");
  });
  const loading = downloadBytes("https://assets.example/map", {}, "cstrike/map", 4, value => progress.push(value));
  await setImmediate();
  context.mock.timers.tick(500);
  await setImmediate();
  context.mock.timers.tick(1000);
  assert.equal(new TextDecoder().decode(await loading), "map!");
  assert.equal(requests, 3);
  assert.deepEqual(progress, [0, 2, 0, 4]);
});

test("stops at three attempts and preserves expected/received bytes and batch identity", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  context.mock.method(globalThis, "fetch", async () => { requests++; return new Response("too much"); });
  const loading = downloadBytes("https://assets.example/batch", {}, "batch of 2 files beginning cstrike/a", 4);
  const rejected = assert.rejects(loading, error => {
    assert.equal(error.code, "asset_integrity_error");
    assert.match(error.message, /batch of 2 files beginning cstrike\/a; attempt 3\/3; expected 4 bytes, received 8/);
    return true;
  });
  await setImmediate(); context.mock.timers.tick(500);
  await setImmediate(); context.mock.timers.tick(1000);
  await rejected;
  assert.equal(requests, 3);
});

test("does not retry permanent HTTP errors", async (context) => {
  const fetch = context.mock.method(globalThis, "fetch", async () => new Response("manifest mismatch", { status: 409 }));
  await assert.rejects(downloadBytes("https://assets.example/batch", {}, "Game file batch"), /HTTP 409/);
  assert.equal(fetch.mock.callCount(), 1);
});

for (const stage of ["headers", "body", "backoff"]) {
  test(`cancellation during ${stage} stops retries and reading`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const controller = new AbortController();
    let cancelled = false;
    const fetch = context.mock.method(globalThis, "fetch", async (_url, { signal }) => {
      if (stage === "backoff") throw new TypeError("Failed to fetch");
      if (stage === "headers") return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    });
    const loading = downloadBytes("https://assets.example/file", { signal: controller.signal }, "file");
    const rejected = assert.rejects(loading, { name: "AbortError" });
    await setImmediate();
    controller.abort();
    await rejected;
    context.mock.timers.tick(100_000);
    assert.equal(fetch.mock.callCount(), 1);
    if (stage === "body") assert.equal(cancelled, true);
  });
}

test("a stalled response is cancelled and retried, but advancing bytes reset the idle timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let body;
  let cancelled = 0;
  let requests = 0;
  context.mock.method(globalThis, "fetch", async () => {
    requests++;
    if (requests > 1) return new Response("map!");
    return new Response(new ReadableStream({ start(controller) { body = controller; }, cancel() { cancelled++; } }));
  });
  const loading = downloadBytes("https://assets.example/file", {}, "file", 4);
  await setImmediate();
  context.mock.timers.tick(25_000);
  body.enqueue(new TextEncoder().encode("ma"));
  await setImmediate();
  context.mock.timers.tick(25_000);
  assert.equal(requests, 1);
  assert.equal(cancelled, 0);
  context.mock.timers.tick(5_000);
  await setImmediate();
  assert.equal(cancelled, 1);
  context.mock.timers.tick(500);
  assert.equal(new TextDecoder().decode(await loading), "map!");
  assert.equal(requests, 2);
});

test('retries bypass a truncated browser cache entry without weakening no-store requests', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const cache of ['no-cache', 'no-store']) {
    const policies = [];
    context.mock.method(globalThis, 'fetch', async (_url, options) => {
      policies.push(options.cache);
      return new Response(policies.length === 1 ? 'ma' : 'map!');
    });
    const loading = downloadBytes('https://assets.example/map', { cache }, 'map', 4);
    await setImmediate();
    context.mock.timers.tick(500);
    assert.equal(new TextDecoder().decode(await loading), 'map!');
    assert.deepEqual(policies, [cache, cache === 'no-store' ? 'no-store' : 'reload']);
  }
});
