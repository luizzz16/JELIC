/** Textos y tono de los eventos del firmware (compartido por el panel en vivo y el historial). */
export type Tone = "ok" | "warn" | "bad" | "info" | "idle";
export const EVENT_TEXT: Record<string, { title: string; tone: Tone }> = {
  presence_detected: { title: "Persona detectada en el exterior", tone: "info" },
  presence_cleared: { title: "Ya no hay presencia", tone: "idle" },
  door_open: { title: "Puerta abierta", tone: "warn" },
  door_closed: { title: "Puerta cerrada", tone: "ok" },
  vibration: { title: "Golpe fuerte en la puerta", tone: "warn" },
  door_forced: { title: "Puerta forzada", tone: "bad" },
  tamper_vibration: { title: "Forcejeo en la puerta", tone: "bad" },
  lock_rejected: { title: "Cierre rechazado: puerta abierta", tone: "warn" },
  alarm_test: { title: "Prueba de alarma", tone: "info" },
  alarm_silenced: { title: "Alarma silenciada", tone: "idle" },
  latch_locking: { title: "Cerrando…", tone: "idle" },
  latch_unlocking: { title: "Abriendo…", tone: "idle" },
  latch_confirmed: { title: "Movimiento confirmado", tone: "ok" },
  device_online: { title: "Dispositivo conectado", tone: "ok" },
  cmd_rejected: { title: "Comando rechazado", tone: "warn" },
};
