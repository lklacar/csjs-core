import type { CSFileSystem } from "./types.js";

export function readMenuAsset(fs: CSFileSystem, path: string): Uint8Array | undefined {
  for (const root of ["/persist/cstrike", "/rodir/cstrike", "/persist/valve", "/rodir/valve"]) {
    try { return fs.readFile(`${root}/${path}`); } catch { /* Search the next game directory. */ }
  }
}

export function drawMenuTga(canvas: HTMLCanvasElement, source: Uint8Array | undefined, trim = false): boolean {
  // The shipped menu art uses uncompressed true-color TGA.
  if (!source || source.length < 18 || source[1] !== 0 || source[2] !== 2) return false;
  const header = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const width = header.getUint16(12, true);
  const height = header.getUint16(14, true);
  const stride = source[16] / 8;
  const start = 18 + source[0];
  if (!width || !height || width > 2048 || height > 2048 || (stride !== 3 && stride !== 4)
      || start + width * height * stride > source.length) return false;
  const context = canvas.getContext("2d");
  if (!context) return false;
  canvas.width = width;
  canvas.height = height;
  const image = context.createImageData(width, height);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = source[17] & 32 ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const column = source[17] & 16 ? width - 1 - x : x;
      const input = start + (row * width + column) * stride;
      const output = (y * width + x) * 4;
      image.data[output] = source[input + 2];
      image.data[output + 1] = source[input + 1];
      image.data[output + 2] = source[input];
      image.data[output + 3] = stride === 4 ? source[input + 3] : 255;
      if (trim && image.data[output + 3]) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (trim) {
    if (right < left) return false;
    canvas.width = right - left + 1;
    canvas.height = bottom - top + 1;
  }
  context.putImageData(image, trim ? -left : 0, trim ? -top : 0);
  return true;
}

export function drawMenuBackdrop(canvas: HTMLCanvasElement, fs: CSFileSystem): boolean {
  const context = canvas.getContext("2d");
  if (!context) return false;
  canvas.width = 800;
  canvas.height = 600;
  const tile = canvas.ownerDocument.createElement("canvas");
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      const path = `resource/background/800_${row + 1}_${"abcd"[column]}_loading.tga`;
      if (!drawMenuTga(tile, readMenuAsset(fs, path))) return false;
      context.drawImage(tile, column * 256, row * 256);
    }
  }
  return true;
}

export function sprayNames(fs: CSFileSystem): string[] {
  const names = new Map<string, string>();
  for (const directory of ["/persist/cstrike/logos", "/rodir/cstrike/logos", "/persist/valve/logos", "/rodir/valve/logos"]) {
    try {
      for (const file of fs.readdir(directory)) {
        if (/^(?!remapped\.)[a-z0-9_-]+\.(?:bmp|png)$/i.test(file) && !names.has(file.toLowerCase())) {
          names.set(file.toLowerCase(), file);
        }
      }
    } catch { /* The installation may omit a logos directory. */ }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

export function readIndexedSpray(source: Uint8Array | undefined) {
  if (!source || source.length < 54 || source[0] !== 66 || source[1] !== 77) return;
  const header = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const palette = 14 + header.getUint32(14, true);
  const start = header.getUint32(10, true);
  const width = header.getInt32(18, true);
  const height = header.getInt32(22, true);
  const stride = (width + 3) & ~3;
  if (palette < 54 || start < palette + 1024 || width < 1 || width > 256 || height < 1 || height > 256
      || header.getUint16(26, true) !== 1 || header.getUint16(28, true) !== 8 || header.getUint32(30, true) !== 0
      || start + stride * height > source.length) return;
  return { source, palette, start, width, height, stride };
}

export function recolorSpray(spray: NonNullable<ReturnType<typeof readIndexedSpray>>, rgb: number[]): Uint8Array {
  const remapped = spray.source.slice();
  for (let intensity = 0; intensity < 256; intensity++) {
    const offset = spray.palette + intensity * 4;
    remapped[offset] = rgb[2] * intensity / 256;
    remapped[offset + 1] = rgb[1] * intensity / 256;
    remapped[offset + 2] = rgb[0] * intensity / 256;
  }
  return remapped;
}

export function drawSpray(canvas: HTMLCanvasElement, spray: NonNullable<ReturnType<typeof readIndexedSpray>>, rgb: number[]) {
  const context = canvas.getContext("2d");
  if (!context) return;
  canvas.width = spray.width;
  canvas.height = spray.height;
  const image = context.createImageData(spray.width, spray.height);
  for (let y = 0; y < spray.height; y++) {
    const row = spray.start + (spray.height - 1 - y) * spray.stride;
    for (let x = 0; x < spray.width; x++) {
      image.data.set([...rgb, spray.source[row + x]], (y * spray.width + x) * 4);
    }
  }
  context.putImageData(image, 0, 0);
}
