"use client";

import type { CSClient } from "@csjs/client";
import { useEffect, useRef, useState } from "react";

const SERVER_URL = process.env.NEXT_PUBLIC_CSJS_SERVER_URL || "ws://localhost:27016/ws";
let sessionQueue: Promise<void> = Promise.resolve();

export function Game({ playerName }: { playerName: string }) {
  const viewport = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const client = useRef<CSClient>(null);
  const [playing, setPlaying] = useState(false);
  const [mouseCaptured, setMouseCaptured] = useState(false);
  const [canEnterFullscreen, setCanEnterFullscreen] = useState(false);
  const [status, setStatus] = useState("Starting game…");

  useEffect(() => {
    const updateFullscreen = () => setCanEnterFullscreen(document.fullscreenEnabled && !document.fullscreenElement);
    updateFullscreen();
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const controller = new AbortController();
    const { signal } = controller;
    const updateMouseCapture = () => setMouseCaptured(document.pointerLockElement === target);
    const stop = (message: string) => {
      if (signal.aborted) return;
      controller.abort();
      setPlaying(false);
      setStatus(message);
      void client.current?.dispose().catch(console.error);
    };
    document.addEventListener("pointerlockchange", updateMouseCapture);
    sessionQueue = sessionQueue.catch(console.error).then(async () => {
      if (signal.aborted) return;
      try {
        const endpoint = new URL(SERVER_URL);
        if (!["ws:", "wss:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) {
          throw new Error("Invalid game server URL.");
        }
        if (location.protocol === "https:" && endpoint.protocol !== "wss:") {
          throw new Error("An HTTPS page needs a wss:// game server.");
        }
        const { createCSClient } = await import("@csjs/client");
        const launchedClient = await createCSClient({
          canvas: target,
          signal,
          server: { websocketUrl: endpoint.href },
          player: { name: playerName, touchControls: false },
          onProgress: ({ phase, loadedBytes, totalBytes }) => {
            if (signal.aborted) return;
            if (phase === "loading-assets") setStatus("Downloading valve.zip…");
            if (phase === "preparing-filesystem" && totalBytes > 0) {
              setStatus(`Extracting valve.zip… ${Math.floor(loadedBytes / totalBytes * 100)}%`);
            }
            if (phase === "ready") setStatus("Entering game…");
          },
          onPlayable: () => {
            if (signal.aborted) return;
            setPlaying(true);
            setStatus("");
            target.focus({ preventScroll: true });
          },
          onError: (error) => stop(error.message),
          onExit: () => stop("Disconnected."),
        });
        if (signal.aborted) await launchedClient.dispose();
        else client.current = launchedClient;
      } catch (error) {
        stop(error instanceof Error ? error.message : "Could not start the game.");
      }
    });

    return () => {
      controller.abort();
      document.removeEventListener("pointerlockchange", updateMouseCapture);
      if (document.pointerLockElement === target) document.exitPointerLock();
      const launchedClient = client.current;
      client.current = null;
      sessionQueue = sessionQueue.catch(console.error).then(() => launchedClient?.dispose());
    };
  }, [playerName]);

  function captureMouse() {
    const target = canvas.current;
    if (!playing || !target) return;
    target.focus({ preventScroll: true });
    if (client.current?.wantsPointerLock === false) return;
    void target.requestPointerLock?.()?.catch(() => undefined);
  }

  return (
    <main ref={viewport} className="game-page">
      <canvas id="canvas" ref={canvas} tabIndex={0} onClick={captureMouse} aria-label="Counter-Strike game" />
      {!mouseCaptured && (status || canEnterFullscreen) && <div className="game-controls">
        {status && <p role="status">{status}</p>}
        {canEnterFullscreen && (
          <button
            type="button"
            aria-label="Enter fullscreen"
            title="Enter fullscreen"
            onClick={() => {
              void viewport.current?.requestFullscreen().then(() => canvas.current?.focus()).catch(console.warn);
            }}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" />
            </svg>
          </button>
        )}
      </div>}
    </main>
  );
}
