import mongoose, { Schema, type InferSchemaType } from "mongoose";

/** Eventos y alertas (smartlock/<id>/event y /alert). */
const eventSchema = new Schema(
  {
    device: { type: String, required: true, index: true },
    channel: { type: String, enum: ["event", "alert"], required: true },
    type: { type: String, required: true, index: true },
    detail: { type: String, default: "" },
    ts: { type: Date, required: true, default: Date.now, index: true },
  },
  { versionKey: false },
);

/** Historial de estados (smartlock/<id>/status). */
const statusLogSchema = new Schema(
  {
    device: { type: String, required: true, index: true },
    door: { type: String, enum: ["open", "closed"], required: true },
    latch: { type: String, enum: ["locked", "unlocked"], required: true },
    presence: Boolean,
    alarm: Boolean,
    rssi: Number,
    sd: Boolean,
    ts: { type: Date, required: true, default: Date.now, index: true },
  },
  { versionKey: false },
);

/** Comandos enviados desde la web (auditoría). */
const commandSchema = new Schema(
  {
    device: { type: String, required: true },
    action: { type: String, required: true },
    accepted: { type: Boolean, default: true },
    reason: String,
    ts: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false },
);

export type EventDoc = InferSchemaType<typeof eventSchema>;
export type StatusLogDoc = InferSchemaType<typeof statusLogSchema>;

export const EventModel = mongoose.models.Event ?? mongoose.model("Event", eventSchema);
export const StatusLogModel = mongoose.models.StatusLog ?? mongoose.model("StatusLog", statusLogSchema);
export const CommandModel = mongoose.models.Command ?? mongoose.model("Command", commandSchema);
