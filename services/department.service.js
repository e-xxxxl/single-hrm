import mongoose from "mongoose";
import { Department } from "../models/hrm/Department.js";
import { Employee } from "../models/hrm/Employee.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination, parseSort, paginated, escapeRegex } from "../utils/query.js";

const SORTABLE = ["name", "code", "createdAt", "status"];

export async function listDepartments(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, SORTABLE, { name: 1 });
  const filter = { organizationId: orgId };
  if (query.status) filter.status = query.status;
  if (query.branch) filter.branch = query.branch;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { code: rx }, { description: rx }];
  }

  const [rows, total] = await Promise.all([
    Department.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("head", "firstName lastName employeeId")
      .populate("branch", "name"),
    Department.countDocuments(filter),
  ]);

  const counts = await Employee.aggregate([
    { $match: { organizationId: new mongoose.Types.ObjectId(String(orgId)), department: { $ne: null }, status: "active" } },
    { $group: { _id: "$department", n: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.n]));
  const items = rows.map((d) => ({ ...d.toJSON(), employeeCount: countMap.get(String(d._id)) || 0 }));

  return paginated(items, total, { page, limit });
}

export async function getDepartment(orgId, id) {
  const department = await Department.findOne({ _id: id, organizationId: orgId })
    .populate("head", "firstName lastName employeeId position")
    .populate("branch", "name")
    .populate("parent", "name");
  if (!department) throw AppError.notFound("Department not found");
  const employees = await Employee.find({ organizationId: orgId, department: id, status: "active" })
    .select("firstName lastName employeeId position photoUrl")
    .sort({ lastName: 1 });
  return { department, employees };
}

export async function createDepartment(orgId, input) {
  const exists = await Department.findOne({ organizationId: orgId, name: input.name });
  if (exists) throw AppError.conflict("A department with that name already exists");
  return Department.create({ ...input, organizationId: orgId });
}

export async function updateDepartment(orgId, id, input) {
  if (input.parent && String(input.parent) === String(id)) {
    throw AppError.badRequest("A department cannot be its own parent");
  }
  const department = await Department.findOneAndUpdate(
    { _id: id, organizationId: orgId },
    { $set: input },
    { new: true, runValidators: true },
  );
  if (!department) throw AppError.notFound("Department not found");
  return department;
}

export async function setDepartmentStatus(orgId, id, status) {
  if (status === "inactive") {
    const staff = await Employee.countDocuments({ organizationId: orgId, department: id, status: "active" });
    if (staff > 0) {
      throw AppError.badRequest(
        `Cannot deactivate — ${staff} active employee(s) are still assigned to this department`,
      );
    }
  }
  const department = await Department.findOneAndUpdate(
    { _id: id, organizationId: orgId },
    { $set: { status } },
    { new: true },
  );
  if (!department) throw AppError.notFound("Department not found");
  return department;
}

export async function deleteDepartment(orgId, id) {
  const staff = await Employee.countDocuments({ organizationId: orgId, department: id });
  if (staff > 0) {
    throw AppError.badRequest(`Cannot delete — ${staff} employee(s) are assigned to this department (past or present)`);
  }
  const department = await Department.findOneAndDelete({ _id: id, organizationId: orgId });
  if (!department) throw AppError.notFound("Department not found");
  await Department.updateMany({ organizationId: orgId, parent: id }, { $unset: { parent: 1 } });
  return { ok: true };
}

export default {
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  setDepartmentStatus,
  deleteDepartment,
};
