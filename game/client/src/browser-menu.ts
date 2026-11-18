import { drawMenuBackdrop, drawMenuTga, drawSpray, readIndexedSpray, readMenuAsset, recolorSpray, sprayNames } from "./browser-menu-assets.js";
import { browserMenuStyle } from "./browser-menu-style.js";
import type { CSFileSystem } from "./types.js";

type MenuAction = "open" | "resume" | "team" | "console" | "disconnect" | "quit";
type SettingField = HTMLInputElement | HTMLSelectElement;

interface MenuEngine {
  filesystem(): CSFileSystem | undefined;
  action(action: MenuAction): void;
  setting(name: string, value?: string): string;
  binding(action: "get" | "binding" | "bind", command: string, key?: string): string;
  save(): Promise<void>;
}

const keyActions = [
  ["Move forward", "+forward"], ["Move backward", "+back"], ["Move left", "+moveleft"], ["Move right", "+moveright"],
  ["Jump", "+jump"], ["Duck", "+duck"], ["Walk", "+speed"], ["Fire", "+attack"], ["Secondary fire", "+attack2"],
  ["Reload", "+reload"], ["Use", "+use"], ["Drop weapon", "drop"], ["Buy menu", "buy"],
  ["Scoreboard", "+showscores"], ["Spray logo", "impulse 201"],
] as const;

const namedKeys: Record<string, string> = {
  Space: "SPACE", ShiftLeft: "SHIFT", ShiftRight: "SHIFT", ControlLeft: "CTRL", ControlRight: "CTRL",
  AltLeft: "ALT", AltRight: "ALT", ArrowUp: "UPARROW", ArrowDown: "DOWNARROW",
  ArrowLeft: "LEFTARROW", ArrowRight: "RIGHTARROW", Enter: "ENTER", Backspace: "BACKSPACE",
  Insert: "INS", Delete: "DEL", Home: "HOME", End: "END", PageUp: "PGUP", PageDown: "PGDN",
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: "SEMICOLON", Quote: "'", Comma: ",", Period: ".", Slash: "/",
};
function engineKey(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code[3].toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code[5];
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
  return namedKeys[code];
}

function rgbToHex(value: string, fallback: string): string {
  const parts = value.trim().split(/\s+/, 3).map(Number);
  return parts.length === 3 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    ? "#" + parts.map(part => part.toString(16).padStart(2, "0")).join("") : fallback;
}

function hexToRgb(value: string): number[] {
  return [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16));
}

function validateNumber(field: HTMLInputElement) {
  const value = field.value.trim();
  const number = Number(value);
  const minimum = field.dataset.min;
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(number);
  field.setCustomValidity(!decimal ? "Enter a number."
    : minimum !== undefined && number < Number(minimum) ? `Enter ${minimum} or greater.` : "");
}

export function createBrowserMenu(canvas: HTMLCanvasElement, engine: MenuEngine, touchControls: boolean) {
  const document = canvas.ownerDocument;
  let stage: HTMLDivElement | undefined;
  let root: ShadowRoot;
  let resize: ResizeObserver | undefined;
  let inGame = false;
  let suspended = false;
  let current: "main" | "options" | "confirm" = "main";
  let pendingExit: "disconnect" | "quit" = "disconnect";
  let activeTab = 0;
  let editingKey: HTMLButtonElement | undefined;
  let warningKey = "";
  let sprayUrl: string | undefined;
  let saving = false;
  let disposed = false;
  let hasBackdrop = false;
  let capturedPointer = false;
  const changed = new Set<SettingField>();
  const keyChanges = new Map<string, string>();

  function find<T extends Element = HTMLElement>(selector: string): T {
    return root.querySelector<T>(selector)!;
  }

  function fitCanvas() {
    if (!stage || stage.hidden) return;
    const { left, top, width, height } = canvas.getBoundingClientRect();
    Object.assign(stage.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }

  function pointerLockChanged() {
    const locked = document.pointerLockElement === canvas;
    // Chrome can consume Escape to release pointer lock before the game sees it.
    if (capturedPointer && !locked) engine.action("open");
    capturedPointer = locked;
  }
  document?.addEventListener("pointerlockchange", pointerLockChanged);

  function setWindow(next: typeof current) {
    current = next;
    stage!.toggleAttribute("data-window", next !== "main");
    for (const name of ["main", "options", "confirm"] as const) find(`[data-view="${name}"]`).hidden = name !== next;
    if (suspended) return;
    if (next === "options") find<HTMLButtonElement>(`[role="tab"]:nth-child(${activeTab + 1})`).focus({ preventScroll: true });
    else if (next === "confirm") find('[data-action="cancel"]').focus({ preventScroll: true });
    else find(inGame ? '[data-action="resume"]' : '[data-action="options"]').focus({ preventScroll: true });
  }

  function selectTab(index: number) {
    activeTab = index;
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs.forEach((tab, position) => {
      const selected = position === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      find("#" + tab.getAttribute("aria-controls")).hidden = !selected;
    });
    find(".pages").scrollTop = 0;
    tabs[index].focus({ preventScroll: true });
  }

  function updateCrosshair() {
    const size = find<HTMLSelectElement>('[data-setting="cl_crosshair_size"]').value;
    const enhanced = find<HTMLSelectElement>('[data-setting="xhair_enable"]').value === "1";
    const color = find<HTMLInputElement>(enhanced ? '[data-setting="xhair_color"]' : '[data-setting="cl_crosshair_color"]');
    const length = enhanced ? Math.min(22, Number(find<HTMLInputElement>('[data-setting="xhair_size"]').value))
      : size === "small" ? 6 : size === "large" ? 12 : 8;
    const gap = enhanced ? Math.max(0, Math.min(14, 4 + Number(find<HTMLInputElement>('[data-setting="xhair_gap"]').value)))
      : size === "large" ? 6 : 4;
    const reticle = find(".reticle");
    reticle.style.color = color.value;
    reticle.style.opacity = !enhanced && find<HTMLInputElement>('[data-setting="cl_crosshair_translucent"]').checked ? ".7" : "1";
    reticle.style.setProperty("--length", `${length}px`);
    reticle.style.setProperty("--gap", `${gap}px`);
    find("#classic-crosshair").hidden = enhanced;
    find("#enhanced-crosshair").hidden = !enhanced;
  }

  function selectedSpray() {
    const file = find<HTMLSelectElement>("#spray-image").value;
    const fs = engine.filesystem();
    return file && fs ? readMenuAsset(fs, "logos/" + file) : undefined;
  }

  function updateSpray() {
    const source = selectedSpray();
    const indexed = readIndexedSpray(source);
    const preview = find<HTMLCanvasElement>("canvas.spray-image");
    const color = find<HTMLInputElement>("#spray-color");
    const empty = find("#spray-empty");
    root.querySelector("img.spray-image")?.remove();
    if (sprayUrl) URL.revokeObjectURL(sprayUrl);
    sprayUrl = undefined;
    preview.hidden = !indexed;
    color.disabled = !indexed;
    empty.hidden = Boolean(indexed);
    if (indexed) {
      drawSpray(preview, indexed, hexToRgb(color.value));
    } else if (source && find<HTMLSelectElement>("#spray-image").value.toLowerCase().endsWith(".png")) {
      sprayUrl = URL.createObjectURL(new Blob([new Uint8Array(source)], { type: "image/png" }));
      const picture = document.createElement("img");
      picture.className = "spray-image";
      picture.alt = "";
      picture.addEventListener("load", () => {
        if (picture.src !== sprayUrl) return;
        empty.hidden = true;
        empty.before(picture);
      }, { once: true });
      picture.src = sprayUrl;
    }
  }

  function readOptions() {
    changed.clear();
    keyChanges.clear();
    endKeyEdit();
    find('[role="status"]').textContent = "";
    for (const field of root.querySelectorAll<SettingField>("[data-setting]")) {
      field.setCustomValidity("");
      const setting = field.dataset.setting!;
      const value = engine.setting(setting);
      if (field instanceof HTMLInputElement && field.type === "checkbox") {
        field.checked = field.dataset.invert === "negative" ? Number(value) < 0
          : field.dataset.invert === "zero" ? Number(value) === 0 : Number(value) !== 0;
      } else if (field instanceof HTMLInputElement && field.type === "color") {
        field.value = rgbToHex(value, "#32fa32");
      } else if (field instanceof HTMLSelectElement) {
        for (const option of [...field.options]) if (option.dataset.custom) option.remove();
        if (value && ![...field.options].some(option => option.value === value)) {
          const custom = new Option("Custom", value);
          custom.dataset.custom = "";
          field.add(custom);
        }
        if (value) field.value = value;
      } else if (value) {
        field.value = value;
      }
      updateOutput(field);
    }
    const select = find<HTMLSelectElement>("#spray-image");
    const fs = engine.filesystem();
    const files = fs ? sprayNames(fs) : [];
    const name = engine.setting("cl_logofile").toLowerCase();
    const extension = engine.setting("cl_logoext").toLowerCase();
    const match = files.find(file => file.toLowerCase() === `${name}.${extension}`)
      ?? files.find(file => file.toLowerCase().startsWith(name + "."));
    select.replaceChildren(new Option(files.length ? "Current spray" : "No sprays installed", ""),
      ...files.map(file => new Option(file.replace(/\.(bmp|png)$/i, ""), file)));
    select.value = match ?? "";
    select.disabled = !files.length;
    find<HTMLInputElement>("#spray-color").value = rgbToHex(engine.setting("cl_logocolor"), "#ff7818");
    refreshKeys();
    updateCrosshair();
    updateSpray();
  }

  function updateOutput(field: SettingField) {
    if (!(field instanceof HTMLInputElement) || field.type !== "range") return;
    const output = field.parentElement?.querySelector("output");
    if (output) output.value = field.max === "1" ? `${Math.round(Number(field.value) * 100)}%` : field.value;
  }

  function refreshKeys() {
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-key]")) {
      button.textContent = (keyChanges.get(button.dataset.key!) ?? engine.binding("get", button.dataset.key!)).toUpperCase() || "Unbound";
      button.setAttribute("aria-label", `${button.dataset.label}, ${button.textContent}. Change binding`);
    }
    const key = keyChanges.get("impulse 201") ?? engine.binding("get", "impulse 201");
    find("#spray-help").textContent = key ? `Spray in game with ${key.toUpperCase()}.` : "Bind Spray logo in Keyboard.";
  }

  function endKeyEdit() {
    if (editingKey) {
      editingKey.removeAttribute("aria-pressed");
      refreshKeys();
    }
    editingKey = undefined;
    warningKey = "";
  }

  function captureKey(key: string) {
    if (!editingKey) return;
    const command = editingKey.dataset.key!;
    const queued = [...keyChanges].find(([, assigned]) => assigned.toLowerCase() === key.toLowerCase())?.[0];
    const bound = queued ?? engine.binding("binding", "", key);
    if (bound && bound !== command && warningKey !== key) {
      warningKey = key;
      const label = keyActions.find(([, action]) => action === bound)?.[0] ?? "another action";
      find('[role="status"]').textContent = `${key.toUpperCase()} is used by ${label}. Press it again to replace that binding.`;
      return;
    }
    if (queued && queued !== command) keyChanges.delete(queued);
    keyChanges.set(command, key);
    endKeyEdit();
    find('[role="status"]').textContent = "";
  }

  function applySpray() {
    const select = find<HTMLSelectElement>("#spray-image");
    const color = find<HTMLInputElement>("#spray-color");
    if (!changed.has(select) && !changed.has(color)) return;
    const file = select.value;
    if (!file) return;
    const fs = engine.filesystem();
    const source = selectedSpray();
    const indexed = readIndexedSpray(source);
    const extension = file.toLowerCase().endsWith(".png") ? "png" : "bmp";
    if (!fs || !source || (extension === "bmp" && !indexed)) throw new Error("This spray could not be read.");
    const rgb = hexToRgb(color.value);
    fs.mkdirTree("/persist/cstrike/logos");
    fs.writeFile(`/persist/cstrike/logos/remapped.${extension}`, indexed ? recolorSpray(indexed, rgb) : source);
    engine.setting("cl_logofile", file.slice(0, -4));
    engine.setting("cl_logoext", extension);
    if (indexed) engine.setting("cl_logocolor", rgb.join(" "));
    engine.setting("@cl_logoupdate", engine.setting("@cl_logoupdate") === "1" ? "0" : "1");
  }

  async function save(close: boolean) {
    if (saving) return;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-action="ok"], [data-action="apply"]')];
    const status = find('[role="status"]');
    saving = true;
    buttons.forEach(button => { button.disabled = true; });
    try {
      for (const field of changed) {
        if (field instanceof HTMLInputElement && field.hasAttribute("data-number")) validateNumber(field);
      }
      const invalid = [...changed].find(field => !field.validity.valid
        && !field.closest("#classic-crosshair[hidden], #enhanced-crosshair[hidden]"));
      if (invalid) {
        selectTab(Number(invalid.closest("[role=tabpanel]")!.id.slice(-1)));
        invalid.reportValidity();
        return;
      }
      applySpray();
      for (const field of changed) {
        const name = field.dataset.setting;
        if (!name || !field.validity.valid) continue;
        let value = field.value;
        if (field instanceof HTMLInputElement && field.type === "checkbox") {
          if (field.dataset.invert === "negative") {
            const magnitude = Math.abs(Number(engine.setting(name))) || .022;
            value = String(field.checked ? -magnitude : magnitude);
          } else {
            value = String(Number(field.checked !== (field.dataset.invert === "zero")));
          }
        } else if (field instanceof HTMLInputElement && field.type === "color") {
          value = hexToRgb(value).join(" ");
          if (name === "xhair_color") value += " " + (engine.setting(name).trim().split(/\s+/)[3] ?? "255");
        } else if (field.hasAttribute("data-number")) {
          value = String(Number(value.trim()));
        }
        engine.setting(name, value);
      }
      for (const [command, key] of keyChanges) engine.binding("bind", command, key);
      await engine.save();
      if (current !== "options" || stage?.hidden) return;
      readOptions();
      if (close) setWindow("main");
      else status.textContent = "Settings saved.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Settings could not be saved.";
    } finally {
      saving = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function resume() {
    engine.action("resume");
    if (stage?.hidden && !touchControls && document.pointerLockElement !== canvas) {
      try { void canvas.requestPointerLock?.()?.catch(() => undefined); } catch { /* Browser requires a fresh click. */ }
    }
  }

  function goBack() {
    if (editingKey) {
      endKeyEdit();
      find('[role="status"]').textContent = "";
    } else if (current !== "main") {
      setWindow("main");
    } else if (inGame) {
      resume();
    }
  }

  function handleKey(event: KeyboardEvent) {
    if (!stage || stage.hidden || suspended || (event.key !== "Escape" && !event.composedPath().includes(stage))) return;
    // SDL listens above the canvas. Stop game bindings while DOM controls have focus.
    event.stopPropagation();
    if (event.type !== "keydown" || event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      goBack();
    } else if (editingKey && !event.repeat) {
      if (event.key === "Tab") { endKeyEdit(); return; }
      event.preventDefault();
      const key = engineKey(event.code);
      if (key) captureKey(key);
    } else if (event.code === "Backquote" && current === "main") {
      event.preventDefault();
      engine.action("console");
    } else if (root.activeElement?.getAttribute("role") === "tab" && current === "options"
        && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const last = root.querySelectorAll('[role="tab"]').length - 1;
      selectTab(event.key === "Home" ? 0 : event.key === "End" ? last
        : (activeTab + (event.key === "ArrowRight" ? 1 : last)) % (last + 1));
    } else if (current === "main" && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const buttons = [...root.querySelectorAll<HTMLButtonElement>("nav button:not([hidden])")];
      const currentIndex = buttons.findIndex(button => button === root.activeElement);
      buttons[(currentIndex + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length].focus();
    } else if (event.key === "Tab") {
      const view = find(`[data-view="${current}"]`);
      const controls = [...view.querySelectorAll<HTMLElement>('button, input, select')]
        .filter(control => !control.matches(":disabled") && control.tabIndex >= 0 && !control.closest("[hidden]"));
      const edge = event.shiftKey ? controls[0] : controls.at(-1);
      if (root.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
      }
    }
  }

  function mount(parent: HTMLElement) {
    stage = document.createElement("div");
    stage.hidden = true;
    stage.dataset.csjsMenu = "";
    root = stage.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${browserMenuStyle}</style>
      <canvas class="backdrop" aria-hidden="true" hidden></canvas><div class="wash" aria-hidden="true"></div>
      <section class="rail" data-view="main" aria-label="Counter-Strike main menu">
        <canvas class="title" role="img" aria-label="Counter-Strike" hidden></canvas>
        <h1>Counter-Strike 1.6</h1>
        <nav aria-label="Game">
          <button class="resume" data-action="resume">Resume Game</button>
          <button data-action="team">Change Team</button>
          <button data-action="options">Options</button>
          <button data-action="console">Console</button>
          <button class="disconnect" data-action="disconnect">Disconnect</button>
          <button class="disconnect" data-action="quit">Quit Game</button>
        </nav>
        <p class="hint"><kbd>Esc</kbd> · Back to game</p>
      </section>
      <div class="center" data-view="options" hidden>
        <form class="window" role="dialog" aria-modal="true" aria-labelledby="options-title" novalidate>
          <header><span id="options-title">Options</span><button type="button" class="close" data-action="back" aria-label="Close options">×</button></header>
          <div class="tabs" role="tablist" aria-label="Options categories">
            ${["Multiplayer", "Keyboard", "Mouse", "Audio", "Video"].map((tab, index) =>
              `<button type="button" role="tab" id="tab-${index}" aria-controls="page-${index}" data-tab="${index}">${tab}</button>`).join("")}
          </div>
          <div class="pages">
            <section class="player" role="tabpanel" id="page-0" aria-labelledby="tab-0">
              <fieldset>
                <legend>Crosshair</legend>
                <div class="preview" role="img" aria-label="Crosshair preview"><canvas class="scene" hidden></canvas><span class="reticle"><i></i><i></i><i></i><i></i></span></div>
                <label>Style <select data-setting="xhair_enable" aria-label="Crosshair style"><option value="0">Classic</option><option value="1">Enhanced</option></select></label>
                <div id="classic-crosshair">
                  <label>Size <select data-setting="cl_crosshair_size" aria-label="Crosshair size"><option value="auto">Auto-size</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
                  <label>Color <input type="color" data-setting="cl_crosshair_color" aria-label="Crosshair color"></label>
                  <label class="toggle"><input type="checkbox" data-setting="cl_dynamiccrosshair"> Dynamic crosshair</label>
                  <label class="toggle"><input type="checkbox" data-setting="cl_crosshair_translucent"> Translucent</label>
                </div>
                <div id="enhanced-crosshair" hidden>
                  <label>Length <input type="text" inputmode="decimal" data-number data-min="0" data-setting="xhair_size" value="4"></label>
                  <label>Gap offset <input type="text" data-number data-setting="xhair_gap" value="0"></label>
                  <label>Color <input type="color" data-setting="xhair_color" aria-label="Enhanced crosshair color"></label>
                  <label class="toggle"><input type="checkbox" data-setting="xhair_dynamic_move"> Dynamic crosshair</label>
                </div>
              </fieldset>
              <fieldset>
                <legend>Spraypaint</legend>
                <div class="preview" role="img" aria-label="Spray preview"><canvas class="spray-image" hidden></canvas><span id="spray-empty">No preview</span></div>
                <label>Image <select id="spray-image" aria-label="Spray image"></select></label>
                <label>Color <input type="color" id="spray-color" aria-label="Spray color"></label>
                <p class="help" id="spray-help"></p>
              </fieldset>
            </section>
            <section role="tabpanel" id="page-1" aria-labelledby="tab-1" hidden>
              <label class="toggle"><input type="checkbox" data-setting="hud_fastswitch"> Fast weapon switch</label>
              <table class="keys"><thead><tr><th scope="col">Action</th><th scope="col">Key / button</th></tr></thead><tbody>
                ${keyActions.map(([label, command]) => `<tr><td>${label}</td><td><button type="button" data-key="${command}" data-label="${label}"></button></td></tr>`).join("")}
              </tbody></table>
            </section>
            <section role="tabpanel" id="page-2" aria-labelledby="tab-2" hidden>
              <label class="setting">Mouse sensitivity <input type="text" inputmode="decimal" data-number data-min="0.01" data-setting="sensitivity" value="3"></label>
              <label class="setting toggle"><input type="checkbox" data-setting="m_pitch" data-invert="negative"> Reverse vertical aim</label>
              <label class="setting">Weapon hand <select data-setting="cl_righthand"><option value="1">Right</option><option value="0">Left</option></select></label>
            </section>
            <section role="tabpanel" id="page-3" aria-labelledby="tab-3" hidden>
              <label class="setting">Game volume <span class="spacer"></span><input type="range" min="0" max="1" step="0.01" data-setting="volume" aria-label="Game volume"><output></output></label>
              <label class="setting">Music volume <span class="spacer"></span><input type="range" min="0" max="1" step="0.01" data-setting="MP3Volume" aria-label="Music volume"><output></output></label>
              <label class="setting toggle"><input type="checkbox" data-setting="snd_mute_losefocus"> Mute when the tab is inactive</label>
            </section>
            <section role="tabpanel" id="page-4" aria-labelledby="tab-4" hidden>
              <label class="setting toggle"><input type="checkbox" data-setting="cl_showfps"> Show FPS</label>
              <label class="setting toggle"><input type="checkbox" data-setting="gl_texture_nearest" data-invert="zero"> Smooth texture filtering</label>
              <label class="setting toggle"><input type="checkbox" data-setting="r_detailtextures"> Detail textures</label>
            </section>
          </div>
          <p class="status" role="status"></p>
          <div class="footer"><button type="submit" data-action="ok">OK</button><button type="button" data-action="back">Cancel</button><button type="button" data-action="apply">Apply</button></div>
        </form>
      </div>
      <div class="center" data-view="confirm" hidden>
        <section class="window confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text">
          <header id="confirm-title"></header><div class="pages"><p id="confirm-text"></p></div>
          <div class="footer"><button data-action="leave"></button><button data-action="cancel">Cancel</button></div>
        </section>
      </div>`;

    const fs = engine.filesystem();
    if (fs) {
      const title = find<HTMLCanvasElement>("canvas.title");
      const scene = find<HTMLCanvasElement>("canvas.scene");
      const hasTitle = drawMenuTga(title, readMenuAsset(fs, "resource/logo_game.tga"), true);
      title.hidden = !hasTitle;
      find("h1").hidden = hasTitle;
      scene.hidden = !drawMenuTga(scene, readMenuAsset(fs, "gfx/vgui/crosshair.tga"));
    }
    parent.append(stage);
    resize = new ResizeObserver(fitCanvas);
    resize.observe(canvas);
    document.addEventListener("fullscreenchange", fitCanvas);
    window.addEventListener("resize", fitCanvas);
    for (const name of ["keydown", "keyup", "keypress"] as const) window.addEventListener(name, handleKey, true);
    stage.addEventListener("click", event => {
      const button = event.composedPath().find((target): target is HTMLButtonElement => target instanceof HTMLButtonElement);
      if (!button || button.disabled) return;
      if (button.dataset.tab) {
        endKeyEdit();
        find('[role="status"]').textContent = "";
        selectTab(Number(button.dataset.tab));
      }
      if (button.dataset.key) {
        endKeyEdit();
        editingKey = button;
        button.setAttribute("aria-pressed", "true");
        button.textContent = "Press a key…";
        find('[role="status"]').textContent = "Press a key, click a mouse button, or press Esc to cancel.";
      }
      switch (button.dataset.action) {
        case "resume": resume(); break;
        case "team": engine.action("team"); break;
        case "console": engine.action("console"); break;
        case "options":
          readOptions();
          activeTab = 0;
          setWindow("options");
          selectTab(0);
          break;
        case "disconnect":
        case "quit": {
          pendingExit = button.dataset.action;
          const label = pendingExit === "disconnect" ? "Disconnect" : "Quit Game";
          find("#confirm-title").textContent = label;
          find("#confirm-text").textContent = pendingExit === "disconnect" ? "Leave the current server?" : "Close the game client?";
          find('[data-action="leave"]').textContent = label;
          setWindow("confirm");
          break;
        }
        case "leave": engine.action(pendingExit); break;
        case "back":
        case "cancel": setWindow("main"); break;
        case "apply": void save(false); break;
      }
    });
    find<HTMLFormElement>("form").addEventListener("submit", event => { event.preventDefault(); void save(true); });
    for (const type of ["input", "change"]) root.addEventListener(type, event => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
      field.setCustomValidity("");
      changed.add(field);
      updateOutput(field);
      if (field.id === "spray-image" || field.id === "spray-color") updateSpray();
      else if (/^(?:cl_crosshair|xhair_)/.test(field.dataset.setting ?? "")) updateCrosshair();
    });
    let capturedMouse = false;
    root.addEventListener("pointerdown", (event: Event) => {
      if (!(event instanceof PointerEvent)) return;
      if (!editingKey || event.pointerType !== "mouse") return;
      event.preventDefault();
      const key = ["MOUSE1", "MOUSE3", "MOUSE2", "MOUSE4", "MOUSE5"][event.button];
      if (key) { capturedMouse = event.button === 0; captureKey(key); }
    });
    root.addEventListener("click", event => {
      if (capturedMouse) { capturedMouse = false; event.stopPropagation(); }
    });
    root.addEventListener("contextmenu", event => event.preventDefault());
  }

  return {
    show(visible: boolean, playing: boolean): boolean {
      if (disposed) return false;
      if (!visible) {
        if (stage && !stage.hidden) {
          stage.hidden = true;
          canvas.focus({ preventScroll: true });
        }
        return true;
      }
      if (!stage) {
        if (!canvas.parentElement) return false;
        mount(canvas.parentElement);
      }
      const firstOpen = stage!.hidden;
      inGame = playing;
      stage!.hidden = false;
      const backdrop = find<HTMLCanvasElement>(".backdrop");
      if (!playing && !hasBackdrop) {
        const fs = engine.filesystem();
        if (fs) hasBackdrop = drawMenuBackdrop(backdrop, fs);
      }
      backdrop.hidden = playing || !hasBackdrop;
      fitCanvas();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      for (const action of ["resume", "team", "disconnect"]) find(`[data-action="${action}"]`).hidden = !playing;
      find('[data-action="quit"]').hidden = playing;
      find(".hint").hidden = !playing || touchControls;
      if (firstOpen) setWindow("main");
      return true;
    },
    consoleVisibility(visible: boolean) {
      suspended = visible;
      if (!stage || stage.hidden) return;
      stage.inert = visible;
      if (!visible) setWindow(current);
    },
    dispose() {
      disposed = true;
      resize?.disconnect();
      stage?.remove();
      stage = undefined;
      if (sprayUrl) URL.revokeObjectURL(sprayUrl);
      document?.removeEventListener("fullscreenchange", fitCanvas);
      document?.removeEventListener("pointerlockchange", pointerLockChanged);
      window.removeEventListener("resize", fitCanvas);
      for (const name of ["keydown", "keyup", "keypress"] as const) window.removeEventListener(name, handleKey, true);
    },
  };
}
