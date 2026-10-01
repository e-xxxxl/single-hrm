import { Employee } from "../models/hrm/Employee.js";
import { Organization } from "../models/hrm/Organization.js";
import { Department } from "../models/hrm/Department.js";
import { Branch } from "../models/hrm/Branch.js";
import { User } from "../models/hrm/User.js";
import { nextCode } from "../models/hrm/Counter.js";
import { AppError } from "../utils/AppError.js";
import { ORG_ADMIN_ROLE } from "../utils/permissions.js";
import { parsePagination, parseSort, paginated, escapeRegex } from "../utils/query.js";
import {
  assertCanAssignRole,
  assertEmailAvailable,
  assertKeepsAnOrgAdmin,
  createAccount,
  resetAccountPassword,
  setAccountStatus,
} from "./account.service.js";
import { invalidateUserState } from "./authState.service.js";

const SORTABLE = ["lastName", "firstName", "employeeId", "position", "dateJoined", "createdAt", "employmentStatus"];

/** Fields a caller without `employee:read_sensitive` must never receive. */
const SENSITIVE_SELECT = "+nin +bvn +salaryHistory";

export async function listEmployees(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, SORTABLE, { lastName: 1, firstName: 1 });

  const filter = { organizationId: orgId };
  if (query.status) filter.status = query.status;
  if (query.employmentStatus) filter.employmentStatus = query.employmentStatus;
  if (query.employmentType) filter.employmentType = query.employmentType;
  if (query.department) filter.department = query.department;
  if (query.branch) filter.branch = query.branch;
  if (query.joinedFrom || query.joinedTo) {
    filter.dateJoined = {};
    if (query.joinedFrom) filter.dateJoined.$gte = new Date(query.joinedFrom);
    if (query.joinedTo) filter.dateJoined.$lte = new Date(query.joinedTo);
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [
      { firstName: rx },
      { lastName: rx },
      { middleName: rx },
      { email: rx },
      { employeeId: rx },
      { position: rx },
      { phone: rx },
    ];
  }

  const [items, total] = await Promise.all([
    Employee.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("department", "name")
      .populate("branch", "name")
      .populate("reportingManager", "firstName lastName employeeId"),
    Employee.countDocuments(filter),
  ]);

  return paginated(items, total, { page, limit });
}

export async function getEmployee(orgId, id, { includeSensitive = false } = {}) {
  let q = Employee.findOne({ _id: id, organizationId: orgId })
    .populate("department", "name")
    .populate("branch", "name state geofenceRadiusMeters")
    .populate("reportingManager", "firstName lastName employeeId position")
    .populate("user", "email status lastLoginAt");
  if (includeSensitive) q = q.select(SENSITIVE_SELECT);
  const employee = await q;
  if (!employee) throw AppError.notFound("Employee not found");
  return employee;
}

async function assertRefsBelongToOrg(orgId, input) {
  if (input.department) {
    const ok = await Department.exists({ _id: input.department, organizationId: orgId });
    if (!ok) throw AppError.badRequest("Unknown department for this organization");
  }
  if (input.branch) {
    const ok = await Branch.exists({ _id: input.branch, organizationId: orgId });
    if (!ok) throw AppError.badRequest("Unknown branch for this organization");
  }
  if (input.reportingManager) {
    const ok = await Employee.exists({ _id: input.reportingManager, organizationId: orgId });
    if (!ok) throw AppError.badRequest("Unknown reporting manager for this organization");
  }
}

export async function createEmployee(orgId, input, actor) {
  const actorUserId = actor.userId;
  const org = await Organization.findById(orgId);
  if (!org) throw AppError.badRequest("Unknown organization");

  const { provisionLogin, ...data } = input;
  input = data;

  const emailTaken = await Employee.findOne({ organizationId: orgId, email: input.email.toLowerCase() });
  if (emailTaken) throw AppError.conflict("An employee with that email already exists");

  await assertRefsBelongToOrg(orgId, input);

  const employeeId =
    input.employeeId?.trim().toUpperCase() ||
    (await nextCode(org.code, `${orgId}:employee`, 4));

  const now = new Date();
  const joined = input.dateJoined ? new Date(input.dateJoined) : now;

  const employee = new Employee({
    ...input,
    email: input.email.toLowerCase(),
    organizationId: orgId,
    employeeId,
    dateJoined: joined,
    positionHistory: [{ from: joined, title: input.position, grade: input.grade, changedBy: actorUserId }],
    departmentHistory: input.department
      ? [{ from: joined, department: input.department, changedBy: actorUserId }]
      : [],
    branchHistory: input.branch ? [{ from: joined, branch: input.branch, changedBy: actorUserId }] : [],
  });
  await employee.save();

  // Auto-link an existing login in this organization that has the same email
  // and isn't attached to an employee yet (e.g. an Org Admin created by the
  // platform before their employee record existed).
  const existingUser = await User.findOne({ organizationId: orgId, email: employee.email });
  if (existingUser && !existingUser.employee) {
    await linkUser(employee, existingUser);
  }

  let login = null;
  if (provisionLogin && !employee.user) {
    const result = await provisionEmployeeLogin(orgId, employee, provisionLogin, actor);
    login = result.tempPassword ? { tempPassword: result.tempPassword } : { created: true };
  }

  return { employee, login };
}

/** The login linked to `employee`, only if it belongs to this organization. */
async function loginFor(orgId, employee) {
  if (!employee.user) return null;
  return User.findOne({ _id: employee.user, organizationId: orgId });
}

/**
 * Give an employee a login in this organization. The actor may only grant
 * roles below their own (an Org Admin may grant any organization role), so a
 * role with plain `employee:write` can't mint itself an administrator. Login
 * emails are unique platform-wide: an email already used by an account in any
 * organization is refused rather than merged.
 */
export async function provisionEmployeeLogin(orgId, employee, { role, password } = {}, actor) {
  assertCanAssignRole(actor.role, role);
  if (employee.user) throw AppError.conflict("This employee already has a login");

  const { user, tempPassword } = await createAccount({
    organizationId: orgId,
    name: employee.fullName,
    email: employee.email,
    phone: employee.phone,
    role,
    password,
    employee: employee._id,
    createdBy: actor.userId,
  });

  employee.user = user._id;
  await employee.save();
  return { user, tempPassword };
}

/** View an employee's login details — email, role, status, last sign-in. */
export async function getEmployeeLogin(orgId, employee) {
  const user = await loginFor(orgId, employee);
  if (!user) return null;
  return {
    userId: user._id,
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
  };
}

/**
 * Change an employee's login email, role, or suspended/active status. Role
 * changes follow the same "only below your own role" rule as provisioning, and
 * the organization always keeps at least one active Org Admin.
 */
export async function updateEmployeeLogin(orgId, employee, input, actor) {
  const user = await loginFor(orgId, employee);
  if (!user) throw AppError.badRequest("This employee has no platform login yet");
  if (String(user._id) === String(actor.userId) && (input.role || input.status)) {
    throw AppError.forbidden("You cannot change your own role or status");
  }
  if (actor.role !== ORG_ADMIN_ROLE && user.role === ORG_ADMIN_ROLE) {
    throw AppError.forbidden("Only an Org Admin can change another Org Admin's login");
  }

  if (input.role && input.role !== user.role) assertCanAssignRole(actor.role, input.role);
  await assertKeepsAnOrgAdmin(user, { role: input.role, status: input.status });

  if (input.role) user.role = input.role;
  if (input.email && input.email.toLowerCase() !== user.email) {
    await assertEmailAvailable(input.email, user._id);
    user.email = input.email.toLowerCase();
  }
  await user.save();
  invalidateUserState(user._id);

  if (input.status && input.status !== user.status) await setAccountStatus(user, input.status);
  return getEmployeeLogin(orgId, employee);
}

/** Reset an employee's login password — a new temp password they must change at next sign-in; signs them out everywhere. */
export async function resetEmployeeLoginPassword(orgId, employee, password, actor) {
  const user = await loginFor(orgId, employee);
  if (!user) throw AppError.badRequest("This employee has no platform login yet");
  if (actor.role !== ORG_ADMIN_ROLE && user.role === ORG_ADMIN_ROLE) {
    throw AppError.forbidden("Only an Org Admin can reset another Org Admin's password");
  }
  return resetAccountPassword(user._id, password);
}

async function linkUser(employee, user) {
  if (!user.employee) {
    user.employee = employee._id;
    await user.save();
    invalidateUserState(user._id);
  }
  if (!employee.user) {
    employee.user = user._id;
    await employee.save();
  }
}

export async function updateEmployee(orgId, id, input, actorUserId) {
  if (input.provisionLogin) delete input.provisionLogin;
  const employee = await Employee.findOne({ _id: id, organizationId: orgId }).select(SENSITIVE_SELECT);
  if (!employee) throw AppError.notFound("Employee not found");

  await assertRefsBelongToOrg(orgId, input);

  if (input.employeeId) {
    const nextId = input.employeeId.trim().toUpperCase();
    if (nextId !== employee.employeeId) {
      const taken = await Employee.findOne({ organizationId: orgId, employeeId: nextId, _id: { $ne: employee._id } });
      if (taken) throw AppError.conflict(`Employee ID "${nextId}" is already in use`);
      employee.employeeId = nextId;
    }
  }

  const now = new Date();

  // Track position / department / branch transitions in the history arrays.
  if (input.position && input.position !== employee.position) {
    closeOpen(employee.positionHistory, now);
    employee.positionHistory.push({ from: now, title: input.position, grade: input.grade ?? employee.grade, changedBy: actorUserId });
  }
  if (input.department && String(input.department) !== String(employee.department || "")) {
    closeOpen(employee.departmentHistory, now);
    employee.departmentHistory.push({ from: now, department: input.department, changedBy: actorUserId });
  }
  if (input.branch && String(input.branch) !== String(employee.branch || "")) {
    closeOpen(employee.branchHistory, now);
    employee.branchHistory.push({ from: now, branch: input.branch, changedBy: actorUserId });
  }

  const PROTECTED = ["organizationId", "employeeId", "_id", "status", "positionHistory", "departmentHistory", "branchHistory", "salaryHistory"];
  for (const [key, value] of Object.entries(input)) {
    if (PROTECTED.includes(key)) continue;
    employee.set(key, value);
  }
  if (input.email) employee.email = input.email.toLowerCase();

  await employee.save();
  return employee;
}

export async function setEmployeeStatus(orgId, id, status, reason, actorUserId) {
  const employee = await Employee.findOne({ _id: id, organizationId: orgId });
  if (!employee) throw AppError.notFound("Employee not found");

  employee.status = status;
  if (status === "inactive") {
    employee.deactivatedAt = new Date();
    employee.deactivatedReason = reason || "";
    if (employee.employmentStatus !== "Exited") employee.employmentStatus = "Suspended";
  } else {
    employee.deactivatedAt = undefined;
    employee.deactivatedReason = undefined;
    if (employee.employmentStatus === "Suspended") employee.employmentStatus = "Active";
  }
  await employee.save();
  return employee;
}

/**
 * Permanently remove an employee and every record about them — attendance,
 * leave, salary/payroll history, performance reviews, disciplinary cases,
 * documents, trip logs, notifications — plus their login. Records that
 * merely reference the employee as *someone else's* manager/reviewer/etc are
 * not deleted, just unlinked, so the org chart and other people's history
 * stay intact. Irreversible — only an Org Admin may call this; HR Managers
 * can edit and deactivate an employee but not delete one.
 */
export async function deleteEmployee(orgId, id, actor) {
  if (actor?.role !== ORG_ADMIN_ROLE) {
    throw AppError.forbidden("Only an Org Admin can delete an employee");
  }
  const employee = await Employee.findOne({ _id: id, organizationId: orgId });
  if (!employee) throw AppError.notFound("Employee not found");

  // Refuse up front (before anything is deleted) if their login is the
  // organization's last active Org Admin, or the caller's own login.
  const login = await loginFor(orgId, employee);
  if (login) {
    if (String(login._id) === String(actor.userId)) throw AppError.forbidden("You cannot delete your own employee record");
    await assertKeepsAnOrgAdmin(login, { status: "suspended" });
  }

  const [
    { Attendance },
    { LeaveRequest },
    { LeaveBalance },
    { SalaryStructure },
    { Payslip },
    { PerformanceReview },
    { DisciplinaryCase },
    { HrDocument },
    { TripLog },
    { Notification },
    { Target },
    { JobPosting },
    { Applicant },
    { Loan },
    { TrainingAttendance },
    { Referral },
  ] = await Promise.all([
    import("../models/hrm/Attendance.js"),
    import("../models/hrm/LeaveRequest.js"),
    import("../models/hrm/LeaveBalance.js"),
    import("../models/hrm/SalaryStructure.js"),
    import("../models/hrm/Payslip.js"),
    import("../models/hrm/PerformanceReview.js"),
    import("../models/hrm/DisciplinaryCase.js"),
    import("../models/hrm/HrDocument.js"),
    import("../models/hrm/TripLog.js"),
    import("../models/hrm/Notification.js"),
    import("../models/hrm/Target.js"),
    import("../models/hrm/JobPosting.js"),
    import("../models/hrm/Applicant.js"),
    import("../models/hrm/Loan.js"),
    import("../models/hrm/TrainingAttendance.js"),
    import("../models/hrm/Referral.js"),
  ]);

  // Records owned by / about this employee — deleted outright.
  await Promise.all([
    Attendance.deleteMany({ organizationId: orgId, employee: id }),
    LeaveRequest.deleteMany({ organizationId: orgId, employee: id }),
    LeaveBalance.deleteMany({ organizationId: orgId, employee: id }),
    SalaryStructure.deleteMany({ organizationId: orgId, employee: id }),
    Payslip.deleteMany({ organizationId: orgId, employee: id }),
    PerformanceReview.deleteMany({ organizationId: orgId, employee: id }),
    DisciplinaryCase.deleteMany({ organizationId: orgId, employee: id }),
    HrDocument.deleteMany({ organizationId: orgId, employee: id }),
    TripLog.deleteMany({ organizationId: orgId, employee: id }),
    Notification.deleteMany({ organizationId: orgId, recipientEmployee: id }),
    Target.deleteMany({ organizationId: orgId, employee: id }),
    Loan.deleteMany({ organizationId: orgId, employee: id }),
    TrainingAttendance.deleteMany({ organizationId: orgId, employee: id }),
    Referral.deleteMany({ organizationId: orgId, employee: id }),
  ]);

  // Records that name this employee as someone else's manager/reviewer/etc —
  // unlinked, not deleted.
  await Promise.all([
    Employee.updateMany({ organizationId: orgId, reportingManager: id }, { $unset: { reportingManager: 1 } }),
    Department.updateMany({ organizationId: orgId, head: id }, { $unset: { head: 1 } }),
    Branch.updateMany({ organizationId: orgId, manager: id }, { $unset: { manager: 1 } }),
    LeaveRequest.updateMany({ organizationId: orgId, lineManager: id }, { $unset: { lineManager: 1 } }),
    PerformanceReview.updateMany({ organizationId: orgId, reviewer: id }, { $unset: { reviewer: 1 } }),
    DisciplinaryCase.updateMany({ organizationId: orgId, reportedBy: id }, { $unset: { reportedBy: 1 } }),
    JobPosting.updateMany({ organizationId: orgId, hiringManager: id }, { $unset: { hiringManager: 1 } }),
    Applicant.updateMany({ organizationId: orgId, assignedRecruiter: id }, { $unset: { assignedRecruiter: 1 } }),
    Applicant.updateMany({ organizationId: orgId, convertedToEmployee: id }, { $unset: { convertedToEmployee: 1 } }),
  ]);

  // Their login goes too (checked above that it isn't the last Org Admin).
  if (login) {
    await User.deleteOne({ _id: login._id, organizationId: orgId });
    invalidateUserState(login._id);
  }

  await Employee.deleteOne({ _id: id, organizationId: orgId });
  return { deleted: true, name: employee.fullName, employeeId: employee.employeeId };
}

/** Close the currently-open history entry (the one without a `to`). */
function closeOpen(list, at) {
  const open = list.find((e) => !e.to);
  if (open) open.to = at;
}

export default {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  setEmployeeStatus,
  deleteEmployee,
  getEmployeeLogin,
  updateEmployeeLogin,
  resetEmployeeLoginPassword,
};
