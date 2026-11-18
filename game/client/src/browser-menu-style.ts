export const browserMenuStyle = `
  :host {
    position: fixed; z-index: 8; isolation: isolate; overflow: hidden;
    font: 14px/1.4 Tahoma, Verdana, sans-serif; color: #ecede4; color-scheme: dark;
    --face: #4c5844; --edge: #89957e; --shade: #242b20; --well: #323a2c; --gold: #f1cf80;
    container-type: size;
  }
  :host([hidden]), [hidden] { display: none !important; }
  *, *::before, *::after { box-sizing: border-box; }
  .backdrop, .wash { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; }
  .backdrop { object-fit: cover; background: #161b14; }
  .wash { background: linear-gradient(90deg, rgb(13 17 13 / .93), rgb(17 22 16 / .52) 48%, rgb(17 22 16 / .18) 100%),
    linear-gradient(0deg, rgb(11 15 11 / .74), transparent 62%); }
  :host([data-window]) .wash { background: rgb(14 18 14 / .71); }
  button, input, select { font: inherit; color: inherit; }
  button { cursor: pointer; }
  :focus-visible { outline: 2px solid var(--gold); outline-offset: -2px; }
  ::selection { background: #8b723c; color: #fff; }
  .rail {
    position: absolute; inset: auto auto clamp(14px, 6cqh, 64px) clamp(16px, 5cqw, 80px);
    width: min(460px, calc(100% - 32px)); max-height: calc(100% - 24px); overflow: auto;
    padding: 3px; scrollbar-color: var(--edge) var(--well);
  }
  .title { display: block; width: min(100%, 340px); height: auto; margin: 0 0 23px 4px; }
  h1 { font-size: 28px; margin: 0 0 24px; }
  nav { display: grid; width: min(280px, 100%); }
  nav button {
    background: transparent; border: 1px solid transparent; text-align: left; padding: 7px 12px;
    min-height: 38px; color: #f0f0e7; font-size: 17px; font-weight: bold; line-height: 1.25;
  }
  nav button:hover, nav button:focus-visible {
    color: var(--gold); background: #4c5844; border-color: #6a775f #32392d #32392d #6a775f;
  }
  nav .resume { color: var(--gold); }
  nav .disconnect { margin-top: 9px; border-top-color: #66705f; }
  .hint { color: #d2dacb; margin: 15px 0 0 12px; font-size: 12px; }
  kbd { font: inherit; color: #f2f0e2; }
  .center { position: absolute; inset: 0; display: grid; place-items: center; padding: 12px; }
  .window {
    width: min(654px, 100%); max-height: 100%; display: flex; flex-direction: column;
    min-height: 0; background: var(--face); padding: 6px; border: 1px solid;
    border-color: var(--edge) var(--shade) var(--shade) var(--edge);
    box-shadow: 4px 8px 28px rgb(0 0 0 / .48);
  }
  form.window { height: min(458px, 100%); }
  .window header {
    min-height: 26px; padding: 0 5px 5px 8px; display: flex; justify-content: space-between;
    align-items: center; gap: 12px; font-weight: bold; font-size: 15px;
  }
  .window button, select {
    background: var(--face); border: 1px solid; border-radius: 0; padding: 4px 10px;
    border-color: var(--edge) var(--shade) var(--shade) var(--edge);
  }
  .window button:hover, select:hover { background: #617155; }
  .window button:active { border-color: var(--shade) var(--edge) var(--edge) var(--shade); }
  .window button:disabled { color: #c0cbb8; background: #424b3c; cursor: default; }
  .close { display: grid; place-items: center; width: 26px; height: 24px; padding: 0 !important; }
  .tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 3px 4px 0; }
  .tabs button { min-height: 32px; background: #3b4635; }
  .tabs [aria-selected="true"] { color: var(--gold); background: var(--well); border-bottom-color: var(--well); }
  .pages {
    background: var(--well); border: 1px solid; border-color: var(--shade) var(--edge) var(--edge) var(--shade);
    flex: 1; min-height: 0; overflow: auto; padding: 14px; scrollbar-color: var(--edge) var(--well);
  }
  .pages > section { min-height: 250px; }
  .player { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; }
  fieldset { margin: 0; padding: 8px 10px 10px; min-width: 0; border: 1px solid #727e69; }
  legend { padding: 0 5px; font-weight: bold; }
  label { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 31px; }
  label.toggle { justify-content: flex-start; }
  input[type="checkbox"], input[type="range"] { accent-color: #dac181; }
  input[type="checkbox"] { width: 16px; height: 16px; margin: 0; flex: none; }
  input[data-number] { width: 86px; background: #20271d; border: 1px solid var(--edge); padding: 4px 6px; }
  input[type="color"] { width: 48px; height: 25px; padding: 2px; border: 1px solid var(--edge); background: var(--face); }
  select { min-width: 96px; max-width: 64%; }
  .preview {
    position: relative; display: grid; place-items: center; height: 86px; margin: 3px 0 7px;
    background: #232a20; border: 1px solid #74816b; overflow: hidden;
  }
  .preview .scene { position: absolute; width: 100%; height: 100%; object-fit: cover; opacity: .8; }
  .reticle { position: relative; width: 40px; height: 40px; color: #32fa32; }
  .reticle i { position: absolute; background: currentColor; }
  .reticle i:nth-child(-n+2) { top: calc(50% - 1px); height: 2px; width: var(--length, 8px); }
  .reticle i:nth-child(n+3) { left: calc(50% - 1px); width: 2px; height: var(--length, 8px); }
  .reticle i:nth-child(1) { right: calc(50% + var(--gap, 4px)); }
  .reticle i:nth-child(2) { left: calc(50% + var(--gap, 4px)); }
  .reticle i:nth-child(3) { bottom: calc(50% + var(--gap, 4px)); }
  .reticle i:nth-child(4) { top: calc(50% + var(--gap, 4px)); }
  .spray-image { width: 64px; height: 64px; object-fit: contain; }
  .help { color: #d1dac9; font-size: 12px; margin: 9px 0 0; }
  .setting { min-height: 44px; border-bottom: 1px solid #53614b; }
  .setting input[type="range"] { width: min(43%, 240px); }
  .setting output { min-width: 3ch; text-align: right; font-variant-numeric: tabular-nums; }
  .setting .spacer { flex: 1; }
  .keys { width: 100%; border-collapse: collapse; }
  .keys th { text-align: left; color: #d1dac9; }
  .keys td, .keys th { border-bottom: 1px solid #53614b; padding: 3px 4px; }
  .keys button { min-width: 110px; width: 100%; text-align: left; }
  .keys td:last-child { width: 40%; }
  .footer { display: flex; gap: 6px; justify-content: flex-end; padding: 7px 0 0; }
  .footer button { min-width: 75px; min-height: 32px; }
  .status { color: var(--gold); margin: 6px 3px 0; font-size: 12px; }
  .confirm { width: min(352px, 100%); }
  .confirm p { margin: 0; }
  @container (max-width: 480px) {
    form.window { height: min(604px, 100%); }
    .tabs button { padding-inline: 7px; font-size: 13px; }
    .player { grid-template-columns: 1fr; }
    .pages { padding: 9px; }
    .pages > section { min-height: 0; }
  }
  @container (max-height: 440px) {
    .title, h1 { margin-bottom: 9px; }
    nav button { min-height: 31px; padding: 4px 10px; }
    nav .disconnect, .hint { margin-top: 4px; }
    .footer { padding-top: 4px; }
  }
`;
