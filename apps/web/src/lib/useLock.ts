"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceEvent, DeviceStatus, LockCommand, ServerMessage } from "@jelic/shared";

export type Link = "connecting" | "live" | "broker-down" | "offline";
export type LogItem = DeviceEvent & { id: string };

const MAX = 100;
const wsUrl = () =>
  process.env.NEXT_PUBLIC_WS_URL ||
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export function useLock() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [online, setOnline] = useState(false);
  const [link, setLink] = useState<Link>("connecting");
  const [log, setLog] = useState<LogItem[]>([]);
  const wsRef = useRef<WebSocket | undefined>(undefined);

  useEffect(() => {
    let ws: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let closed = false;
    let seq = 0;
    const item = (e: DeviceEvent): LogItem => ({ ...e, id: `e${seq++}` });
    const push = (i: LogItem) => setLog((l) => [i, ...l].slice(0, MAX));

    const connect = () => {
      ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data) as ServerMessage;
        if (m.kind === "snapshot") {
          setLog([...m.events].reverse().map(item));
          setStatus(m.status);
          setOnline(m.online);
          setLink(m.broker ? "live" : "broker-down");
        } else if (m.kind === "status") setStatus(m.status);
        else if (m.kind === "online") setOnline(m.online);
        else if (m.kind === "event") push(item(m.event));
        else setLink(m.connected ? "live" : "broker-down");
      };
      ws.onclose = () => {
        if (closed) return;
        setLink("offline");
        timer = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      // Closing a still-connecting socket logs a browser warning (React StrictMode double-mount): wait for open.
      if (ws?.readyState === WebSocket.CONNECTING) ws.onopen = () => ws?.close();
      else ws?.close();
    };
  }, []);

  const sendCommand = useCallback((action: LockCommand) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ kind: "command", action }));
    return true;
  }, []);

  return { status, online, link, log, sendCommand };
}
