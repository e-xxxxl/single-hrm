import * as leave from "../services/leave.service.js";
import * as leaveTypes from "../services/leaveType.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";
import { notify } from "../services/notification.service.js";
import { hasPermission } from "../utils/permissions.js";
import { AppError } from "../utils/AppError.js";
import { Employee } from "../models/hrm/Employee.js";
import { assertEmployeeRecordAccess } from "../services/access.service.js";

/* -------- Leave types -------- */

export const listTypes = catchAsync(async (req, res) => {
  res.json({ data: await leaveTypes.listLeaveTypes(req.orgId, req.query) });
});
export const getType = catchAsync(async (req, res) => {
  res.json({ data: await leaveTypes.getLeaveType(req.orgId, req.params.id) });
});
export const createType = catchAsync(async (req, res) => {
  const t = await leaveTypes.createLeaveType(req.orgId, req.body);
  await recordAudit(req, { action: "leave_type.create", entityType: "LeaveType", entityId: t._id, entityLabel: t.name, summary: `Created leave type ${t.name}` });
  res.status(201).json({ data: t });
});
export const updateType = catchAsync(async (req, res) => {
  const t = await leaveTypes.updateLeaveType(req.orgId, req.params.id, req.body);
  await recordAudit(req, { action: "leave_type.update", entityType: "LeaveType", entityId: t._id, entityLabel: t.name, summary: `Updated leave type ${t.name}` });
  res.json({ data: t });
});
export const setTypeActive = catchAsync(async (req, res) => {
  const t = await leaveTypes.setLeaveTypeActive(req.orgId, req.params.id, req.body.active);
  await recordAudit(req, { action: "leave_type.status", entityType: "LeaveType", entityId: t._id, entityLabel: t.name, summary: `${t.active ? "Activated" : "Deactivated"} leave type ${t.name}` });
  res.json({ data: t });
});
export const deleteType = catchAsync(async (req, res) => {
  const t = await leaveTypes.getLeaveType(req.orgId, req.params.id);
  await leaveTypes.deleteLeaveType(req.orgId, req.params.id);
  await recordAudit(req, { action: "leave_type.delete", entityType: "LeaveType", entityId: req.params.id, entityLabel: t.name, summary: `Deleted leave type ${t.name}` });
  res.json({ data: { ok: true } });
});

/* -------- Balances -------- */

export const myLeave = catchAsync(async (req, res) => {
  res.json({ data: await leave.getMyLeave(req.orgId, req.auth) });
});

// Oversight roles see anyone's balances (e.g. from the employee profile);
// everyone else only their own.
const BALANCE_OVERSIGHT = ["leave:approve_hr", "leave:configure", "employee:read"];
// Who may open / annotate any leave request; others only their own or their reports'.
const REQUEST_OVERSIGHT = ["leave:approve_hr"];

async function loadViewableRequest(req) {
  const request = await leave.getRequest(req.orgId, req.params.id);
  await assertEmployeeRecordAccess(req.orgId, req.auth, request.employee, {
    oversight: REQUEST_OVERSIGHT,
    related: [request.lineManager],
  });
  return request;
}

export const employeeBalances = catchAsync(async (req, res) => {
  const employee = await Employee.findOne({ _id: req.params.employeeId, organizationId: req.orgId }).select("_id");
  if (!employee) throw AppError.notFound("Employee not found");
  await assertEmployeeRecordAccess(req.orgId, req.auth, employee._id, { oversight: BALANCE_OVERSIGHT });
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  res.json({ data: await leave.listBalances(req.orgId, employee._id, year) });
});

export const adjustBalance = catchAsync(async (req, res) => {
  const b = await leave.adjustBalance(req.orgId, req.body);
  await recordAudit(req, {
    action: "leave_balance.adjust",
    entityType: "LeaveBalance",
    entityId: b._id,
    summary: `Adjusted leave balance (${req.body.year})`,
    metadata: req.body,
  });
  res.json({ data: b });
});

/* -------- Requests -------- */

export const listRequests = catchAsync(async (req, res) => {
  res.json(await leave.listRequests(req.orgId, req.auth, req.query));
});

export const getRequest = catchAsync(async (req, res) => {
  res.json({ data: await loadViewableRequest(req) });
});

export const createRequest = catchAsync(async (req, res) => {
  const onBehalf = Boolean(req.body.employee) && hasPermission(req.auth.permissions, "leave:approve_hr");
  const request = await leave.createRequest(req.orgId, req.auth, req.body, { onBehalf });
  await recordAudit(req, {
    action: "leave.request",
    entityType: "LeaveRequest",
    entityId: request.id,
    entityLabel: request.reference,
    summary: `${request.employee.name} requested ${request.days} day(s) ${request.leaveType.name}`,
  });
  if (request.lineManager) {
    await notify(req.orgId, {
      to: { employee: request.lineManager },
      type: "leave.submitted",
      title: "Leave request awaiting your approval",
      body: `${request.employee.name} · ${request.leaveType.name} · ${request.days} day(s)`,
      link: `/hrm/leave/${request.id}`,
    });
  }
  res.status(201).json({ data: request });
});

export const updateRequest = catchAsync(async (req, res) => {
  const request = await leave.updateRequest(req.orgId, req.auth, req.params.id, req.body);
  await recordAudit(req, { action: "leave.update", entityType: "LeaveRequest", entityId: request.id, entityLabel: request.reference, summary: `Updated leave request ${request.reference}` });
  res.json({ data: request });
});

export const managerDecision = catchAsync(async (req, res) => {
  const request = await leave.managerDecision(req.orgId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: `leave.manager_${req.body.action}`,
    entityType: "LeaveRequest",
    entityId: request.id,
    entityLabel: request.reference,
    summary: `Line manager ${req.body.action} ${request.reference}`,
  });
  await notifyEmployee(req, request);
  res.json({ data: request });
});

export const hrDecision = catchAsync(async (req, res) => {
  const request = await leave.hrDecision(req.orgId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: `leave.hr_${req.body.action}`,
    entityType: "LeaveRequest",
    entityId: request.id,
    entityLabel: request.reference,
    summary: `HR ${req.body.action} ${request.reference}${request.coverageOverride ? " (coverage override)" : ""}`,
  });
  await notifyEmployee(req, request);
  res.json({ data: request });
});

export const cancelRequest = catchAsync(async (req, res) => {
  const request = await leave.cancelRequest(req.orgId, req.auth, req.params.id);
  await recordAudit(req, { action: "leave.cancel", entityType: "LeaveRequest", entityId: request.id, entityLabel: request.reference, summary: `Cancelled ${request.reference}` });
  res.json({ data: request });
});

export const addNote = catchAsync(async (req, res) => {
  await loadViewableRequest(req);
  const request = await leave.addNote(req.orgId, req.auth, req.params.id, req.body.note);
  res.json({ data: request });
});

export const calendar = catchAsync(async (req, res) => {
  res.json({ data: await leave.calendar(req.orgId, req.query) });
});

async function notifyEmployee(req, request) {
  if (!request.employee?.id) return;
  const map = {
    "Manager Approved": ["Leave request passed line-manager approval", "Awaiting HR confirmation."],
    Approved: ["Leave request approved", `${request.days} day(s) ${request.leaveType?.name}`],
    Rejected: ["Leave request rejected", "See the request for details."],
    "Clarification Requested": ["Leave request needs clarification", "HR or your manager has a question."],
  };
  const entry = map[request.status];
  if (!entry) return;
  await notify(req.orgId, {
    to: { employee: request.employee.id },
    type: "leave.status",
    title: entry[0],
    body: entry[1],
    link: `/hrm/leave/${request.id}`,
  });
}

export default {
  listTypes,
  getType,
  createType,
  updateType,
  setTypeActive,
  deleteType,
  myLeave,
  employeeBalances,
  adjustBalance,
  listRequests,
  getRequest,
  createRequest,
  updateRequest,
  managerDecision,
  hrDecision,
  cancelRequest,
  addNote,
  calendar,
};
