import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * Atomic per-scope counters for generating human-readable sequential ids
 * (employee numbers, payroll run numbers, requisition numbers, …).
 */
const counterSchema = new Schema({
  _id: { type: String, required: true }, // e.g. "<orgId>:employee"
  seq: { type: Number, default: 0 },
});

const Counter = registerModel(hrmConnection, "Counter", counterSchema);

/** Increment and return the next value for a scoped key. */
export async function nextSequence(scopeKey) {
  const doc = await Counter.findByIdAndUpdate(
    scopeKey,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return doc.seq;
}

/** Zero-padded id like "AJCL-000123". */
export async function nextCode(prefix, scopeKey, pad = 5) {
  const n = await nextSequence(scopeKey);
  return `${prefix}-${String(n).padStart(pad, "0")}`;
}

export default Counter;
