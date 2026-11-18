import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCSArguments } from "../dist/client.js";

test("voice chat is disabled before connecting for keyboard and touch players", () => {
  for (const player of [undefined, { touchControls: false }, { touchControls: true }]) {
    const args = buildCSArguments({
      player,
      server: { websocketUrl: "wss://game.example/ws" },
    });
    const voiceIndex = args.indexOf("+voice_enable");
    assert.notEqual(voiceIndex, -1, "override saved voice settings on every launch");
    assert.equal(args[voiceIndex + 1], "0");
    assert.ok(voiceIndex < args.indexOf("+connect"));
    assert.equal(args.includes("-nosound"), false, "keep game and radio audio enabled");
  }
});

for (const [name, options, expected] of [
  ["default controls", {}, "0"],
  ["keyboard controls", { player: { touchControls: false } }, "0"],
  ["touch controls", { player: { touchControls: true } }, "1"],
]) {
  test(`radio menus use the visible interface for ${name}`, () => {
    const args = buildCSArguments(options);
    const menuIndex = args.indexOf("+_extended_menus");
    assert.notEqual(menuIndex, -1, "set the menu mode even when a saved config exists");
    assert.equal(args[menuIndex + 1], expected);
    if (options.player?.touchControls) {
      assert.deepEqual(args.slice(args.indexOf("+touch_enable"), args.indexOf("+touch_enable") + 2), ["+touch_enable", "1"]);
    }
  });
}

test("explicit radio menu arguments override the input-mode default before connecting", () => {
  const args = buildCSArguments({
    additionalArguments: ["+_extended_menus", "1"],
    server: { websocketUrl: "wss://game.example/ws" },
  });
  const menuValues = args.flatMap((value, index) => value === "+_extended_menus" ? [args[index + 1]] : []);
  assert.deepEqual(menuValues, ["0", "1"]);
  assert.ok(args.lastIndexOf("+_extended_menus") < args.indexOf("+connect"));
});
