"use client";
import { useEffect, useState } from "react";
import type { LockCommand } from "@jelic/shared";
import { useLock, type Link, type LogItem } from "../lib/useLock";

const LINK_LABEL: Record<Link, string> = {
  connecting: "conectando…",
  live: "en vivo",
  "broker-down": "broker caído",
  offline: "sin servidor",
};

function Padlock({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="12" y="28" width="40" height="28" rx="7" fill="currentColor" fillOpacity=".12" />
      <path d={open ? "M22 28V20a10 10 0 0 1 19-4" : "M22 28V20a10 10 0 0 1 20 0v8"} />
      <circle cx="32" cy="42" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

const EVENT_TEXT: Record<string, { title: string; tone: string }> = {
  presence_detected: { title: "Persona detectada", tone: "info" },
  presence_cleared: { title: "Ya no hay presencia", tone: "idle" },
  door_open: { title: "Puerta abierta", tone: "warn" },
  door_closed: { title: "Puerta cerrada", tone: "ok" },
  vibration: { title: "Vibración fuerte", tone: "warn" },
  door_forced: { title: "Puerta forzada", tone: "bad" },
  tamper_vibration: { title: "Forcejeo detectado", tone: "bad" },
  lock_rejected: { title: "Cierre rechazado: puerta abierta", tone: "warn" },
  alarm_test: { title: "Prueba de alarma", tone: "info" },
  alarm_silenced: { title: "Alarma silenciada", tone: "idle" },
  latch_locking: { title: "Cerrando pestillo…", tone: "idle" },
  latch_unlocking: { title: "Abriendo pestillo…", tone: "idle" },
  latch_confirmed: { title: "Pestillo confirmado", tone: "ok" },
  device_online: { title: "Dispositivo conectado", tone: "ok" },
  cmd_rejected: { title: "Comando rechazado", tone: "warn" },
};

/** Firmware answers a LOCK/UNLOCK with one of these once the servo finished (or refused). */
const DONE = new Set(["latch_confirmed", "lock_rejected", "cmd_rejected"]);
const MOVE_TIMEOUT_MS = 5000;

const FEEDBACK = new Set(["latch_locking", "latch_unlocking", "latch_confirmed", "lock_rejected", "cmd_rejected"]);

function describe(i: LogItem): { title: string; tone: string } {
  return EVENT_TEXT[i.type] ?? { title: i.type, tone: i.channel === "alert" ? "bad" : "info" };
}

export default function Page() {
  const { status, online, link, log, sendCommand } = useLock();
  const canSend = link === "live" && online;
  const unlocked = status?.latch === "unlocked";
  const tone = !status ? "idle" : status.alarm ? "bad" : unlocked ? "warn" : "ok";
  const feedback = log.map((i) => ({ ...describe(i), type: i.type, ts: i.ts })).find((i) => FEEDBACK.has(i.type));
  const alerts = log.filter((l) => l.channel === "alert").length;

  // Servo moves ~1 s (smooth sweep): show "moving" until the device confirms, with a timeout fallback.
  const doneCount = log.filter((l) => DONE.has(l.type)).length;
  const [pending, setPending] = useState<{ action: LockCommand; done: number } | null>(null);
  const moving = pending && doneCount === pending.done ? pending.action : null;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), MOVE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pending]);
  const move = (action: "LOCK" | "UNLOCK") => {
    if (sendCommand(action)) setPending({ action, done: doneCount });
  };

  return (
    <main>
      <header>
        <h1>Jelic</h1>
        <span className={`pill ${link}`}><i />{LINK_LABEL[link]}</span>
      </header>

      <section className={`hero ${tone}`}>
        <div className="ring"><Padlock open={unlocked} /></div>
        <strong>{!status ? "Sin datos" : status.alarm ? "¡Alarma!" : unlocked ? "Abierto" : "Cerrado"}</strong>
        <small className="sub">{online ? "Dispositivo en línea" : "Dispositivo sin conexión"}</small>
      </section>

      <div className="actions">
        <button className="open" disabled={!canSend || !!moving} onClick={() => move("UNLOCK")}>{moving === "UNLOCK" ? "Abriendo…" : "Abrir"}</button>
        <button className="close" disabled={!canSend || !!moving} onClick={() => move("LOCK")}>{moving === "LOCK" ? "Cerrando…" : "Cerrar"}</button>
        {status?.alarm && (
          <button className="silence" disabled={!canSend} onClick={() => sendCommand("SILENCE")}>Silenciar alarma</button>
        )}
      </div>

      {feedback && <p className={`feedback ${feedback.tone}`}>{feedback.title} <time>{new Date(feedback.ts).toLocaleTimeString()}</time></p>}

      <div className="stats">
        <div><b>{status ? (status.door === "open" ? "Abierta" : "Cerrada") : "—"}</b><span>puerta</span></div>
        <div><b>{status ? (status.presence ? "Sí" : "No") : "—"}</b><span>presencia</span></div>
        <div className={alerts ? "danger" : ""}><b>{alerts}</b><span>alertas</span></div>
        <div><b>{status ? `${status.rssi} dBm` : "—"}</b><span>Wi-Fi · SD {status?.sd ? "ok" : "no"}</span></div>
      </div>

      <section>
        <h2>Actividad</h2>
        {log.length === 0 ? (
          <p className="empty">Esperando eventos del dispositivo…</p>
        ) : (
          <ul>
            {log.map((i) => {
              const d = describe(i);
              return (
                <li key={i.id} className={d.tone}>
                  <i />
                  <span>{d.title}</span>
                  <time>{new Date(i.ts).toLocaleTimeString()}</time>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
