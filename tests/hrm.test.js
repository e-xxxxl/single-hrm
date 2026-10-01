/**
 * HRM happy paths, run the way the UI uses the API: employee & department
 * CRUD, attendance, the two-stage leave workflow, a full payroll cycle,
 * self-service documents, recruitment → hire with a login, reports and
 * settings — and that none of it leaks into the other organization.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, login, get, post, patch, del } from "./helpers.js";

let A = {};
let B = {};

before(async () => {
  await startApp();
  for (const role of ["admin", "hr", "finance", "manager", "employee"]) {
    A[role] = await login(`${role}@esiatoptivest.test`);
  }
  B.admin = await login("admin@vendramart.test");
  B.employeeCount = (await get("/hrm/employees?limit=100", B.admin.token)).body.meta.total;
});

after(async () => {
  await stopApp();
});

function nextWeekday(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("employees & departments", () => {
  test("department create → update → delete", async () => {
    const t = A.hr.token;
    const created = await post("/hrm/departments", t, { name: "Research", code: "RND" });
    assert.equal(created.status, 201);
    const id = created.body.data.id;
    const updated = await patch(`/hrm/departments/${id}`, t, { description: "R&D lab" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.description, "R&D lab");
    assert.equal((await del(`/hrm/departments/${id}`, t)).status, 200);
    assert.equal((await get(`/hrm/departments/${id}`, t)).status, 404);
  });

  test("employee create (with login) → update → deactivate → delete", async () => {
    const dept = (await get("/hrm/departments?limit=100", A.hr.token)).body.data[0];
    const created = await post("/hrm/employees", A.hr.token, {
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace.hopper@esiatoptivest.test",
      phone: "+2348030000999",
      position: "Compiler Engineer",
      department: dept.id,
      dateJoined: "2026-01-05",
      provisionLogin: { role: "Employee" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const emp = created.body.data;
    assert.match(emp.employeeId, /^ESIAT-/);
    assert.ok(created.body.meta.login.tempPassword);

    const updated = await patch(`/hrm/employees/${emp.id}`, A.hr.token, { position: "Principal Engineer" });
    assert.equal(updated.body.data.position, "Principal Engineer");
    assert.equal(updated.body.data.positionHistory.length, 2);

    const off = await patch(`/hrm/employees/${emp.id}/status`, A.hr.token, { status: "inactive", reason: "Left" });
    assert.equal(off.body.data.status, "inactive");

    assert.equal((await del(`/hrm/employees/${emp.id}`, A.admin.token)).status, 200);
    assert.equal((await get(`/hrm/employees/${emp.id}`, A.hr.token)).status, 404);
    // Their login went with them.
    assert.equal((await post("/auth/login", null, { email: "grace.hopper@esiatoptivest.test", password: "x-anything" })).status, 401);
    // Organization B untouched.
    assert.equal((await get("/hrm/employees?limit=100", B.admin.token)).body.meta.total, B.employeeCount);
  });
});

describe("attendance", () => {
  test("employee clocks in and out with GPS; HR sees it on today's register", async () => {
    const t = A.employee.token;
    const me = await get("/hrm/attendance/me", t);
    assert.equal(me.status, 200);
    const inRes = await post("/hrm/attendance/clock-in", t, { latitude: 6.4474, longitude: 3.4723, accuracyMeters: 12 });
    assert.ok([200, 201].includes(inRes.status), JSON.stringify(inRes.body));
    const outRes = await post("/hrm/attendance/clock-out", t, { latitude: 6.4474, longitude: 3.4723 });
    assert.ok([200, 201].includes(outRes.status), JSON.stringify(outRes.body));
    const today = await get("/hrm/attendance/today?limit=200", A.hr.token);
    assert.equal(today.status, 200);
    const row = today.body.data.find((r) => r.employee?.email === "employee@esiatoptivest.test" || r.employee?.name?.includes("Chiamaka"));
    assert.ok(row, "clocked-in employee missing from today's register");
    const monthly = await get("/hrm/attendance/reports/monthly", A.hr.token);
    assert.equal(monthly.status, 200);
  });
});

describe("leave", () => {
  test("request → line-manager approval → HR approval moves days from pending to used", async () => {
    const types = (await get("/hrm/leave/types", A.employee.token)).body.data;
    const casual = types.find((t) => t.code === "CASUAL");
    const start = nextWeekday(45);
    const before = (await get("/hrm/leave/me", A.employee.token)).body.data.balances.find((b) => b.leaveType.code === "CASUAL");

    const req = await post("/hrm/leave/requests", A.employee.token, {
      leaveType: casual.id,
      startDate: start,
      endDate: start,
      reason: "Doctor's appointment",
    });
    assert.equal(req.status, 201, JSON.stringify(req.body));
    const id = req.body.data.id;

    const mgr = await post(`/hrm/leave/requests/${id}/manager-decision`, A.manager.token, { action: "approve" });
    assert.equal(mgr.status, 200, JSON.stringify(mgr.body));
    assert.equal(mgr.body.data.status, "Manager Approved");

    const hr = await post(`/hrm/leave/requests/${id}/hr-decision`, A.hr.token, { action: "approve", coverageOverride: true });
    assert.equal(hr.status, 200, JSON.stringify(hr.body));
    assert.equal(hr.body.data.status, "Approved");

    const after = (await get("/hrm/leave/me", A.employee.token)).body.data.balances.find((b) => b.leaveType.code === "CASUAL");
    assert.equal(after.usedDays, before.usedDays + 1);
    const calendar = await get("/hrm/leave/calendar", A.employee.token);
    assert.equal(calendar.status, 200);
  });
});

describe("payroll", () => {
  test("create → calculate → approve → finalize; the employee sees their payslip", async () => {
    const d = new Date();
    const period = new Date(d.getFullYear(), d.getMonth() - 2, 1);
    const run = await post("/hrm/payroll/runs", A.finance.token, { year: period.getFullYear(), month: period.getMonth() + 1 });
    assert.equal(run.status, 201, JSON.stringify(run.body));
    const id = run.body.data.id;
    const calc = await post(`/hrm/payroll/runs/${id}/calculate`, A.finance.token, {});
    assert.equal(calc.status, 200, JSON.stringify(calc.body));
    const detail = (await get(`/hrm/payroll/runs/${id}`, A.finance.token)).body.data;
    assert.ok(detail.payslips.length >= 6);
    assert.ok(detail.run.totals.netPay > 0);
    assert.equal((await post(`/hrm/payroll/runs/${id}/approve`, A.finance.token, {})).status, 200);
    assert.equal((await post(`/hrm/payroll/runs/${id}/finalize`, A.finance.token, {})).status, 200);
    const exportCsv = await get(`/hrm/payroll/runs/${id}/bank-export`, A.finance.token, { raw: true });
    assert.equal(exportCsv.status, 200);
    assert.match(exportCsv.text, /Account Number/);

    const mine = await get("/hrm/payroll/payslips/mine", A.employee.token);
    assert.equal(mine.status, 200);
    assert.ok(mine.body.data.some((p) => p.periodLabel === detail.run.periodLabel));
    // Nothing from this run appears in the other organization.
    const bRuns = (await get("/hrm/payroll/runs", B.admin.token)).body.data;
    assert.ok(!bRuns.some((r) => r.id === id));
  });
});

describe("documents, recruitment, reports, settings", () => {
  test("an employee uploads their own document and can open it; a colleague cannot", async () => {
    const form = new FormData();
    form.append("file", new Blob(["certificate"], { type: "text/plain" }), "cert.txt");
    form.append("purpose", "document");
    const up = await post("/hrm/files", A.employee.token, form);
    assert.equal(up.status, 201);
    const doc = await post("/hrm/documents/me", A.employee.token, {
      category: "certification",
      name: "First Aid Certificate",
      fileUrl: up.body.data.url,
      fileName: "cert.txt",
    });
    assert.equal(doc.status, 201, JSON.stringify(doc.body));
    const list = (await get("/hrm/documents", A.employee.token)).body.data;
    assert.ok(list.some((d) => d.name === "First Aid Certificate"));
    const fileId = up.body.data.id;
    assert.equal((await get(`/hrm/files/${fileId}`, A.employee.token, { raw: true })).status, 200);
    assert.equal((await get(`/hrm/files/${fileId}`, A.hr.token, { raw: true })).status, 200);
    assert.equal((await get(`/hrm/files/${fileId}`, A.manager.token, { raw: true })).status, 404);
  });

  test("hire an accepted applicant and give them a login in one step", async () => {
    const t = A.hr.token;
    const applicant = (await get("/hrm/recruitment/applicants?limit=50", t)).body.data[0];
    assert.equal((await post(`/hrm/recruitment/applicants/${applicant.id}/stage`, t, { stage: "Accepted" })).status, 200);
    const hired = await post(`/hrm/recruitment/applicants/${applicant.id}/convert`, t, { phone: "+2348035550101", provisionLogin: { role: "Employee" } });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    assert.equal(String(hired.body.data.organizationId), A.admin.session.organizationId);
    const users = (await get(`/users?search=${encodeURIComponent(applicant.email)}`, A.admin.token)).body.data;
    assert.equal(users.length, 1);
    assert.equal(users[0].role, "Employee");
  });

  test("HR report and overview load for the organization", async () => {
    const report = await get("/hrm/reports/hr", A.hr.token);
    assert.equal(report.status, 200);
    const overview = await get("/hrm/overview", A.hr.token);
    assert.equal(overview.status, 200);
    assert.ok(overview.body.data.headcount.total > 0);
  });

  test("settings changes stay within the organization", async () => {
    const res = await patch("/hrm/settings", A.hr.token, { lateGraceMinutes: 25 });
    assert.equal(res.status, 200);
    assert.equal((await get("/hrm/settings", A.hr.token)).body.data.settings.lateGraceMinutes, 25);
    assert.equal((await get("/hrm/settings", B.admin.token)).body.data.settings.lateGraceMinutes, 15);
  });

  test("an Org Admin updates the organization profile and brand colour", async () => {
    const res = await patch("/organization", A.admin.token, { brandColor: "teal", industry: "Software" });
    assert.equal(res.status, 200);
    const me = await get("/auth/me", A.admin.token);
    assert.equal(me.body.data.organization.brandColor, "teal");
    assert.equal(me.body.data.session.organizationBrandColor, "teal");
    // Code / status / payroll strategy are platform-managed — silently not accepted here.
    const sneaky = await patch("/organization", A.admin.token, { status: "inactive", code: "HACK" });
    assert.equal(sneaky.status, 200);
    const org = (await get("/organization", A.admin.token)).body.data.organization;
    assert.equal(org.status, "active");
    assert.equal(org.code, "ESIAT");
  });
});
