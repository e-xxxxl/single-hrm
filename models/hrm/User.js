import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { hrmConnection } from "../../config/db.js";
import { env } from "../../config/env.js";
import { registerModel } from "../registerModel.js";
import { ROLES, PLATFORM_ROLE } from "../../utils/permissions.js";

const { Schema } = mongoose;

/**
 * A login. Every user belongs to exactly one organization (`organizationId`)
 * and holds one role there — except the Platform Admin, which belongs to no
 * organization and can only reach platform routes. The organization a request
 * acts in is always read from this record (via the auth middleware), never
 * taken from the request itself.
 *
 * Email is unique across the whole platform, so signing in never needs an
 * organization picker.
 */

const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true }, // sha256 of the refresh token
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { _id: true },
);

const userSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },

    role: { type: String, enum: ROLES, required: true },
    // Optional fine-grained overrides on top of the role's base permissions.
    permissionsGrant: { type: [String], default: [] },
    permissionsRevoke: { type: [String], default: [] },
    // Link to this user's employee record (set once onboarded).
    employee: { type: Schema.Types.ObjectId, ref: "Employee" },

    status: { type: String, enum: ["active", "suspended"], default: "active", index: true },
    mustChangePassword: { type: Boolean, default: false },

    // Bumped whenever every outstanding access token must stop working at once
    // (password change / reset, sign-out-everywhere, suspension). Carried in
    // the JWT and compared on every request.
    tokenVersion: { type: Number, default: 0 },

    twoFactor: {
      enabled: { type: Boolean, default: false },
      secret: { type: String, select: false },
      recoveryCodes: { type: [String], select: false, default: [] },
    },

    sessions: { type: [sessionSchema], default: [], select: false },

    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },
    // Deliberately no `ref`: the creator may be a Platform Admin, who belongs
    // to no organization, so it must not go through the same-organization
    // reference check (models/plugins/tenantScope.js).
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

userSchema.index({ organizationId: 1, role: 1, status: 1 });

userSchema.pre("validate", function checkScope() {
  const isPlatform = this.role === PLATFORM_ROLE;
  if (isPlatform && this.organizationId) {
    this.invalidate("organizationId", "A Platform Admin cannot belong to an organization");
  }
  if (!isPlatform && !this.organizationId) {
    this.invalidate("organizationId", "Organization users must belong to an organization");
  }
});

userSchema.virtual("isPlatformAdmin").get(function () {
  return this.role === PLATFORM_ROLE;
});

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, env.bcryptRounds);
  this.passwordChangedAt = new Date();
  this.mustChangePassword = false;
};

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ virtuals: true });
  obj.id = obj._id;
  delete obj._id;
  delete obj.__v;
  delete obj.passwordHash;
  delete obj.sessions;
  delete obj.tokenVersion;
  if (obj.twoFactor) {
    delete obj.twoFactor.secret;
    delete obj.twoFactor.recoveryCodes;
  }
  return obj;
};

export const User = registerModel(hrmConnection, "User", userSchema);
export default User;
