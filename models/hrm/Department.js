import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

const departmentSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },

    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, uppercase: true },
    description: { type: String, trim: true },

    head: { type: Schema.Types.ObjectId, ref: "Employee" },
    branch: { type: Schema.Types.ObjectId, ref: "Branch" },
    parent: { type: Schema.Types.ObjectId, ref: "Department" },

    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true },
);

departmentSchema.index({ organizationId: 1, name: 1 }, { unique: true });
// Unique per organization, but only among departments that actually have a code
// (a plain `sparse` index still treats "no code" as a value once organizationId
// is part of the key, so a second code-less department would collide).
departmentSchema.index(
  { organizationId: 1, code: 1 },
  { unique: true, partialFilterExpression: { code: { $type: "string", $gt: "" } } },
);

departmentSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Department = registerModel(hrmConnection, "Department", departmentSchema);
export default Department;
