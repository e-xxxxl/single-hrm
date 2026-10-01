import mongoose from "mongoose";
import { Branch } from "../models/hrm/Branch.js";
import { Employee } from "../models/hrm/Employee.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination, parseSort, paginated, escapeRegex } from "../utils/query.js";

const SORTABLE = ["name", "code", "state", "createdAt", "status"];

function toLocation(input) {
  const lat = input.latitude ?? input.lat;
  const lng = input.longitude ?? input.lng;
  if (lat === undefined || lat === null || lng === undefined || lng === null) return undefined;
  return { type: "Point", coordinates: [Number(lng), Number(lat)] };
}

export async function listBranches(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, SORTABLE, { name: 1 });
  const filter = { organizationId: orgId };
  if (query.status) filter.status = query.status;
  if (query.state) filter.state = query.state;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { code: rx }, { address: rx }, { lga: rx }];
  }

  const [rows, total] = await Promise.all([
    Branch.find(filter).sort(sort).skip(skip).limit(limit).populate("manager", "firstName lastName employeeId"),
    Branch.countDocuments(filter),
  ]);

  // Attach a live employee count per branch.
  const counts = await Employee.aggregate([
    { $match: { organizationId: toObjectId(orgId), branch: { $ne: null }, status: "active" } },
    { $group: { _id: "$branch", n: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.n]));
  const items = rows.map((b) => ({ ...b.toJSON(), employeeCount: countMap.get(String(b._id)) || 0 }));

  return paginated(items, total, { page, limit });
}

export async function getBranch(orgId, id) {
  const branch = await Branch.findOne({ _id: id, organizationId: orgId }).populate(
    "manager",
    "firstName lastName employeeId position",
  );
  if (!branch) throw AppError.notFound("Branch not found");
  const employeeCount = await Employee.countDocuments({ organizationId: orgId, branch: id, status: "active" });
  return { branch, employeeCount };
}

export async function createBranch(orgId, input) {
  const exists = await Branch.findOne({ organizationId: orgId, name: input.name });
  if (exists) throw AppError.conflict("A branch with that name already exists");
  const location = toLocation(input);
  return Branch.create({ ...stripCoords(input), organizationId: orgId, ...(location ? { location } : {}) });
}

export async function updateBranch(orgId, id, input) {
  const location = toLocation(input);
  const update = { $set: { ...stripCoords(input) } };
  if (location) update.$set.location = location;
  const branch = await Branch.findOneAndUpdate({ _id: id, organizationId: orgId }, update, {
    new: true,
    runValidators: true,
  });
  if (!branch) throw AppError.notFound("Branch not found");
  return branch;
}

export async function setBranchStatus(orgId, id, status) {
  const branch = await Branch.findOneAndUpdate(
    { _id: id, organizationId: orgId },
    { $set: { status } },
    { new: true },
  );
  if (!branch) throw AppError.notFound("Branch not found");
  return branch;
}

export async function deleteBranch(orgId, id) {
  const staff = await Employee.countDocuments({ organizationId: orgId, branch: id });
  if (staff > 0) {
    throw AppError.badRequest(`Cannot delete — ${staff} employee(s) are assigned to this branch (past or present)`);
  }
  const branch = await Branch.findOneAndDelete({ _id: id, organizationId: orgId });
  if (!branch) throw AppError.notFound("Branch not found");
  return { ok: true };
}

function stripCoords(input) {
  const { latitude, longitude, lat, lng, ...rest } = input;
  return rest;
}

function toObjectId(id) {
  return new mongoose.Types.ObjectId(String(id));
}

export default { listBranches, getBranch, createBranch, updateBranch, setBranchStatus, deleteBranch };
