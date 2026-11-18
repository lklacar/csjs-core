type ConsoleAction = "submit" | "complete" | "older" | "newer" | "close";

const SCROLLBACK_LIMIT = 64 * 1024;

export function createBrowserConsole(
  canvas: HTMLCanvasElement,
  edit: (action: ConsoleAction, text: string) => string,
) {
  let scrollback = "";
  let stage: HTMLDivElement | undefined;
  let panel: HTMLElement;
  let output: HTMLTextAreaElement;
  let input: HTMLInputElement;
  let observer: ResizeObserver | undefined;
  let updateQueued = false;
  let discarded = 0;
  let disposed = false;

  const renderOutput = () => {
    updateQueued = false;
    if (!stage || stage.hidden) return;
    if (output.value === scrollback) {
      discarded = 0;
      return;
    }
    const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 2;
    const scrollTop = output.scrollTop;
    const start = Math.max(0, output.selectionStart - discarded);
    const end = Math.max(0, output.selectionEnd - discarded);
    const direction = output.selectionDirection;
    output.value = scrollback;
    discarded = 0;
    output.setSelectionRange(start, end, direction);
    output.scrollTop = atBottom && start === end ? output.scrollHeight : scrollTop;
  };

  const position = (x: number, y: number) => {
    if (!stage) return;
    const left = Math.max(0, Math.min(x, stage.clientWidth - panel.offsetWidth));
    const top = Math.max(0, Math.min(y, stage.clientHeight - panel.offsetHeight));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.maxWidth = `calc(100% - ${left}px)`;
    panel.style.maxHeight = `calc(100% - ${top}px)`;
  };

  const fitCanvas = () => {
    if (!stage || stage.hidden) return;
    const { left, top, width, height } = canvas.getBoundingClientRect();
    Object.assign(stage.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    if (panel.style.left) {
      // Let the panel shrink with the canvas before clamping its position.
      panel.style.maxWidth = "100%";
      panel.style.maxHeight = "100%";
      position(panel.offsetLeft, panel.offsetTop);
    }
  };

  const mount = (parent: HTMLElement) => {
    const document = canvas.ownerDocument;
    stage = document.createElement("div");
    stage.dataset.csjsConsole = "";
    const shadow = stage.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host { position: fixed; z-index: 9; overflow: hidden; }
      :host([hidden]) { display: none; }
      section {
        position: absolute; left: max(12px, calc(100% - 784px)); top: 8%;
        width: min(760px, calc(100% - 24px)); height: min(460px, 75%);
        min-width: min(260px, 100%); min-height: min(150px, 100%);
        box-sizing: border-box; padding: 4px; display: grid; grid-template-rows: 24px minmax(0, 1fr) auto; gap: 4px;
        background: #4c5844; color: #d8ded3; border: 1px solid;
        border-color: #889180 #282e22 #282e22 #889180; overflow: hidden; resize: both;
        font: 13px Tahoma, Verdana, sans-serif; color-scheme: dark;
      }
      header { display: flex; justify-content: space-between; align-items: center;
        padding-left: 4px; font-weight: bold; cursor: move; touch-action: none; user-select: none; }
      form { display: flex; gap: 4px; margin: 0 9px 0 0; }
      textarea, input {
        box-sizing: border-box; min-width: 0; width: 100%; padding: 4px 6px; border: 1px solid;
        border-color: #282e22 #889180 #889180 #282e22; border-radius: 0;
        background: #3e4637; color: #d8ded3; font: 13px/1.35 monospace; }
      textarea { resize: none; scrollbar-color: #7f8c75 #3e4637; }
      textarea::selection, input::selection { background: #958831; color: #fff; }
      button { color: #d8ded3; background: #4c5844; padding: 2px 8px; cursor: pointer;
        border: 1px solid; border-color: #889180 #282e22 #282e22 #889180; font: inherit; }
      button:hover { color: #fff; background: #5a6a50; }
      :focus-visible { outline: 1px solid #d6c56b; outline-offset: -2px; }
    </style>
    <section role="dialog" aria-label="Console">
      <header>Console <button type="button" aria-label="Close console">×</button></header>
      <textarea readonly spellcheck="false" aria-label="Console output"></textarea>
      <form><input type="text" aria-label="Console command" spellcheck="false" autocomplete="off" autocapitalize="off">
        <button type="submit">Submit</button></form>
    </section>`;
    panel = shadow.querySelector("section")!;
    output = shadow.querySelector("textarea")!;
    input = shadow.querySelector("input")!;
    const header = shadow.querySelector("header")!;
    const close = shadow.querySelector<HTMLButtonElement>("header button")!;

    const run = (action: ConsoleAction) => {
      input.value = edit(action, input.value.replace(/[\x00-\x1f\x7f]/g, " "));
    };
    close.addEventListener("click", () => run("close"));
    shadow.querySelector("form")!.addEventListener("submit", event => {
      event.preventDefault();
      if (input.value.trim()) run("submit");
      input.focus();
    });
    panel.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.isComposing) return;
      const plain = !event.altKey && !event.ctrlKey && !event.metaKey;
      if (event.key === "Escape" || (plain && event.code === "Backquote")) {
        event.preventDefault();
        run("close");
      } else if (plain && !event.shiftKey && event.target === input) {
        const action = { ArrowUp: "older", ArrowDown: "newer", Tab: "complete" }[event.key] as ConsoleAction | undefined;
        if (action) {
          event.preventDefault();
          run(action);
        }
      }
    });
    for (const eventName of ["keyup", "keypress", "mousedown", "mouseup", "wheel"]) {
      panel.addEventListener(eventName, event => event.stopPropagation());
    }

    let drag: { pointer: number; x: number; y: number } | undefined;
    header.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target === close) return;
      event.preventDefault();
      header.setPointerCapture(event.pointerId);
      drag = { pointer: event.pointerId, x: event.clientX - panel.offsetLeft, y: event.clientY - panel.offsetTop };
    });
    header.addEventListener("pointermove", event => {
      if (drag?.pointer === event.pointerId) position(event.clientX - drag.x, event.clientY - drag.y);
    });
    header.addEventListener("lostpointercapture", () => { drag = undefined; });
    parent.append(stage);
    observer = new ResizeObserver(fitCanvas);
    observer.observe(canvas);
    window.addEventListener("resize", fitCanvas);
    document.addEventListener("fullscreenchange", fitCanvas);
  };

  return {
    append(text: string | null) {
      if (disposed) return;
      if (text === null) {
        discarded += scrollback.length;
        scrollback = "";
      } else {
        scrollback += text.replace(/\^[0-7]/g, "");
        discarded += Math.max(0, scrollback.length - SCROLLBACK_LIMIT);
        scrollback = scrollback.slice(-SCROLLBACK_LIMIT);
      }
      if (!updateQueued && stage && !stage.hidden) {
        updateQueued = true;
        queueMicrotask(renderOutput);
      }
    },
    show(visible: boolean): boolean {
      if (disposed) return false;
      if (visible) {
        if (!stage) {
          if (!canvas.parentElement) return false;
          mount(canvas.parentElement);
        }
        stage!.hidden = false;
        fitCanvas();
        input.value = "";
        renderOutput();
        output.scrollTop = output.scrollHeight;
        input.focus({ preventScroll: true });
      } else if (stage && !stage.hidden) {
        stage.hidden = true;
        if (canvas.isConnected) canvas.focus({ preventScroll: true });
      }
      return true;
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      stage?.remove();
      stage = undefined;
      scrollback = "";
      window.removeEventListener("resize", fitCanvas);
      canvas.ownerDocument?.removeEventListener("fullscreenchange", fitCanvas);
    },
  };
}
