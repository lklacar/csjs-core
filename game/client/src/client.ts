import { GameAssets } from "./assets.js";
import { createBrowserConsole } from "./browser-console.js";
import { createBrowserMenu } from "./browser-menu.js";
import { downloadBytes, retryDelay } from "./download.js";
import { CSClientError } from "./errors.js";
import {
  closePersistence,
  preparePersistence,
  syncFileSystem,
  syncUserFileSystem,
} from "./persistence.js";
import type { XashModule, XashModuleOptions } from "./runtime/xash.js";
import type {
  CSClientOptions,
  CSClientProgress,
  CSFileSystem,
} from "./types.js";

declare global {
  var __csjsNetwork: DatagramBridge | undefined;
  var __csjsRenderProfiler: CSJSRenderProfiler | undefined;
}

interface DisjointTimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface PendingGpuQuery {
  query: WebGLQuery;
  endedAt: number;
  frameOrdinal: number;
}

interface PendingDrawGpuQuery {
  query: WebGLQuery;
  signature: string;
}

interface DrawGpuTiming {
  samples: number;
  totalMs: number;
  maxMs: number;
}

interface EngineFrameInfo {
  frameNumber: number;
  map: string;
  camera: {
    origin: [number, number, number];
    angles: [number, number, number];
  };
  fpsMax: number;
  vsync: boolean;
  vbo: boolean;
  detailTextures: boolean;
  vboDetail: number;
}

interface GLProfileCounters {
  drawCalls: number;
  drawArrays: number;
  drawElements: number;
  drawRangeElements: number;
  submittedVertices: number;
  submittedTriangles: number;
  submittedLines: number;
  bufferDataCalls: number;
  bufferDataBytes: number;
  bufferSubDataCalls: number;
  bufferSubDataBytes: number;
  textureUploadCalls: number;
  textureUploadBytes: number;
  textureBinds: number;
  bufferBinds: number;
  elementBufferBinds: number;
  framebufferBinds: number;
  programSwitches: number;
  uniformCalls: number;
  vertexAttribCalls: number;
  stateCalls: number;
  clearCalls: number;
  flushCalls: number;
  finishCalls: number;
  synchronousReadCalls: number;
  shaderCompileCalls: number;
  programLinkCalls: number;
  mipmapCalls: number;
  drawCountLe6: number;
  drawCountLe32: number;
  drawCountLe128: number;
  drawCountLe512: number;
  drawCountGt512: number;
  drawSubmitMs: number;
  maxDrawSubmitMs: number;
  bufferUploadMs: number;
  textureUploadMs: number;
  flushFinishMs: number;
  synchronousReadMs: number;
  shaderCompileLinkMs: number;
  mipmapMs: number;
}

interface DrawSignature {
  calls: number;
  vertices: number;
}

interface PhaseProfileCounters {
  drawCalls: number;
  drawArrays: number;
  drawElements: number;
  vertices: number;
  bufferDataCalls: number;
  bufferDataBytes: number;
  bufferSubDataCalls: number;
  bufferSubDataBytes: number;
  textureBinds: number;
  bufferBinds: number;
  stateCalls: number;
}

const renderPhaseNames = [
  "scene setup", "world", "solid entity", "alpha world", "solid sprite",
  "opaque effects", "normal triangles", "translucent entity",
  "transparent triangles", "translucent effects", "viewmodel", "water", "post scene",
] as const;

interface RenderBisectMode {
  label: string;
  skip: (phase: number, modelType: number) => boolean;
}

const renderBisectModes: readonly RenderBisectMode[] = [
  { label: "baseline", skip: () => false },
  { label: "no transparent triangles", skip: (phase) => phase === 8 },
  { label: "no translucent studio", skip: (phase, model) => phase === 7 && model === 3 },
  { label: "no translucent sprites", skip: (phase, model) => phase === 7 && model === 1 },
  { label: "no translucent brushes", skip: (phase, model) => phase === 7 && model === 0 },
  { label: "no translucent entities", skip: (phase) => phase === 7 },
  { label: "no alpha world", skip: (phase) => phase === 3 },
  { label: "no solid sprites", skip: (phase) => phase === 4 },
  { label: "no opaque effects", skip: (phase) => phase === 5 },
  { label: "no normal triangles", skip: (phase) => phase === 6 },
  { label: "no translucent effects", skip: (phase) => phase === 9 },
  { label: "no viewmodel", skip: (phase) => phase === 10 },
  { label: "no water", skip: (phase) => phase === 11 },
  { label: "no solid studio", skip: (phase, model) => phase === 2 && model === 3 },
  { label: "no solid entities", skip: (phase) => phase === 2 },
  { label: "no world", skip: (phase) => phase === 1 },
  { label: "no client callbacks", skip: (phase) => [5, 6, 8, 9].includes(phase) },
  { label: "no translucent content", skip: (phase) => [3, 4, 7, 8, 9, 11].includes(phase) },
] as const;

function emptyPhaseProfileCounters(): PhaseProfileCounters {
  return {
    drawCalls: 0, drawArrays: 0, drawElements: 0, vertices: 0,
    bufferDataCalls: 0, bufferDataBytes: 0, bufferSubDataCalls: 0,
    bufferSubDataBytes: 0, textureBinds: 0, bufferBinds: 0, stateCalls: 0,
  };
}

function emptyGLProfileCounters(): GLProfileCounters {
  return {
    drawCalls: 0, drawArrays: 0, drawElements: 0, drawRangeElements: 0,
    submittedVertices: 0, submittedTriangles: 0, submittedLines: 0,
    bufferDataCalls: 0, bufferDataBytes: 0, bufferSubDataCalls: 0, bufferSubDataBytes: 0,
    textureUploadCalls: 0, textureUploadBytes: 0, textureBinds: 0,
    bufferBinds: 0, elementBufferBinds: 0, framebufferBinds: 0, programSwitches: 0,
    uniformCalls: 0, vertexAttribCalls: 0, stateCalls: 0, clearCalls: 0,
    flushCalls: 0, finishCalls: 0, synchronousReadCalls: 0, shaderCompileCalls: 0,
    programLinkCalls: 0, mipmapCalls: 0, drawCountLe6: 0, drawCountLe32: 0,
    drawCountLe128: 0, drawCountLe512: 0, drawCountGt512: 0, drawSubmitMs: 0,
    maxDrawSubmitMs: 0, bufferUploadMs: 0, textureUploadMs: 0, flushFinishMs: 0,
    synchronousReadMs: 0, shaderCompileLinkMs: 0, mipmapMs: 0,
  };
}

function profileByteLength(value: unknown): number {
  if (typeof value === "number") return Math.max(0, value);
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return 0;
}

function profileBufferUploadByteLength(
  arguments_: readonly unknown[],
  dataIndex: number,
  sourceOffsetIndex: number,
  lengthIndex: number,
): number {
  const value = arguments_[dataIndex];
  if (typeof value === "number") return Math.max(0, value);
  if (!ArrayBuffer.isView(value)) return profileByteLength(value);

  const elementBytes = "BYTES_PER_ELEMENT" in value
    ? Number((value as ArrayBufferView & { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT)
    : 1;
  const requestedLength = arguments_[lengthIndex];
  if (typeof requestedLength === "number") return Math.max(0, requestedLength * elementBytes);

  const requestedOffset = arguments_[sourceOffsetIndex];
  const offsetBytes = typeof requestedOffset === "number" ? requestedOffset * elementBytes : 0;
  return Math.max(0, value.byteLength - offsetBytes);
}

function roundedDistribution(values: readonly number[]): { avg: number; p95: number; max: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    avg: Number(avg.toFixed(3)),
    p95: Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)),
  };
}

function submittedPrimitives(mode: number, count: number): { triangles: number; lines: number } {
  switch (mode) {
    case 0x0004: return { triangles: Math.floor(count / 3), lines: 0 };
    case 0x0005:
    case 0x0006: return { triangles: Math.max(0, count - 2), lines: 0 };
    case 0x0001: return { triangles: 0, lines: Math.floor(count / 2) };
    case 0x0002: return { triangles: 0, lines: count };
    case 0x0003: return { triangles: 0, lines: Math.max(0, count - 1) };
    default: return { triangles: 0, lines: 0 };
  }
}
class CSJSRenderProfiler {
  readonly #canvas: HTMLCanvasElement;
  readonly #originalMethods = new Map<string, (...arguments_: unknown[]) => unknown>();
  #context?: WebGL2RenderingContext;
  #timerExtension?: DisjointTimerQueryExtension;
  #activeQuery?: WebGLQuery;
  readonly #pendingQueries: PendingGpuQuery[] = [];
  readonly #pendingDrawQueries: PendingDrawGpuQuery[] = [];
  readonly #drawGpuTimings = new Map<string, DrawGpuTiming>();
  #drawGpuQueriesIssued = 0;
  #drawGpuProfileTruncated = false;
  readonly #drawGpuQueriesEnabled = drawGpuProfilingEnabled();
  readonly #gpuTimerQueriesEnabled = this.#drawGpuQueriesEnabled || gpuTimerProfilingEnabled();
  #gpuDisjointEvents = 0;
  #counters = emptyGLProfileCounters();
  #frameCpuMs: number[] = [];
  #frameIntervalsMs: number[] = [];
  #interFrameWaitMs: number[] = [];
  #browserRafIntervalsMs: number[] = [];
  #timerDriftMs: number[] = [];
  #gpuFrameMs: number[] = [];
  #gpuQueryLatencyMs: number[] = [];
  #gpuQueryLatencyFrames: number[] = [];
  #frameStartedAt = 0;
  #previousFrameStartedAt = 0;
  #previousFrameEndedAt = 0;
  #previousBrowserRafAt = 0;
  #reportStartedAt = performance.now();
  #callbacks = 0;
  #browserRafCallbacks = 0;
  #drawnFrames = 0;
  #profiledFrames = 0;
  #drawCallsAtFrameStart = 0;
  #frameOrdinal = 0;
  #captureNextDetailedFrame = true;
  #capturingDetailedFrame = false;
  #lastEngineFrame = -1;
  #engineFrames = 0;
  #latestEngineInfo?: EngineFrameInfo;
  readonly #programs = new Set<unknown>();
  readonly #textures = new Set<unknown>();
  readonly #buffers = new Set<unknown>();
  readonly #objectIds = new WeakMap<object, number>();
  readonly #drawSignatures = new Map<string, DrawSignature>();
  readonly #phaseCounters = new Map<string, PhaseProfileCounters>();
  #currentRenderPhase = "outside";
  #renderPasses = 0;
  readonly #renderBisectEnabled = renderBisectEnabled();
  #renderBisectIndex = 0;
  #nextObjectId = 1;
  #activeTextureUnit = 0;
  #currentProgram: unknown;
  readonly #boundTextures = new Map<number, unknown>();
  #longTaskObserver?: PerformanceObserver;
  #longTaskCount = 0;
  #longTaskTotalMs = 0;
  #longTaskMaxMs = 0;
  #browserRafHandle = 0;
  #timerProbeHandle = 0;
  #disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#browserRafHandle = window.requestAnimationFrame(this.#onBrowserRaf);
    this.#scheduleTimerProbe();
    try {
      this.#longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.#longTaskCount++;
          this.#longTaskTotalMs += entry.duration;
          this.#longTaskMaxMs = Math.max(this.#longTaskMaxMs, entry.duration);
        }
      });
      this.#longTaskObserver.observe({ type: "longtask", buffered: true });
    } catch {
      this.#longTaskObserver = undefined;
    }
  }

  beginFrame(): boolean {
    const now = performance.now();
    this.#frameOrdinal++;
    this.#callbacks++;
    if (this.#previousFrameStartedAt > 0) this.#frameIntervalsMs.push(now - this.#previousFrameStartedAt);
    if (this.#previousFrameEndedAt > 0) this.#interFrameWaitMs.push(now - this.#previousFrameEndedAt);
    this.#previousFrameStartedAt = now;
    this.#frameStartedAt = now;
    this.#currentRenderPhase = "host frame";

    if (!this.#context) {
      const context = this.#canvas.getContext("webgl2");
      if (context) this.#attachContext(context);
    }
    if (this.#captureNextDetailedFrame) {
      this.#captureNextDetailedFrame = false;
      this.#capturingDetailedFrame = true;
      this.#drawCallsAtFrameStart = this.#counters.drawCalls;
      this.#installWrappers();
    }
    this.#pollGpuQueries();

    const gl = this.#context;
    const timer = this.#timerExtension;
    if (gl && timer && !this.#capturingDetailedFrame && !this.#activeQuery && this.#pendingQueries.length < 12) {
      try {
        const query = gl.createQuery();
        if (query) {
          gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
          this.#activeQuery = query;
        }
      } catch {
        this.#activeQuery = undefined;
      }
    }
    return this.#capturingDetailedFrame;
  }

  endFrame(info: EngineFrameInfo): void {
    const now = performance.now();
    const gl = this.#context;
    const timer = this.#timerExtension;
    if (gl && timer && this.#activeQuery) {
      try {
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        this.#pendingQueries.push({
          query: this.#activeQuery,
          endedAt: now,
          frameOrdinal: this.#frameOrdinal,
        });
      } catch {
        gl.deleteQuery(this.#activeQuery);
      }
      this.#activeQuery = undefined;
    }

    if (this.#frameStartedAt > 0) this.#frameCpuMs.push(now - this.#frameStartedAt);
    this.#previousFrameEndedAt = now;
    if (info.frameNumber !== this.#lastEngineFrame) {
      this.#engineFrames++;
      this.#drawnFrames++;
      this.#lastEngineFrame = info.frameNumber;
    }
    this.#latestEngineInfo = info;
    if (this.#capturingDetailedFrame) {
      if (this.#counters.drawCalls > this.#drawCallsAtFrameStart) this.#profiledFrames++;
      this.#capturingDetailedFrame = false;
      this.#removeWrappers();
    }

    if (now - this.#reportStartedAt >= 1_000) this.#report(now);
  }

  setRenderPhase(
    phase: number,
    entityIndex: number,
    modelType: number,
    viewFlags: number,
    renderMode: number,
    renderFx: number,
    modelIndex: number,
    modelName: string,
    originX: number,
    originY: number,
    originZ: number,
    modelRadius: number,
  ): void {
    const name = renderPhaseNames[phase] ?? `phase ${phase}`;
    if (phase === 0) this.#renderPasses++;
    const entity = entityIndex > 0 ? `/entity:${entityIndex}` : "";
    const model = modelType > 0 ? `/model:${modelType}` : "";
    const asset = modelName ? `/asset:${modelName}` : "";
    const state = entityIndex > 0
      ? `/modelIndex:${modelIndex}/renderMode:${renderMode}/renderFx:${renderFx}`
      : "";
    const placement = entityIndex > 0
      ? `/origin:${originX.toFixed(1)},${originY.toFixed(1)},${originZ.toFixed(1)}/radius:${modelRadius.toFixed(1)}`
      : "";
    this.#currentRenderPhase = `${name}${entity}${model}${asset}${state}${placement}/view:${viewFlags}`;
  }

  shouldSkipRenderPhase(phase: number, modelType: number): boolean {
    if (!this.#renderBisectEnabled) return false;
    return renderBisectModes[this.#renderBisectIndex].skip(phase, modelType);
  }

  dispose(): void {
    this.#disposed = true;
    window.cancelAnimationFrame(this.#browserRafHandle);
    window.clearTimeout(this.#timerProbeHandle);
    this.#longTaskObserver?.disconnect();
    this.#removeWrappers();
    if (this.#context) {
      if (this.#activeQuery) this.#context.deleteQuery(this.#activeQuery);
      for (const pending of this.#pendingQueries) this.#context.deleteQuery(pending.query);
      for (const pending of this.#pendingDrawQueries) this.#context.deleteQuery(pending.query);
    }
    this.#pendingQueries.length = 0;
    this.#pendingDrawQueries.length = 0;
  }

  readonly #onBrowserRaf = (now: number): void => {
    if (this.#disposed) return;
    this.#browserRafCallbacks++;
    if (this.#previousBrowserRafAt > 0) this.#browserRafIntervalsMs.push(now - this.#previousBrowserRafAt);
    this.#previousBrowserRafAt = now;
    this.#browserRafHandle = window.requestAnimationFrame(this.#onBrowserRaf);
  };

  #scheduleTimerProbe(): void {
    const dueAt = performance.now() + 50;
    this.#timerProbeHandle = window.setTimeout(() => {
      if (this.#disposed) return;
      this.#timerDriftMs.push(Math.max(0, performance.now() - dueAt));
      this.#scheduleTimerProbe();
    }, 50);
  }

  #installWrappers(): void {
    const prototype = WebGL2RenderingContext.prototype as unknown as Record<string, unknown>;
    const methods = [
      "drawArrays", "drawElements", "drawRangeElements", "bufferData", "bufferSubData",
      "texImage2D", "texSubImage2D", "compressedTexImage2D", "compressedTexSubImage2D",
      "copyTexImage2D", "copyTexSubImage2D", "generateMipmap", "bindTexture", "activeTexture",
      "bindBuffer", "bindFramebuffer", "useProgram", "vertexAttribPointer", "enableVertexAttribArray",
      "disableVertexAttribArray", "clear", "viewport", "scissor", "enable", "disable", "blendFunc",
      "blendFuncSeparate", "blendEquation", "blendEquationSeparate", "depthFunc", "depthMask",
      "colorMask", "cullFace", "frontFace", "pixelStorei", "flush", "finish", "compileShader", "linkProgram",
      "bindVertexArray", "vertexAttribIPointer", "readPixels", "getBufferSubData", "clientWaitSync", "generateMipmap",
      "uniform1f", "uniform2f", "uniform3f", "uniform4f", "uniform1i", "uniform2i", "uniform3i", "uniform4i",
      "uniform1fv", "uniform2fv", "uniform3fv", "uniform4fv", "uniform1iv", "uniform2iv", "uniform3iv", "uniform4iv",
      "uniformMatrix2fv", "uniformMatrix3fv", "uniformMatrix4fv",
    ];

    for (const name of methods) {
      const original = prototype[name];
      if (typeof original !== "function" || this.#originalMethods.has(name)) continue;
      const callable = original as (...arguments_: unknown[]) => unknown;
      this.#originalMethods.set(name, callable);
      const profiler = this;
      prototype[name] = function(this: WebGL2RenderingContext, ...arguments_: unknown[]) {
        return profiler.#invoke(name, callable, this, arguments_);
      };
    }
  }

  #removeWrappers(): void {
    const prototype = WebGL2RenderingContext.prototype as unknown as Record<string, unknown>;
    for (const [name, original] of this.#originalMethods) prototype[name] = original;
    this.#originalMethods.clear();
  }

  #invoke(name: string, original: (...arguments_: unknown[]) => unknown, gl: WebGL2RenderingContext, arguments_: unknown[]): unknown {
    if (gl.canvas !== this.#canvas) return Reflect.apply(original, gl, arguments_);
    if (!this.#context) this.#attachContext(gl);

    const isDraw = name === "drawArrays" || name === "drawElements" || name === "drawRangeElements";
    const drawCountIndex = name === "drawArrays" ? 2 : name === "drawRangeElements" ? 3 : 1;
    const drawCount = isDraw ? Number(arguments_[drawCountIndex] ?? 0) : 0;
    const drawSignatureKey = isDraw ? [
      this.#currentRenderPhase,
      name,
      `mode:${Number(arguments_[0] ?? 0)}`,
      `count:${drawCount}`,
      `program:${this.#objectId(this.#currentProgram)}`,
      `texture0:${this.#objectId(this.#boundTextures.get(0))}`,
    ].join("/") : undefined;
    let drawGpuQuery: WebGLQuery | undefined;
    const timer = this.#timerExtension;
    if (this.#drawGpuQueriesEnabled && isDraw && drawSignatureKey && this.#capturingDetailedFrame && timer &&
      !this.#activeQuery && this.#drawGpuQueriesIssued < 256) {
      try {
        const query = gl.createQuery();
        if (query) {
          gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
          drawGpuQuery = query;
          this.#drawGpuQueriesIssued++;
        }
      } catch {
        drawGpuQuery = undefined;
      }
    } else if (this.#drawGpuQueriesEnabled && isDraw && this.#capturingDetailedFrame &&
      this.#drawGpuQueriesIssued >= 256) {
      this.#drawGpuProfileTruncated = true;
    }

    const timed = isDraw || name.includes("buffer") || name.includes("TexImage") ||
      name.startsWith("texImage") || name.startsWith("texSubImage") || name === "flush" || name === "finish" ||
      name === "readPixels" || name === "getBufferSubData" || name === "clientWaitSync" ||
      name === "compileShader" || name === "linkProgram" || name === "generateMipmap";
    const startedAt = timed ? performance.now() : 0;
    let result: unknown;
    try {
      result = Reflect.apply(original, gl, arguments_);
    } finally {
      if (drawGpuQuery && timer && drawSignatureKey) {
        try {
          gl.endQuery(timer.TIME_ELAPSED_EXT);
          this.#pendingDrawQueries.push({ query: drawGpuQuery, signature: drawSignatureKey });
        } catch {
          gl.deleteQuery(drawGpuQuery);
        }
      }
    }
    const elapsed = startedAt > 0 ? performance.now() - startedAt : 0;
    const phase = this.#phaseCounters.get(this.#currentRenderPhase) ?? emptyPhaseProfileCounters();
    this.#phaseCounters.set(this.#currentRenderPhase, phase);

    if (isDraw && drawSignatureKey) {
      const primitives = submittedPrimitives(Number(arguments_[0] ?? 0), drawCount);
      this.#counters.drawCalls++;
      const signature = this.#drawSignatures.get(drawSignatureKey) ?? { calls: 0, vertices: 0 };
      signature.calls++;
      signature.vertices += drawCount;
      this.#drawSignatures.set(drawSignatureKey, signature);
      this.#counters.submittedVertices += drawCount;
      this.#counters.submittedTriangles += primitives.triangles;
      this.#counters.submittedLines += primitives.lines;
      this.#counters.drawSubmitMs += elapsed;
      phase.drawCalls++;
      phase.vertices += drawCount;
      this.#counters.maxDrawSubmitMs = Math.max(this.#counters.maxDrawSubmitMs, elapsed);
      if (drawCount <= 6) this.#counters.drawCountLe6++;
      else if (drawCount <= 32) this.#counters.drawCountLe32++;
      else if (drawCount <= 128) this.#counters.drawCountLe128++;
      else if (drawCount <= 512) this.#counters.drawCountLe512++;
      else this.#counters.drawCountGt512++;
      if (name === "drawArrays") {
        this.#counters.drawArrays++;
        phase.drawArrays++;
      }
      else if (name === "drawElements") {
        this.#counters.drawElements++;
        phase.drawElements++;
      }
      else this.#counters.drawRangeElements++;
    } else if (name === "bufferData") {
      const bytes = profileBufferUploadByteLength(arguments_, 1, 3, 4);
      this.#counters.bufferDataCalls++;
      this.#counters.bufferDataBytes += bytes;
      this.#counters.bufferUploadMs += elapsed;
      phase.bufferDataCalls++;
      phase.bufferDataBytes += bytes;
    } else if (name === "bufferSubData") {
      const bytes = profileBufferUploadByteLength(arguments_, 2, 3, 4);
      this.#counters.bufferSubDataCalls++;
      this.#counters.bufferSubDataBytes += bytes;
      this.#counters.bufferUploadMs += elapsed;
      phase.bufferSubDataCalls++;
      phase.bufferSubDataBytes += bytes;
    } else if (name.includes("TexImage") || name.startsWith("texImage") || name.startsWith("texSubImage")) {
      this.#counters.textureUploadCalls++;
      this.#counters.textureUploadBytes += arguments_.reduce<number>(
        (total, value) => Math.max(total, profileByteLength(value)),
        0,
      );
      this.#counters.textureUploadMs += elapsed;
    } else if (name === "bindTexture") {
      this.#counters.textureBinds++;
      phase.textureBinds++;
      this.#boundTextures.set(this.#activeTextureUnit, arguments_[1]);
      if (arguments_[1]) this.#textures.add(arguments_[1]);
    }
    else if (name === "activeTexture") this.#activeTextureUnit = Number(arguments_[0] ?? gl.TEXTURE0) - gl.TEXTURE0;
    else if (name === "bindBuffer") {
      this.#counters.bufferBinds++;
      phase.bufferBinds++;
      if (arguments_[1]) this.#buffers.add(arguments_[1]);
      if (arguments_[0] === gl.ELEMENT_ARRAY_BUFFER) this.#counters.elementBufferBinds++;
    } else if (name === "bindFramebuffer") this.#counters.framebufferBinds++;
    else if (name === "useProgram") {
      this.#counters.programSwitches++;
      this.#currentProgram = arguments_[0];
      if (arguments_[0]) this.#programs.add(arguments_[0]);
    }
    else if (name.startsWith("uniform")) this.#counters.uniformCalls++;
    else if (name.includes("VertexAttrib") || name === "vertexAttribPointer") this.#counters.vertexAttribCalls++;
    else if (name === "clear") this.#counters.clearCalls++;
    else if (name === "readPixels" || name === "getBufferSubData" || name === "clientWaitSync") {
      this.#counters.synchronousReadCalls++;
      this.#counters.synchronousReadMs += elapsed;
    } else if (name === "compileShader") {
      this.#counters.shaderCompileCalls++;
      this.#counters.shaderCompileLinkMs += elapsed;
    } else if (name === "linkProgram") {
      this.#counters.programLinkCalls++;
      this.#counters.shaderCompileLinkMs += elapsed;
    } else if (name === "generateMipmap") {
      this.#counters.mipmapCalls++;
      this.#counters.mipmapMs += elapsed;
    }
    else if (name === "flush") {
      this.#counters.flushCalls++;
      this.#counters.flushFinishMs += elapsed;
    } else if (name === "finish") {
      this.#counters.finishCalls++;
      this.#counters.flushFinishMs += elapsed;
    } else {
      this.#counters.stateCalls++;
      phase.stateCalls++;
    }
    return result;
  }

  #objectId(value: unknown): number {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return 0;
    const object = value as object;
    const existing = this.#objectIds.get(object);
    if (existing !== undefined) return existing;
    const id = this.#nextObjectId++;
    this.#objectIds.set(object, id);
    return id;
  }

  #attachContext(gl: WebGL2RenderingContext): void {
    this.#context = gl;
    const timerExtension = gl.getExtension("EXT_disjoint_timer_query_webgl2") as
      DisjointTimerQueryExtension | null;
    this.#timerExtension = this.#gpuTimerQueriesEnabled ? timerExtension ?? undefined : undefined;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    console.info(`[CSJS PERF] ${JSON.stringify({
      type: "capabilities",
      profilerVersion: 5,
      timerQuery: Boolean(timerExtension),
      timerQueryActive: Boolean(this.#timerExtension),
      drawGpuQueriesActive: this.#drawGpuQueriesEnabled,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      version: gl.getParameter(gl.VERSION),
      shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxCombinedTextureUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
      contextAttributes: gl.getContextAttributes(),
      devicePixelRatio: window.devicePixelRatio,
      userAgent: navigator.userAgent,
    })}`);
  }

  #pollGpuQueries(): void {
    const gl = this.#context;
    const timer = this.#timerExtension;
    if (!gl || !timer) return;
    let disjoint = false;
    try {
      disjoint = Boolean(gl.getParameter(timer.GPU_DISJOINT_EXT));
    } catch {
      return;
    }
    if (disjoint) this.#gpuDisjointEvents++;
    while (this.#pendingQueries.length > 0) {
      const pending = this.#pendingQueries[0];
      if (!gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.#pendingQueries.shift();
      if (!disjoint) {
        this.#gpuFrameMs.push(Number(gl.getQueryParameter(pending.query, gl.QUERY_RESULT)) / 1_000_000);
        this.#gpuQueryLatencyMs.push(performance.now() - pending.endedAt);
        this.#gpuQueryLatencyFrames.push(this.#frameOrdinal - pending.frameOrdinal);
      }
      gl.deleteQuery(pending.query);
    }
    while (this.#pendingDrawQueries.length > 0) {
      const pending = this.#pendingDrawQueries[0];
      if (!gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.#pendingDrawQueries.shift();
      if (!disjoint) {
        const elapsedMs = Number(gl.getQueryParameter(pending.query, gl.QUERY_RESULT)) / 1_000_000;
        const timing = this.#drawGpuTimings.get(pending.signature) ?? {
          samples: 0,
          totalMs: 0,
          maxMs: 0,
        };
        timing.samples++;
        timing.totalMs += elapsedMs;
        timing.maxMs = Math.max(timing.maxMs, elapsedMs);
        this.#drawGpuTimings.set(pending.signature, timing);
      }
      gl.deleteQuery(pending.query);
    }
  }

  #report(now: number): void {
    this.#pollGpuQueries();
    const sampleMs = now - this.#reportStartedAt;
    const perFrame = (value: number) => Number((value / Math.max(1, this.#profiledFrames)).toFixed(2));
    const perSecond = (value: number) => Math.round(
      value * this.#drawnFrames / Math.max(1, this.#profiledFrames) * 1_000 / sampleMs,
    );
    const millisecondsPerSecond = (value: number) => Number((
      value * this.#drawnFrames / Math.max(1, this.#profiledFrames) * 1_000 / sampleMs
    ).toFixed(3));
    const round = (value: number) => Number(value.toFixed(3));
    const gl = this.#counters;
    const cadence = {
      over8_33ms: this.#frameIntervalsMs.filter((value) => value > 8.34).length,
      over16_67ms: this.#frameIntervalsMs.filter((value) => value > 16.68).length,
      over25ms: this.#frameIntervalsMs.filter((value) => value > 25).length,
    };
    const memory = performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    };
    console.info(`[CSJS PERF] ${JSON.stringify({
      type: "sample",
      profiler: {
        version: 5,
        gpuTimerQueries: this.#gpuTimerQueriesEnabled,
        drawGpuQueries: this.#drawGpuQueriesEnabled,
      },
      map: this.#latestEngineInfo?.map || "unknown",
      sampleMs: Math.round(sampleMs),
      rafCallbacks: this.#callbacks,
      rafFps: round(this.#callbacks * 1_000 / sampleMs),
      browserRafCallbacks: this.#browserRafCallbacks,
      browserRafFps: round(this.#browserRafCallbacks * 1_000 / sampleMs),
      engineFrames: this.#engineFrames,
      engineFps: round(this.#engineFrames * 1_000 / sampleMs),
      drawnFrames: this.#drawnFrames,
      detailedProfiledFrames: this.#profiledFrames,
      renderBisect: {
        enabled: this.#renderBisectEnabled,
        step: this.#renderBisectIndex,
        totalSteps: renderBisectModes.length,
        mode: renderBisectModes[this.#renderBisectIndex].label,
      },
      timingMs: {
        frameInterval: roundedDistribution(this.#frameIntervalsMs),
        engineCpu: roundedDistribution(this.#frameCpuMs),
        interFrameWait: roundedDistribution(this.#interFrameWaitMs),
        independentBrowserRaf: roundedDistribution(this.#browserRafIntervalsMs),
        mainThreadTimerDrift: roundedDistribution(this.#timerDriftMs),
        gpu: roundedDistribution(this.#gpuFrameMs),
        gpuQueryLatencyMs: roundedDistribution(this.#gpuQueryLatencyMs),
        gpuQueryLatencyFrames: roundedDistribution(this.#gpuQueryLatencyFrames),
        gpuSamples: this.#gpuFrameMs.length,
        pendingGpuQueries: this.#pendingQueries.length,
        oldestPendingGpuQueryMs: this.#pendingQueries.length > 0
          ? round(now - this.#pendingQueries[0].endedAt)
          : 0,
        gpuDisjointEvents: this.#gpuDisjointEvents,
        cadence,
        longTasks: {
          count: this.#longTaskCount,
          totalMs: round(this.#longTaskTotalMs),
          maxMs: round(this.#longTaskMaxMs),
        },
      },
      workloadPerDrawnFrame: {
        drawCalls: perFrame(gl.drawCalls), drawArrays: perFrame(gl.drawArrays),
        drawElements: perFrame(gl.drawElements), drawRangeElements: perFrame(gl.drawRangeElements),
        submittedVertices: perFrame(gl.submittedVertices), submittedTriangles: perFrame(gl.submittedTriangles),
        submittedLines: perFrame(gl.submittedLines), textureBinds: perFrame(gl.textureBinds),
        bufferBinds: perFrame(gl.bufferBinds), elementBufferBinds: perFrame(gl.elementBufferBinds),
        framebufferBinds: perFrame(gl.framebufferBinds), programSwitches: perFrame(gl.programSwitches),
        uniformCalls: perFrame(gl.uniformCalls), vertexAttribCalls: perFrame(gl.vertexAttribCalls),
        stateCalls: perFrame(gl.stateCalls), clearCalls: perFrame(gl.clearCalls),
        drawCountBuckets: {
          le6: perFrame(gl.drawCountLe6), le32: perFrame(gl.drawCountLe32),
          le128: perFrame(gl.drawCountLe128), le512: perFrame(gl.drawCountLe512),
          gt512: perFrame(gl.drawCountGt512),
        },
        uniquePrograms: this.#programs.size,
        uniqueTextures: this.#textures.size,
        uniqueBuffers: this.#buffers.size,
        topDrawSignatures: [...this.#drawSignatures.entries()]
          .sort((left, right) => right[1].calls - left[1].calls)
          .slice(0, 12)
          .map(([signature, totals]) => ({ signature, ...totals })),
      },
      renderSourceBreakdown: {
        renderPassesObserved: this.#renderPasses,
        renderPassesPerProfiledFrame: Number((
          this.#renderPasses / Math.max(1, this.#profiledFrames)
        ).toFixed(2)),
        phases: [...this.#phaseCounters.entries()]
          .filter(([, totals]) => totals.drawCalls > 0 || totals.bufferDataCalls > 0 || totals.bufferSubDataCalls > 0)
          .sort((left, right) =>
            (right[1].bufferDataBytes + right[1].bufferSubDataBytes + right[1].vertices) -
            (left[1].bufferDataBytes + left[1].bufferSubDataBytes + left[1].vertices))
          .map(([source, totals]) => ({ source, ...totals })),
      },
      uploadsPerSecond: {
        bufferDataCalls: perSecond(gl.bufferDataCalls), bufferDataBytes: perSecond(gl.bufferDataBytes),
        bufferSubDataCalls: perSecond(gl.bufferSubDataCalls), bufferSubDataBytes: perSecond(gl.bufferSubDataBytes),
        textureCalls: perSecond(gl.textureUploadCalls), textureBytesAtLeast: perSecond(gl.textureUploadBytes),
      },
      submissionCpuMs: {
        draws: millisecondsPerSecond(gl.drawSubmitMs), buffers: millisecondsPerSecond(gl.bufferUploadMs),
        textures: millisecondsPerSecond(gl.textureUploadMs), flushFinish: millisecondsPerSecond(gl.flushFinishMs),
        flushCalls: perSecond(gl.flushCalls), finishCalls: perSecond(gl.finishCalls),
        maxSingleDraw: round(gl.maxDrawSubmitMs), synchronousReads: round(gl.synchronousReadMs),
        synchronousReadCalls: perSecond(gl.synchronousReadCalls),
        shaderCompileLink: millisecondsPerSecond(gl.shaderCompileLinkMs),
        shaderCompileCalls: perSecond(gl.shaderCompileCalls), programLinkCalls: perSecond(gl.programLinkCalls),
        mipmaps: millisecondsPerSecond(gl.mipmapMs), mipmapCalls: perSecond(gl.mipmapCalls),
      },
      gpuDrawProfile: {
        queriesIssued: this.#drawGpuQueriesIssued,
        queriesResolved: [...this.#drawGpuTimings.values()]
          .reduce((total, timing) => total + timing.samples, 0),
        pendingQueries: this.#pendingDrawQueries.length,
        truncated: this.#drawGpuProfileTruncated,
        topSignatures: [...this.#drawGpuTimings.entries()]
          .sort((left, right) => right[1].totalMs - left[1].totalMs)
          .slice(0, 20)
          .map(([signature, timing]) => ({
            signature,
            calls: timing.samples,
            totalMs: round(timing.totalMs),
            avgMs: round(timing.totalMs / timing.samples),
            maxMs: round(timing.maxMs),
          })),
      },
      config: this.#latestEngineInfo,
      canvas: {
        backing: `${this.#canvas.width}x${this.#canvas.height}`,
        css: `${this.#canvas.clientWidth}x${this.#canvas.clientHeight}`,
        devicePixelRatio: window.devicePixelRatio,
      },
      page: { visibility: document.visibilityState, focused: document.hasFocus() },
      jsHeap: memory.memory ? {
        usedMB: round(memory.memory.usedJSHeapSize / 1_048_576),
        totalMB: round(memory.memory.totalJSHeapSize / 1_048_576),
        limitMB: round(memory.memory.jsHeapSizeLimit / 1_048_576),
      } : null,
    })}`);

    if (this.#renderBisectEnabled)
      this.#renderBisectIndex = (this.#renderBisectIndex + 1) % renderBisectModes.length;

    this.#reportStartedAt = now;
    this.#callbacks = 0;
    this.#browserRafCallbacks = 0;
    this.#drawnFrames = 0;
    this.#profiledFrames = 0;
    this.#engineFrames = 0;
    this.#frameCpuMs = [];
    this.#frameIntervalsMs = [];
    this.#interFrameWaitMs = [];
    this.#browserRafIntervalsMs = [];
    this.#timerDriftMs = [];
    this.#gpuFrameMs = [];
    this.#gpuQueryLatencyMs = [];
    this.#gpuQueryLatencyFrames = [];
    this.#gpuDisjointEvents = 0;
    this.#longTaskCount = 0;
    this.#longTaskTotalMs = 0;
    this.#longTaskMaxMs = 0;
    this.#programs.clear();
    this.#textures.clear();
    this.#buffers.clear();
    this.#drawSignatures.clear();
    this.#phaseCounters.clear();
    this.#renderPasses = 0;
    this.#drawGpuTimings.clear();
    this.#drawGpuQueriesIssued = 0;
    this.#drawGpuProfileTruncated = false;
    this.#counters = emptyGLProfileCounters();
    this.#captureNextDetailedFrame = true;
  }
}

function normalizeError(error: unknown): Error {
  const normalized = error instanceof Error ? error : new Error(String(error ?? "Unknown error"));
  if (!normalized.message.trim()) normalized.message = `${normalized.name}: no error details were provided by the browser.`;
  return normalized;
}

function browserUrl(value: string | URL): string {
  return value instanceof URL ? value.href : new URL(value, document.baseURI).href;
}

function renderProfilingEnabled(): boolean {
  const value = new URLSearchParams(window.location.search).get("perf")?.toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

function renderBisectEnabled(): boolean {
  const value = new URLSearchParams(window.location.search).get("perfBisect")?.toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

function drawGpuProfilingEnabled(): boolean {
  const value = new URLSearchParams(window.location.search).get("perfDraws")?.toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

function gpuTimerProfilingEnabled(): boolean {
  const value = new URLSearchParams(window.location.search).get("perfGpu")?.toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

const runtimeAssets = {
  engine: new URL("./runtime/xash.wasm", import.meta.url),
  filesystem: new URL("./runtime/filesystem_stdio.wasm", import.meta.url),
  renderer: new URL("./runtime/libref_gles3compat.wasm", import.meta.url),
  client: new URL("./runtime/client_emscripten_wasm32.wasm", import.meta.url),
  menu: new URL("./runtime/menu_emscripten_wasm32.wasm", import.meta.url),
} as const;

function safeValue(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f"\\;]/g, "");
}

const CONTROL_SETUP_MARKER = "/persist/cstrike/.csjs-controls";
const CS16_BINDINGS = "/rodir/cstrike/gfx/shell/kb_def.lst";
const ENGINE_FALLBACK_BINDINGS = new Map([
  ["ctrl", "+attack"],
  ["f1", "cmd help"],
  ["f2", "menu_savegame"],
  ["f5", "menu_creategame"],
  ["f10", "menu_main"],
  ["pgdn", "+lookup"],
  ["end", "centerview"],
]);

function readConfig(filesystem: CSFileSystem, path: string): string {
  try { return filesystem.readFile(path, { encoding: "utf8" }) ?? ""; }
  catch { return ""; }
}

function writeStartupConfig(filesystem: CSFileSystem): void {
  const commands = ["exec config.cfg"];
  if (!readConfig(filesystem, CONTROL_SETUP_MARKER)) {
    const defaults = readConfig(filesystem, CS16_BINDINGS);
    const saved = readConfig(filesystem, "/persist/cstrike/config.cfg");
    const configured = new Map<string, string>();
    for (const match of saved.matchAll(/^[ \t]*(bind|unbind)[ \t]+(?:"([^"]+)"|([^ \t\r\n]+))(?:[ \t]+(?:"([^"]*)"|([^\r\n]+)))?/gim)) {
      configured.set((match[2] ?? match[3]).toLowerCase(), match[1].toLowerCase() === "unbind"
        ? "" : (match[4] ?? match[5] ?? "").trim().toLowerCase());
    }

    // Repair stock Xash bindings left by the incomplete launcher profile.
    const incomplete = !configured.has("r") && !configured.has("e") && !configured.has("b");
    for (const match of defaults.matchAll(/^[ \t]*"([^"\r\n]+)"[ \t]+"([+a-z0-9_][+a-z0-9_ \t]*)"[ \t]*\r?$/gim)) {
      const key = match[1].replace(/\\\\/g, "\\");
      const normalized = key.toLowerCase();
      if (normalized === "escape" || /[\x00-\x1f\x7f]/.test(key)) continue;
      const existing = configured.get(normalized);
      if (existing !== undefined && !(incomplete && existing === ENGINE_FALLBACK_BINDINGS.get(normalized))) continue;
      commands.push(`bind "${key}" "${match[2]}"`);
    }
    if (commands.length > 1 || defaults) {
      filesystem.mkdirTree("/persist/cstrike");
      filesystem.writeFile(CONTROL_SETUP_MARKER, "1");
    }
  }
  // Xash runs saved settings before filling missing controls and processing +connect.
  filesystem.writeFile("/rodir/cstrike/cstrike.rc", [...commands, "stuffcmds", ""].join("\n"));
}

function randomQport(): number {
  const values = new Uint16Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return values[0] || 65_535;
  }

  // Web Crypto is available in supported browsers. Keep a fallback for
  // non-browser consumers that only use buildCSArguments in tooling.
  return Math.floor(Math.random() * 65_535) + 1;
}

export function buildCSArguments(options: Omit<CSClientOptions, "canvas">): string[] {
  const additionalArguments = options.additionalArguments ?? [];
  const arguments_ = [
    "-windowed",
    "-basedir", "/persist",
    "-rodir", "/rodir",
    "-game", "cstrike",
    "-ref", "gles3compat",
    "-noip6",
    ...(!additionalArguments.includes("-qport") ? ["-qport", String(randomQport())] : []),
    "+gl_overbright", "0",
    // Voice initialization opens the microphone even before push-to-talk.
    "+voice_enable", "0",
    "+name", safeValue(options.player?.name?.trim() || "Player"),
    "+_vgui_menus", "1",
    // Extended radio menus replace HUD text with touch-only buttons.
    "+_extended_menus", options.player?.touchControls ? "1" : "0",
  ];
  if (options.player?.touchControls) arguments_.push("+touch_enable", "1");
  arguments_.push(...additionalArguments);
  if (options.server) arguments_.push("+connect", safeValue(options.server.address ?? "127.0.0.1:27015"));
  return arguments_;
}

class DatagramBridge {
  readonly #incoming: Uint8Array[] = [];
  readonly #url: string;
  readonly #onConnectionChange?: (connected: boolean, error?: CSClientError) => void;
  #socket?: WebSocket;
  #connected = false;

  constructor(url: string | URL, onConnectionChange?: (connected: boolean, error?: CSClientError) => void) {
    this.#url = browserUrl(url);
    this.#onConnectionChange = onConnectionChange;
  }

  get connected(): boolean {
    return this.#connected;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    const attempts = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.#connectOnce(signal);
        return;
      } catch (error) {
        signal?.throwIfAborted();
        if (attempt === attempts) {
          throw new CSClientError("websocket_error", `${normalizeError(error).message} Failed after ${attempts} connection attempts.`);
        }
        await retryDelay(500 * attempt, signal);
      }
    }
  }

  #connectOnce(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const socket = new WebSocket(this.#url);
    socket.binaryType = "arraybuffer";
    this.#socket = socket;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        fail(new CSClientError("websocket_error", "The game server did not respond within 15 seconds."));
      }, 15_000);
      const stopWaiting = () => {
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      };
      const fail = (error: unknown) => {
        stopWaiting();
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        if (this.#socket === socket) this.#socket = undefined;
        socket.close();
        reject(error);
      };
      const abort = () => fail(signal?.reason);
      socket.onopen = () => {
        if (signal?.aborted) { abort(); return; }
        if (this.#socket !== socket) return;
        stopWaiting();
        this.#connected = true;
        this.#onConnectionChange?.(true);
        resolve();
      };
      socket.onmessage = (event) => {
        if (this.#socket === socket) this.#incoming.push(new Uint8Array(event.data as ArrayBuffer));
      };
      socket.onerror = () => {
        if (!this.#connected) fail(new CSClientError("websocket_error", "Unable to connect to the game server."));
      };
      socket.onclose = (event) => {
        if (this.#socket !== socket) return;
        const wasConnected = this.#connected;
        const error = new CSClientError(
          wasConnected ? "server_disconnected" : "websocket_error",
          `Game server WebSocket closed (code ${event.code}, ${event.wasClean ? "clean" : "unclean"} close)${event.reason ? `: ${event.reason}` : "."}`,
        );
        if (!wasConnected) { fail(error); return; }
        this.#socket = undefined;
        this.#connected = false;
        this.#onConnectionChange?.(false, error);
      };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  send(packet: Uint8Array): boolean {
    if (this.#socket?.readyState !== WebSocket.OPEN) return false;
    this.#socket.send(packet);
    return true;
  }

  receive(): Uint8Array | undefined {
    return this.#incoming.shift();
  }

  close(): void {
    this.#socket?.close();
    this.#socket = undefined;
    this.#incoming.length = 0;
    this.#connected = false;
    this.#onConnectionChange?.(false);
  }
}

async function fetchBuffer(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  return (await downloadBytes(url, { signal }, new URL(url, document.baseURI).pathname)).buffer;
}

async function loadFactory(): Promise<(options: XashModuleOptions) => Promise<XashModule>> {
  const runtime = await import("./runtime/xash.js");
  return runtime.default;
}

async function disposeRuntime(module: XashModule, persistent: boolean, assets?: GameAssets): Promise<void> {
  assets?.cancel();
  try {
    module.shutdown();
  } finally {
    try {
      await assets?.settled();
      if (persistent) await syncUserFileSystem(module);
    } finally {
      closePersistence(module);
    }
  }
}

export class CSClient {
  readonly canvas: HTMLCanvasElement;
  readonly filesystem: CSFileSystem;
  readonly persistent: boolean;
  readonly #bridge?: DatagramBridge;
  readonly #previousAlert: typeof window.alert;
  readonly #runtime: XashModule;
  readonly #profiler?: CSJSRenderProfiler;
  readonly #assets?: GameAssets;
  readonly #onStop?: () => void;
  readonly #pageHideHandler: () => void;
  readonly #visibilityChangeHandler: () => void;
  readonly #configFlushTimer?: number;
  #disconnectRequested = false;
  #disposePromise?: Promise<void>;
  #disposed = false;
  #engineStopped = false;

  constructor(
    module: XashModule,
    canvas: HTMLCanvasElement,
    bridge: DatagramBridge | undefined,
    previousAlert: typeof window.alert,
    persistent: boolean,
    profiler?: CSJSRenderProfiler,
    assets?: GameAssets,
    onStop?: () => void,
  ) {
    this.#runtime = module;
    this.canvas = canvas;
    this.filesystem = module.FS;
    this.#bridge = bridge;
    this.#previousAlert = previousAlert;
    this.persistent = persistent;
    this.#profiler = profiler;
    this.#assets = assets;
    this.#onStop = onStop;
    this.#pageHideHandler = () => {
      this.#onStop?.();
      this.#writeConfigs();
      if (this.persistent) void syncUserFileSystem(this.#runtime).catch((error) => console.warn("Could not save game settings:", error));
      this.#disconnectTransport();
    };
    this.#visibilityChangeHandler = () => {
      if (document.visibilityState === "hidden") this.#syncInBackground();
    };
    window.addEventListener("pagehide", this.#pageHideHandler);
    document.addEventListener("visibilitychange", this.#visibilityChangeHandler);
    if (persistent) {
      this.#configFlushTimer = window.setInterval(() => this.#syncInBackground(), 10_000);
    }
  }

  get connected(): boolean {
    return !this.#disposed && (this.#bridge?.connected ?? false);
  }

  get disconnected(): boolean {
    return this.#disposed || !this.#bridge?.connected;
  }

  get wantsPointerLock(): boolean {
    return !this.#disposed && !this.#engineStopped && Boolean(this.#runtime._CSJS_WantsPointerLock?.() ?? true);
  }

  async sync(): Promise<void> {
    if (this.persistent && !this.#disposed && !this.#engineStopped) {
      this.#writeConfigs();
      await syncUserFileSystem(this.#runtime);
    }
  }

  /** Native shutdown can also originate in the game's own menu or console. */
  engineStopped(): void {
    this.#engineStopped = true;
    this.#assets?.cancel();
    if (this.#configFlushTimer !== undefined) window.clearInterval(this.#configFlushTimer);
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#onStop?.();
    this.#writeConfigs();
    this.#disposed = true;
    this.#disconnectTransport();
    window.removeEventListener("pagehide", this.#pageHideHandler);
    document.removeEventListener("visibilitychange", this.#visibilityChangeHandler);
    if (this.#configFlushTimer !== undefined) window.clearInterval(this.#configFlushTimer);
    this.#profiler?.dispose();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.#disposePromise = (async () => {
      try {
        await disposeRuntime(this.#runtime, this.persistent, this.#assets);
      } finally {
        window.alert = this.#previousAlert;
        if (globalThis.__csjsNetwork === this.#bridge) globalThis.__csjsNetwork = undefined;
        if (globalThis.__csjsRenderProfiler === this.#profiler) globalThis.__csjsRenderProfiler = undefined;
      }
    })();
    return this.#disposePromise;
  }

  #syncInBackground(): void {
    void this.sync().catch((error) => console.warn("Could not save game settings:", error));
  }

  #writeConfigs(): void {
    if (this.#engineStopped) return;
    try {
      this.#runtime._Host_WriteConfig();
      this.#runtime._Host_WriteOpenGLConfig();
      this.#runtime._Host_WriteVideoConfig();
    } catch (error) {
      console.warn("Could not write the Counter-Strike configuration files:", error);
    }
  }

  #disconnectTransport(): void {
    if (this.#disconnectRequested) return;
    this.#disconnectRequested = true;
    try {
      // GoldSrc disconnects are sequenced netchannel messages. Let Xash build
      // and send the packet while the WebSocket bridge is still available.
      if (!this.#engineStopped) this.#runtime._CL_Disconnect();
    } catch (error) {
      console.warn("Could not send the Counter-Strike disconnect packet:", error);
    } finally {
      this.#bridge?.close();
    }
  }

  close(): void {
    void this.dispose();
  }
}

export async function createCSClient(options: CSClientOptions): Promise<CSClient> {
  const report = (progress: CSClientProgress): void => options.onProgress?.(progress);
  let failureReported = false;
  let playable = false;
  let stopping = false;
  let nativeStopped = false;
  const reportError = (error: unknown): void => {
    if (failureReported || stopping || options.signal?.aborted) return;
    failureReported = true;
    options.onError?.(normalizeError(error));
  };
  const previousAlert = window.alert;
  window.alert = (message?: unknown) => console.error(`[xash alert] ${String(message ?? "Unknown engine error")}`);
  const bridge = options.server
    ? new DatagramBridge(options.server.websocketUrl, (connected, error) => {
      options.onConnectionChange?.(connected);
      if (!connected) {
        // Let a rejected connect promise report its more specific error first.
        queueMicrotask(() => reportError(error ?? new CSClientError("server_disconnected", playable ? "Game engine disconnected from the server." : "Game engine disconnected before the game became playable.")));
      }
    })
    : undefined;
  if (bridge) globalThis.__csjsNetwork = bridge;
  let profiler: CSJSRenderProfiler | undefined;
  let module: XashModule | undefined;
  const browserConsole = createBrowserConsole(options.canvas, (action, text) =>
    module?.ccall("CSJS_ConsoleEdit", "string", ["string", "string"], [action, text]) ?? text,
  );
  let csClient: CSClient | undefined;
  const browserMenu = createBrowserMenu(options.canvas, {
    filesystem: () => module?.FS,
    action: action => { module?.ccall("CSJS_MenuAction", "string", ["string"], [action]); },
    setting: (name, value = "") =>
      module?.ccall("CSJS_MenuSetting", "string", ["string", "string"], [name, value]) ?? "",
    binding: (action, command, key = "") =>
      module?.ccall("CSJS_MenuBinding", "string", ["string", "string", "string"], [action, command, key]) ?? "",
    save: () => csClient?.sync() ?? Promise.resolve(),
  }, options.player?.touchControls ?? false);
  const disposeBrowserUI = () => {
    browserMenu.dispose();
    browserConsole.dispose();
  };
  let assets: GameAssets | undefined;
  const cancelAssets = () => assets?.cancel();
  options.signal?.addEventListener("abort", cancelAssets, { once: true });

  try {
    report({ phase: "loading-engine", loadedBytes: 0, totalBytes: 0 });
    options.signal?.throwIfAborted();
    const [factory, engine, filesystem, renderer, client, menu] = await Promise.all([
      loadFactory(),
      fetchBuffer(runtimeAssets.engine.href, options.signal),
      fetchBuffer(runtimeAssets.filesystem.href, options.signal),
      fetchBuffer(runtimeAssets.renderer.href, options.signal),
      fetchBuffer(runtimeAssets.client.href, options.signal),
      fetchBuffer(runtimeAssets.menu.href, options.signal),
    ]);

    options.signal?.throwIfAborted();
    module = await factory({
      canvas: options.canvas,
      noInitialRun: true,
      wasmBinary: engine,
      onConsoleVisibility: visible => {
        const handled = browserConsole.show(visible);
        if (handled) browserMenu.consoleVisibility(visible);
        return handled;
      },
      onMenuVisibility: (visible, inGame) => options.server && !playable && visible
        ? true : browserMenu.show(visible, inGame),
      onConsoleOutput: browserConsole.append,
      onGamePlayable: () => {
        if (playable || failureReported || stopping || options.signal?.aborted) return;
        playable = true;
        options.onPlayable?.();
      },
      onEngineError: (message) => reportError(new CSClientError("engine_error", message)),
      onEngineShutdown: () => {
        const voluntaryExit = !stopping && !failureReported;
        nativeStopped = stopping = true;
        disposeBrowserUI();
        assets?.cancel();
        csClient?.engineStopped();
        queueMicrotask(() => bridge?.close());
        if (voluntaryExit) options.onExit?.();
      },
      onServerReject: (message) => reportError(new CSClientError("server_rejected", message)),
      onAbort: (reason) => reportError(new CSClientError("engine_aborted", String(reason))),
      onClientDisconnect: (reason, voluntary) => {
        if (voluntary && !stopping && !failureReported) {
          stopping = true;
          options.onExit?.();
        }
        if (reason) reportError(new CSClientError("server_disconnected", reason));
        assets?.cancel();
        // Native disconnect still has to send its final packet after this callback returns.
        queueMicrotask(() => bridge?.close());
      },
      print: (line: string) => {
        if (options.onConsole) options.onConsole("info", line);
        else console.info(`[xash] ${line}`);
      },
      printErr: (line: string) => {
        if (options.onConsole) options.onConsole("error", line);
        else console.error(`[xash] ${line}`);
      },
    });

    report({ phase: "preparing-filesystem", loadedBytes: 0, totalBytes: 0 });
    const persistent = await preparePersistence(module, options);
    let cacheWritable = persistent;
    const persistAssets = async () => {
      if (!cacheWritable) return;
      try { await syncFileSystem(module!, false); }
      catch (error) {
        cacheWritable = false;
        options.onConsole?.("error", `Game files could not be cached (${normalizeError(error).message}); continuing with game files in memory.`);
      }
    };
    assets = new GameAssets(
      module.FS,
      browserUrl(options.runtime?.assetArchiveUrl ?? "/valve.zip?v=2"),
      report,
      persistAssets,
    );
    options.signal?.throwIfAborted();
    await assets.ensure();

    writeStartupConfig(module.FS);
    module.FS.writeFile("/rodir/filesystem_stdio.so", new Uint8Array(filesystem));
    module.FS.writeFile("/rodir/libref_gles3compat.so", new Uint8Array(renderer));
    module.FS.mkdirTree("/rodir/cstrike/cl_dlls");
    module.FS.mkdirTree("/rodir/cstrike/dlls");
    module.FS.writeFile("/rodir/cstrike/cl_dlls/client_emscripten_wasm32.so", new Uint8Array(client));
    module.FS.writeFile("/rodir/cstrike/cl_dlls/menu_emscripten_wasm32.so", new Uint8Array(menu));
    // Compile off the main thread before native dlopen synchronously instantiates the libraries.
    await module.precompileLibraries([
      "/rodir/filesystem_stdio.so", "/rodir/libref_gles3compat.so",
      "/rodir/cstrike/cl_dlls/client_emscripten_wasm32.so", "/rodir/cstrike/cl_dlls/menu_emscripten_wasm32.so",
    ]);
    options.signal?.throwIfAborted();
    module.FS.chdir("/rodir");

    // Downloads and persistence can exceed the server's idle WebSocket timeout.
    if (bridge) {
      report({ phase: "connecting", loadedBytes: 0, totalBytes: 0 });
      await bridge.connect(options.signal);
      options.signal?.throwIfAborted();
    }
    report({ phase: "starting", loadedBytes: 0, totalBytes: 0 });
    if (renderProfilingEnabled()) {
      profiler = new CSJSRenderProfiler(options.canvas);
      globalThis.__csjsRenderProfiler = profiler;
    }
    module.callMain(buildCSArguments(options));
    csClient = new CSClient(module, options.canvas, bridge, previousAlert, persistent, profiler, assets, () => {
      stopping = true;
      disposeBrowserUI();
    });
    if (nativeStopped) { csClient.engineStopped(); return csClient; }
    report({ phase: "ready", loadedBytes: 0, totalBytes: 0 });
    options.onReady?.(csClient);
    return csClient;
  } catch (error) {
    reportError(error);
    stopping = true;
    disposeBrowserUI();
    try {
      if (csClient) await csClient.dispose();
      else if (module) await disposeRuntime(module, false, assets);
    } catch (cleanupError) {
      console.warn("Could not finish cleaning up the Counter-Strike runtime:", cleanupError);
    }
    bridge?.close();
    if (!csClient) profiler?.dispose();
    window.alert = previousAlert;
    if (globalThis.__csjsNetwork === bridge) globalThis.__csjsNetwork = undefined;
    if (globalThis.__csjsRenderProfiler === profiler) globalThis.__csjsRenderProfiler = undefined;
    const normalized = normalizeError(error);
    throw normalized;
  } finally {
    options.signal?.removeEventListener("abort", cancelAssets);
  }
}
