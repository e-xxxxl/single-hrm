import { DisciplinaryCase } from "../models/hrm/DisciplinaryCase.js";
import { Employee } from "../models/hrm/Employee.js";
import { Organization } from "../models/hrm/Organization.js";
import { nextCode } from "../models/hrm/Counter.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination, paginated } from "../utils/query.js";

export async function listCases(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.status) filter.status = query.status;
  if (query.employee) filter.employee = query.employee;
  if (query.category) filter.category = query.category;
  if (query.severity) filter.severity = query.severity;

  const [items, total] = await Promise.all([
    DisciplinaryCase.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName employeeId position")
      .populate("reportedBy", "firstName lastName"),
    DisciplinaryCase.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getCase(orgId, id) {
  const record = await DisciplinaryCase.findOne({ _id: id, organizationId: orgId })
    .populate("employee", "firstName lastName employeeId position department")
    .populate("reportedBy", "firstName lastName employeeId");
  if (!record) throw AppError.notFound("Disciplinary case not found");
  return record;
}

export async function createCase(orgId, actor, input) {
  const employee = await Employee.findOne({ _id: input.employee, organizationId: orgId });
  if (!employee) throw AppError.notFound("Employee not found");
  const reference = await nextCode("DC", `${orgId}:disciplinary`, 4);
  return DisciplinaryCase.create({
    ...input,
    organizationId: orgId,
    reference,
    status: "open",
    createdBy: actor.userId,
  });
}

export async function updateCase(orgId, id, input) {
  const record = await DisciplinaryCase.findOne({ _id: id, organizationId: orgId });
  if (!record) throw AppError.notFound("Disciplinary case not found");
  const fields = ["incidentDate", "category", "severity", "description", "evidenceUrls", "reportedBy"];
  for (const f of fields) if (input[f] !== undefined) record[f] = input[f];
  await record.save();
  return record;
}

export async function issueQuery(orgId, actor, id, { content, responseDueDate }) {
  const record = await DisciplinaryCase.findOne({ _id: id, organizationId: orgId });
  if (!record) throw AppError.notFound("Disciplinary case not found");
  record.query = { content, issuedAt: new Date(), issuedBy: actor.userId, responseDueDate };
  record.status = "query_issued";
  await record.save();
  return record;
}

/** Render the query letter as plain text (a formal HR document). */
export async function renderQueryLetter(orgId, id) {
  const record = await getCase(orgId, id);
  const org = await Organization.findById(orgId).select("name address");
  const e = record.employee;
  const today = new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
  return [
    org?.name || "",
    org?.address || "",
    "",
    today,
    "",
    `${e.firstName} ${e.lastName}`,
    `Employee ID: ${e.employeeId}${e.position ? ` — ${e.position}` : ""}`,
    "",
    `RE: QUERY — ${record.category.replace(/_/g, " ").toUpperCase()} (Ref ${record.reference})`,
    "",
    `It has been brought to the attention of management that on ${new Date(record.incidentDate).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}, the following occurred:`,
    "",
    record.description,
    "",
    record.query?.content || "You are required to explain in writing why disciplinary action should not be taken against you.",
    "",
    record.query?.responseDueDate
      ? `Your written response must reach the HR department on or before ${new Date(record.query.responseDueDate).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}.`
      : "Your written response must reach the HR department within 48 hours of receipt of this letter.",
    "",
    "Yours faithfully,",
    "",
    "Human Resources Department",
    org?.name || "",
  ].join("\n");
}

export async function recordResponse(orgId, id, { text, documentUrl }) {
  const record = await DisciplinaryCase.findOne({ _id: id, organizationId: orgId });
  if (!record) throw AppError.notFound("Disciplinary case not found");
  record.employeeResponse = { text, documentUrl, submittedAt: new Date() };
  if (record.status === "query_issued") record.status = "response_received";
  await record.save();
  return record;
}

export async function scheduleHearing(orgId, id, input) {
  const record = await DisciplinaryCase.findOne({ _id: id, organizationId: orgId });
  if (!record) throw AppError.notFound("Disciplinary case not found");
  record.hearing = { ...record.hearing?.toObject?.(), ...input };
  record.status = "hearing_scheduled";
  await record.save();
  return record;
}

export async function recordHearing(orgId, id, { notes }) {
  const record = await DisciplinaryCase.findOne({ _id: id, organizationId: orgId });
  if (!record) throw AppError.notFound("Disciplinary case not found");
  record.hearing = { ...record.hearing?.toObject?.(), notes, heldAt: new Date() };
  record.status = "hearing_held";
  await record.save();
  return record;
}

export async function recordOutcome(orgId, actor, id, input) {
  const record = await DisciplinaryCase.findOne({ _id: id, organizationId: orgId });
  if (!record) throw AppError.notFound("Disciplinary case not found");
  record.outcome = {
    decision: input.decision,
    details: input.details,
    effectiveDate: input.effectiveDate,
    sanctionEndDate: input.sanctionEndDate,
    decidedBy: actor.userId,
    decidedAt: new Date(),
  };
  record.status = "closed";
  record.closedAt = new Date();
  await record.save();

  // Reflect a sanction on the employee record.
  if (["suspension", "dismissal"].includes(input.decision)) {
    const patch = input.decision === "dismissal"
      ? { status: "inactive", employmentStatus: "Exited", exitDate: input.effectiveDate || new Date(), exitReason: "Dismissal (disciplinary)" }
      : { employmentStatus: "Suspended" };
    await Employee.updateOne({ _id: record.employee, organizationId: orgId }, { $set: patch });
  }
  return record;
}

export async function addNote(orgId, actor, id, note) {
  const record = await DisciplinaryCase.findOneAndUpdate(
    { _id: id, organizationId: orgId },
    { $push: { notes: { by: actor.userId, byName: actor.name, note, at: new Date() } } },
    { new: true },
  );
  if (!record) throw AppError.notFound("Disciplinary case not found");
  return record;
}

/**
 * Hard-delete a disciplinary case. Note: most HR compliance regimes expect
 * disciplinary records to be retained, not deleted — this exists because it
 * was explicitly requested, but consider archiving/closing a case instead of
 * deleting it where record-keeping requirements apply.
 */
export async function deleteCase(orgId, id) {
  const c = await DisciplinaryCase.findOneAndDelete({ _id: id, organizationId: orgId });
  if (!c) throw AppError.notFound("Case not found");
  return { ok: true };
}

export default {
  listCases,
  getCase,
  createCase,
  updateCase,
  issueQuery,
  renderQueryLetter,
  recordResponse,
  scheduleHearing,
  recordHearing,
  recordOutcome,
  addNote,
  deleteCase,
};
