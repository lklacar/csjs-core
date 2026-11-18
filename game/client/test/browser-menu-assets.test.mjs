import assert from "node:assert/strict";
import { test } from "node:test";
import { readIndexedSpray, recolorSpray } from "../dist/browser-menu-assets.js";

test("spray recoloring preserves the stock bitmap pixels and writes a usable palette", () => {
  const pixelOffset = 54 + 256 * 4;
  const bytes = new Uint8Array(pixelOffset + 4);
  const header = new DataView(bytes.buffer);
  bytes.set([66, 77]);
  header.setUint32(2, bytes.length, true);
  header.setUint32(10, pixelOffset, true);
  header.setUint32(14, 40, true);
  header.setInt32(18, 2, true);
  header.setInt32(22, 1, true);
  header.setUint16(26, 1, true);
  header.setUint16(28, 8, true);
  bytes.set([0, 128], pixelOffset);

  const spray = readIndexedSpray(bytes);
  assert.ok(spray);
  const recolored = recolorSpray(spray, [200, 80, 40]);
  assert.deepEqual([...recolored.slice(54 + 128 * 4, 54 + 129 * 4)], [20, 40, 100, 0]);
  assert.deepEqual(recolored.slice(pixelOffset), bytes.slice(pixelOffset));
  assert.equal(bytes[54 + 128 * 4], 0);
  assert.equal(readIndexedSpray(bytes.slice(0, -1)), undefined);
});
