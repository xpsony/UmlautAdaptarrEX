"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/app/_lib/api-client";
import type { LogItem } from "./log-format";

const HISTORY_TAKE = 1000;

// LogItem decorated with a client-assigned monotonic id. The server payload is
// untouched; the id only exists to give React a stable, unique key on this
// prepend-only list (array indices shift as new batches arrive).
export type StreamLogItem = LogItem & { seq: number };

// Owns the live log buffer: loads persisted history, opens a WebSocket to
// /ws/logs, and prepends incoming batches up to a 1000-item ring buffer.
// Pause-state lives behind a ref so flipping it doesn't tear down the socket.
export function useLogStream(apiPort: number) {
  const [items, setItems] = useState<StreamLogItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [dropped, setDropped] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Monotonic counter for client-side keys. Each ingested item gets the next
  // value; never reused, so keys stay stable across prepends and re-renders.
  const seqRef = useRef(0);
  const tag = (batch: LogItem[]): StreamLogItem[] =>
    batch.map((it) => ({ ...it, seq: seqRef.current++ }));

  // Load persisted logs once (within retention) so past errors are visible,
  // not only what arrives after the page mounts.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: LogItem[] }>(`/api/admin/logs?take=${HISTORY_TAKE}`)
      .then((data) => {
        if (cancelled) return;
        setItems(tag(data.items));
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

    let ws: WebSocket | null = null;
    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // A dropped connection (server restart, sleeping laptop, flaky reverse
    // proxy) used to leave the page on a dead stream until a full reload.
    // Reconnect with exponential backoff: 1s, 2s, 4s, ... capped at 30s,
    // reset once a connection sticks.
    const scheduleReconnect = (): void => {
      if (disposed || timer) return;
      const delay = Math.min(1_000 * 2 ** attempt, 30_000);
      attempt += 1;
      setReconnecting(true);
      timer = setTimeout(() => {
        timer = null;
        if (!disposed) connect();
      }, delay);
    };

    const connect = (): void => {
      ws = new WebSocket(url);
      ws.onopen = () => {
        attempt = 0;
        setReconnecting(false);
        setConnected(true);
      };
      ws.onclose = () => {
        setConnected(false);
        scheduleReconnect();
      };
      // onerror is always followed by onclose; reconnect only in onclose so
      // a single failure doesn't schedule twice.
      ws.onerror = () => setConnected(false);
      ws.onmessage = (ev) => {
        if (pausedRef.current) return;
        try {
          const data = JSON.parse(ev.data) as {
            items: LogItem[];
            dropped?: number;
          };
          if (data.dropped) setDropped((d) => d + data.dropped!);
          setItems((prev) => [...tag(data.items), ...prev].slice(0, HISTORY_TAKE));
        } catch {
          /* ignore */
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
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
    reconnecting,
    dropped,
    loadingHistory,
    clear,
  };
}
