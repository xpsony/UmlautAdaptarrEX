"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/app/_lib/api-client";
import type { LogItem } from "./log-format";

const HISTORY_TAKE = 1000;

// Owns the live log buffer: loads persisted history, opens a WebSocket to
// /ws/logs, and prepends incoming batches up to a 1000-item ring buffer.
// Pause-state lives behind a ref so flipping it doesn't tear down the socket.
export function useLogStream(apiPort: number) {
  const [items, setItems] = useState<LogItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [dropped, setDropped] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Load persisted logs once (within retention) so past errors are visible,
  // not only what arrives after the page mounts.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: LogItem[] }>(`/api/admin/logs?take=${HISTORY_TAKE}`)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
      })
      .catch(() => {
        /* A DB read error is not fatal, the WS stream keeps delivering live data. */
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    // Default architecture exposes Fastify alongside Next (see start.mjs), so
    // the browser opens a cross-origin WS to the same hostname on the resolved
    // legacy-API port. For reverse-proxy setups that fold everything onto a
    // single origin, set NEXT_PUBLIC_API_HOST to the public host (e.g.
    // "umlautadaptarr.example.com") and route /ws/logs through to Fastify.
    const apiHost = process.env.NEXT_PUBLIC_API_HOST ?? `${location.hostname}:${apiPort}`;
    const url = `${proto}//${apiHost}/ws/logs`;
    const ws = new WebSocket(url);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      if (pausedRef.current) return;
      try {
        const data = JSON.parse(ev.data) as {
          items: LogItem[];
          dropped?: number;
        };
        if (data.dropped) setDropped((d) => d + data.dropped!);
        setItems((prev) => [...data.items, ...prev].slice(0, HISTORY_TAKE));
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [apiPort]);

  function clear(): void {
    setItems([]);
    setDropped(0);
  }

  return {
    items,
    paused,
    setPaused,
    connected,
    dropped,
    loadingHistory,
    clear,
  };
}
