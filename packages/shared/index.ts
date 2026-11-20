/** Mirrors the ESP32 firmware (smartlock/<id>/status JSON). */
export interface DeviceStatus {
  device: string;
  door: "open" | "closed";
  latch: "locked" | "unlocked";
  presence: boolean;
  alarm: boolean;
  rssi: number;
  sd: boolean;
  ts: string;
}

/** smartlock/<id>/event (info) and smartlock/<id>/alert (alarms). */
export interface DeviceEvent {
  channel: "event" | "alert";
  type: string; // presence_detected, door_open, vibration, door_forced, tamper_vibration, ...
  detail: string;
  ts: number; // server receive time (ms)
}

/** Commands the firmware understands on smartlock/<id>/cmd. */
export type LockCommand = "LOCK" | "UNLOCK" | "SILENCE" | "ALARM_TEST" | "STATUS";
export const COMMANDS: readonly LockCommand[] = ["LOCK", "UNLOCK", "SILENCE", "ALARM_TEST", "STATUS"];

/** Messages sent from web to backend over WebSocket. */
export type ClientMessage = { kind: "command"; action: LockCommand };

/** Messages sent from backend to web over WebSocket. */
export type ServerMessage =
  | { kind: "snapshot"; status: DeviceStatus | null; online: boolean; events: DeviceEvent[]; broker: boolean }
  | { kind: "status"; status: DeviceStatus }
  | { kind: "online"; online: boolean }
  | { kind: "event"; event: DeviceEvent }
  | { kind: "broker"; connected: boolean }
  /** The backend refused a LOCK/UNLOCK because the door is open (latch must not move). */
  | { kind: "rejected"; action: LockCommand; reason: "door_open" };
