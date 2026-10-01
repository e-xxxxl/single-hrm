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
departmentSchema.index({ organizationId: 1, code: 1 }, { unique: true, sparse: true });

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
