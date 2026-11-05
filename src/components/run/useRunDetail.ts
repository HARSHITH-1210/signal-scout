"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TERMINAL_STATUSES, type RunDetail } from "@/lib/types";

/**
 * Keeps a run's detail in sync. While the run is active it listens to the SSE stream (which replays
 * persisted events, so refreshes are safe) and refetches the full detail after each event.
 */
export function useRunDetail(initial: RunDetail) {
  const [detail, setDetail] = useState(initial);
  const [connection, setConnection] = useState<"live" | "reconnecting" | "idle">("idle");
  const [streamKey, setStreamKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/runs/${initial.id}`, { cache: "no-store" });
    if (res.ok) setDetail(await res.json());
  }, [initial.id]);

  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), 250);
  }, [refresh]);

  const isActive = !TERMINAL_STATUSES.includes(detail.status);

  useEffect(() => {
    if (!isActive) return;
    const source = new EventSource(`/api/runs/${initial.id}/events`);
    source.onopen = () => setConnection("live");
    source.addEventListener("stage", scheduleRefresh);
    source.addEventListener("status", scheduleRefresh);
    source.addEventListener("done", () => {
      source.close();
      setConnection("idle");
      void refresh();
    });
    source.onerror = () => setConnection("reconnecting"); // EventSource retries automatically
    return () => {
      source.close();
      setConnection("idle");
    };
  }, [initial.id, isActive, streamKey, refresh, scheduleRefresh]);

  /** Call after an action that restarts the pipeline (clarify, regenerate, role-based). */
  const resume = useCallback(async () => {
    await refresh();
    setStreamKey((k) => k + 1);
  }, [refresh]);

  return { detail, refresh, resume, connection, isActive };
}
