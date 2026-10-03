/**
 * API security suite — authentication, cross-organization isolation (IDOR),
 * authorization per role, file access and platform/organization separation.
 *
 * Every attack is made by calling the API directly, not through the UI:
 * swapping ids in URLs, smuggling organizationId / foreign ids into bodies and
 * query strings, and replaying tokens after access is revoked.
 *
 *   npm test
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, login, get, post, patch, del, call, PASSWORD } from "./helpers.js";

const A = {}; // EsiatOptivest — the attacker's organization in most tests
const B = {}; // VendraMart — the victim organization

const ids = (list) => (list || []).map((x) => String(x.id));

before(async () => {
  await startApp();

  for (const [org, domain] of [
    [A, "esiatoptivest.test"],
    [B, "vendramart.test"],
  ]) {
    for (const role of ["admin", "hr", "hrstaff", "finance", "manager", "employee"]) {
      org[role] = await login(`${role}@${domain}`);
    }
    const t = org.admin.token;
    org.orgId = org.admin.session.organizationId;
    org.employees = (await get("/hrm/employees?limit=100", t)).body.data;
    org.departments = (await get("/hrm/departments?limit=100", t)).body.data;
    org.branches = (await get("/hrm/branches?limit=100", t)).body.data;
    org.leaveTypes = (await get("/hrm/leave/types", t)).body.data;
    org.leaveRequests = (await get("/hrm/leave/requests?limit=100", t)).body.data;
    org.runs = (await get("/hrm/payroll/runs", t)).body.data;
    org.run = (await get(`/hrm/payroll/runs/${org.runs[0].id}`, t)).body.data;
    org.documents = (await get("/hrm/documents?limit=100", t)).body.data;
    org.reviews = (await get("/hrm/performance/reviews?limit=100", t)).body.data;
    org.targets = (await get("/hrm/targets?limit=100", t)).body.data;
    org.jobs = (await get("/hrm/recruitment/jobs?limit=100", t)).body.data;
    org.cases = (await get("/hrm/disciplinary?limit=100", t)).body.data;
    org.users = (await get("/users?limit=100", t)).body.data;
    org.employeeRecord = org.employees.find((e) => e.email === `employee@${domain}`);
    org.contract = org.documents.find((d) => d.employee);
  }
  B.attendance = (await get("/hrm/attendance/records?limit=5", B.admin.token)).body.data;
  B.payslip = B.run.payslips[0];
  B.fileId = B.contract.fileUrl.split("/").pop();
  A.fileId = A.contract.fileUrl.split("/").pop();
});

after(async () => {
  await stopApp();
});

/* ------------------------------------------------------------------ */
describe("authentication", () => {
  test("rejects a wrong password and an unknown email with the same generic 401", async () => {
    const wrong = await post("/auth/login", null, { email: "admin@esiatoptivest.test", password: "nope-nope" });
    const unknown = await post("/auth/login", null, { email: "ghost@esiatoptivest.test", password: "nope-nope" });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
  });

  test("protected routes require a token and reject a forged one", async () => {
    assert.equal((await get("/hrm/employees")).status, 401);
    assert.equal((await get("/hrm/employees", "not-a-jwt")).status, 401);
    const [h, p] = A.admin.token.split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify({ userId: B.admin.user.id, organizationId: B.orgId, tv: 0 })).toString("base64url")}.${p}`;
    assert.equal((await get("/hrm/employees", tampered)).status, 401);
  });

  test("the session comes from the account — each user lands in their own organization", async () => {
    assert.equal(A.admin.session.organizationName, "EsiatOptivest");
    assert.equal(B.admin.session.organizationName, "VendraMart");
    assert.notEqual(A.orgId, B.orgId);
  });

  test("the legacy select-org / switch-org endpoints do not exist", async () => {
    const sel = await post("/auth/select-org", null, { userId: B.admin.user.id, organizationId: B.orgId });
    assert.equal(sel.status, 404);
    const sw = await post("/auth/switch-org", A.admin.token, { organizationId: B.orgId });
    assert.equal(sw.status, 404);
  });

  test("refresh rotates, logout revokes the refresh session", async () => {
    const s = await login("finance@esiatoptivest.test");
    const r1 = await call("POST", "/auth/refresh", { headers: { cookie: s.cookie } });
    assert.equal(r1.status, 200);
    const rotated = (r1.headers.get("set-cookie") || "").split(";")[0];
    // Replaying the old (rotated) refresh token is treated as theft: all sessions die.
    const replay = await call("POST", "/auth/refresh", { headers: { cookie: s.cookie } });
    assert.equal(replay.status, 401);
    const afterReplay = await call("POST", "/auth/refresh", { headers: { cookie: rotated } });
    assert.equal(afterReplay.status, 401);
    // …and the access token issued before the replay is dead too.
    assert.equal((await get("/hrm/payroll/runs", s.token)).status, 401);
    A.finance = await login("finance@esiatoptivest.test");
  });


});

/* ------------------------------------------------------------------ */
describe("organization isolation — reads", () => {
  test("lists only ever contain the caller's organization", async () => {
    const aIds = new Set(ids(A.employees));
    for (const id of ids(B.employees)) assert.ok(!aIds.has(id), "employee lists overlap");
    assert.ok(A.employees.every((e) => String(e.organizationId) === A.orgId));
    assert.ok(B.employees.every((e) => String(e.organizationId) === B.orgId));
    assert.ok(A.users.every((u) => String(u.organizationId) === A.orgId));
  });

  test("organizationId in the query string is ignored", async () => {
    const res = await get(`/hrm/employees?organizationId=${B.orgId}&limit=100`, A.admin.token);
    assert.equal(res.status, 200);
    assert.deepEqual(new Set(ids(res.body.data)), new Set(ids(A.employees)));
  });

  test("Mongo operators in the query string are neutralised", async () => {
    const res = await get("/hrm/employees?status[$ne]=zzz&limit=100", A.admin.token);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.every((e) => String(e.organizationId) === A.orgId));
  });

  const byId = [
    ["employee", (o) => `/hrm/employees/${o.employees[0].id}`],
    ["employee login", (o) => `/hrm/employees/${o.employeeRecord.id}/login`],
    ["department", (o) => `/hrm/departments/${o.departments[0].id}`],
    ["branch", (o) => `/hrm/branches/${o.branches[0].id}`],
    ["leave type", (o) => `/hrm/leave/types/${o.leaveTypes[0].id}`],
    ["leave request", (o) => `/hrm/leave/requests/${o.leaveRequests[0].id}`],
    ["leave balances", (o) => `/hrm/leave/balances/${o.employeeRecord.id}`],
    ["salary structure", (o) => `/hrm/payroll/structures/${o.employeeRecord.id}`],
    ["payroll run", (o) => `/hrm/payroll/runs/${o.runs[0].id}`],
    ["payslip", (o) => `/hrm/payroll/payslips/${o.run.payslips[0].id}`],
    ["payslip PDF", (o) => `/hrm/payroll/payslips/${o.run.payslips[0].id}/pdf`],
    // Own org gets 400 here only because the seeded run is not approved yet.
    ["document", (o) => `/hrm/documents/${o.documents[0].id}`],
    ["performance review", (o) => `/hrm/performance/reviews/${o.reviews[0].id}`],
    ["target", (o) => `/hrm/targets/${o.targets[0].id}`],
    ["job posting", (o) => `/hrm/recruitment/jobs/${o.jobs[0].id}`],
    ["disciplinary case", (o) => `/hrm/disciplinary/${o.cases[0].id}`],
    ["user", (o) => `/users/${o.users[0].id}`],
  ];

  for (const [name, path, ownStatus = 200] of byId) {
    test(`${name}: A's HR admin gets 404 for B's id, B's HR admin gets 200`, async () => {
      const attack = await get(path(B), A.admin.token, { raw: name.includes("PDF") || name.includes("export") });
      assert.equal(attack.status, 404, `${name} leaked across organizations (${attack.status})`);
      const own = await get(path(B), B.admin.token, { raw: true });
      assert.equal(own.status, ownStatus, `${name} not readable by its own organization (${own.status})`);
    });
  }

  test("filtering by another organization's employee returns nothing", async () => {
    const bEmp = B.employeeRecord.id;
    const att = await get(`/hrm/attendance/records?employee=${bEmp}`, A.admin.token);
    assert.equal(att.status, 200);
    assert.equal(att.body.data.length, 0);
    const leave = await get(`/hrm/leave/requests?employee=${bEmp}`, A.admin.token);
    assert.equal(leave.body.data.length, 0);
    const docs = await get(`/hrm/documents?employee=${bEmp}`, A.admin.token);
    assert.equal(docs.body.data.length, 0);
  });

  test("dashboards, reports and audit trails only count the caller's organization", async () => {
    const aOverview = (await get("/hrm/overview", A.admin.token)).body.data;
    const bOverview = (await get("/hrm/overview", B.admin.token)).body.data;
    assert.equal(aOverview.headcount.total, A.employees.length);
    assert.equal(bOverview.headcount.total, B.employees.length);
    const report = await get("/hrm/reports/hr", A.admin.token);
    assert.equal(report.status, 200);
    const audit = (await get("/audit?limit=200", A.admin.token)).body.data;
    assert.ok(audit.length > 0);
    assert.ok(audit.every((e) => String(e.organizationId) === A.orgId));
    const notes = (await get("/hrm/notifications", A.employee.token)).body.data;
    assert.ok(notes.every((n) => String(n.organizationId) === A.orgId));
  });

  test("own organization profile only — there is no way to address another", async () => {
    const own = await get("/organization", A.admin.token);
    assert.equal(own.body.data.organization.name, "EsiatOptivest");
    assert.equal((await get(`/organization/${B.orgId}`, A.admin.token)).status, 404);
    assert.equal((await get(`/organizations/${B.orgId}`, A.admin.token)).status, 404);
  });
});

/* ------------------------------------------------------------------ */
describe("organization isolation — writes", () => {
  test("updating / deleting another organization's records is 404 and changes nothing", async () => {
    const bEmp = B.employees[0];
    assert.equal((await patch(`/hrm/employees/${bEmp.id}`, A.admin.token, { position: "Pwned" })).status, 404);
    assert.equal((await patch(`/hrm/employees/${bEmp.id}/status`, A.admin.token, { status: "inactive" })).status, 404);
    assert.equal((await del(`/hrm/employees/${bEmp.id}`, A.admin.token)).status, 404);
    assert.equal((await patch(`/hrm/departments/${B.departments[0].id}`, A.admin.token, { name: "Pwned" })).status, 404);
    assert.equal((await del(`/hrm/branches/${B.branches[0].id}`, A.admin.token)).status, 404);
    assert.equal((await post(`/hrm/leave/requests/${B.leaveRequests[0].id}/cancel`, A.admin.token, {})).status, 404);
    assert.equal(
      (await post(`/hrm/leave/requests/${B.leaveRequests[0].id}/hr-decision`, A.admin.token, { action: "reject" })).status,
      404,
    );
    assert.equal((await post(`/hrm/payroll/runs/${B.runs[0].id}/approve`, A.admin.token, {})).status, 404);
    assert.equal((await del(`/hrm/payroll/runs/${B.runs[0].id}`, A.admin.token)).status, 404);
    assert.equal((await patch(`/users/${B.users[0].id}`, A.admin.token, { status: "suspended" })).status, 404);
    assert.equal((await post(`/users/${B.users[0].id}/reset-password`, A.admin.token, {})).status, 404);
    assert.equal((await post(`/hrm/employees/${B.employeeRecord.id}/login/reset-password`, A.admin.token, {})).status, 404);

    const still = await get(`/hrm/employees/${bEmp.id}`, B.admin.token);
    assert.equal(still.body.data.position, bEmp.position);
    assert.equal(still.body.data.status, "active");
    assert.equal((await get(`/users/${B.users[0].id}`, B.admin.token)).body.data.user.status, "active");
  });

  test("organizationId in a request body is ignored — records land in the caller's organization", async () => {
    const res = await post("/hrm/departments", A.admin.token, { name: "Smuggled Dept", organizationId: B.orgId });
    assert.equal(res.status, 201);
    assert.equal(String(res.body.data.organizationId), A.orgId);
    const bDepts = (await get("/hrm/departments?limit=100", B.admin.token)).body.data;
    assert.ok(!bDepts.some((d) => d.name === "Smuggled Dept"));
  });

  test("references to another organization's records are rejected (CROSS_TENANT_REFERENCE / 400)", async () => {
    const bEmp = B.employeeRecord.id;
    const head = await post("/hrm/departments", A.admin.token, { name: "Cross Ref Dept", head: bEmp });
    assert.equal(head.status, 400);
    const move = await patch(`/hrm/employees/${A.employeeRecord.id}`, A.admin.token, { department: B.departments[0].id });
    assert.equal(move.status, 400);
    const branchMgr = await patch(`/hrm/branches/${A.branches[0].id}`, A.admin.token, { manager: bEmp });
    assert.equal(branchMgr.status, 400);
    assert.equal(branchMgr.body.error.code, "CROSS_TENANT_REFERENCE");
    const leave = await post("/hrm/leave/requests", A.employee.token, {
      leaveType: B.leaveTypes[0].id,
      startDate: "2030-03-04",
      endDate: "2030-03-05",
      reason: "cross-org leave type",
    });
    assert.equal(leave.status, 400);
    const review = await post("/hrm/performance/reviews", A.admin.token, { employee: bEmp, cycle: "X 2030" });
    assert.equal(review.status, 404);
    const doc = await post("/hrm/documents", A.admin.token, {
      employee: bEmp,
      category: "other",
      name: "Cross-org document",
      fileUrl: `/hrm/files/${A.fileId}`,
    });
    assert.equal(doc.status, 400);
  });

  test("an Org Admin cannot create a login for another organization's employee or reuse their email", async () => {
    const dup = await post("/users", A.admin.token, { name: "Dup", email: "employee@vendramart.test", role: "Employee" });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, "EMAIL_TAKEN");
    const link = await post("/users", A.admin.token, {
      name: "Link",
      email: "link@esiatoptivest.test",
      role: "Employee",
      employee: B.employeeRecord.id,
    });
    assert.equal(link.status, 400);
  });
});

/* ------------------------------------------------------------------ */
describe("files", () => {
  test("another organization's file id is not found", async () => {
    assert.equal((await get(`/hrm/files/${B.fileId}`, A.admin.token, { raw: true })).status, 404);
    assert.equal((await get(`/hrm/files/${B.fileId}`, B.admin.token, { raw: true })).status, 200);
  });

  test("inside an organization, only people allowed to see the record can read the file", async () => {
    // The contract belongs to employee@esiatoptivest.test.
    const owner = await get(`/hrm/files/${A.fileId}`, A.employee.token, { raw: true });
    assert.equal(owner.status, 200);
    assert.match(owner.text, /Employment contract/);
    assert.equal((await get(`/hrm/files/${A.fileId}`, A.hr.token, { raw: true })).status, 200);
    // A colleague without document oversight guessing the id gets nothing.
    assert.equal((await get(`/hrm/files/${A.fileId}`, A.manager.token, { raw: true })).status, 404);
  });

  test("uploads are stored for the uploader's organization only; unknown purposes are refused", async () => {
    const form = new FormData();
    form.append("file", new Blob(["hello"], { type: "text/plain" }), "note.txt");
    form.append("purpose", "document");
    const up = await post("/hrm/files", A.employee.token, form);
    assert.equal(up.status, 201);
    const fileId = up.body.data.id;
    assert.equal((await get(`/hrm/files/${fileId}`, A.employee.token, { raw: true })).status, 200);
    assert.equal((await get(`/hrm/files/${fileId}`, B.admin.token, { raw: true })).status, 404);

    const bad = new FormData();
    bad.append("file", new Blob(["x"], { type: "text/plain" }), "x.txt");
    bad.append("purpose", "../../etc");
    assert.equal((await post("/hrm/files", A.employee.token, bad)).status, 400);

    const exe = new FormData();
    exe.append("file", new Blob(["MZ\x90\x00"], { type: "application/pdf" }), "evil.pdf");
    assert.equal((await post("/hrm/files", A.employee.token, exe)).status, 400);
  });
});

/* ------------------------------------------------------------------ */
describe("roles and permissions inside an organization", () => {
  test("an Employee reaches self-service only", async () => {
    const t = A.employee.token;
    assert.equal((await get("/hrm/employees", t)).status, 403);
    assert.equal((await get("/hrm/payroll/runs", t)).status, 403);
    assert.equal((await get("/users", t)).status, 403);
    assert.equal((await get("/audit", t)).status, 403);
    assert.equal((await get("/hrm/disciplinary", t)).status, 403);
    assert.equal((await get("/hrm/attendance/me", t)).status, 200);
    assert.equal((await get("/hrm/leave/me", t)).status, 200);
    assert.equal((await get("/hrm/payroll/payslips/mine", t)).status, 200);
  });

  test("an Employee cannot open a colleague's records by changing the id", async () => {
    const t = A.employee.token;
    const colleague = A.employees.find((e) => e.id !== A.employeeRecord.id);
    assert.equal((await get(`/hrm/leave/balances/${colleague.id}`, t)).status, 404);
    assert.equal((await get(`/hrm/leave/balances/${A.employeeRecord.id}`, t)).status, 200);
    const othersRequest = A.leaveRequests.find((r) => String(r.employee?.id ?? r.employee) !== A.employeeRecord.id);
    assert.equal((await get(`/hrm/leave/requests/${othersRequest.id}`, t)).status, 404);
    const othersSlip = A.run.payslips.find((p) => String(p.employee?.id ?? p.employee) !== A.employeeRecord.id);
    assert.equal((await get(`/hrm/payroll/payslips/${othersSlip.id}`, t)).status, 403);
    const ownSlip = A.run.payslips.find((p) => String(p.employee?.id ?? p.employee) === A.employeeRecord.id);
    assert.equal((await get(`/hrm/payroll/payslips/${ownSlip.id}`, t)).status, 200);
    const handbook = A.documents.find((d) => !d.employee);
    assert.equal((await get(`/hrm/documents/${handbook.id}`, t)).status, 200);
  });

  test("the line manager can see their report's review; an unrelated colleague cannot", async () => {
    const review = A.reviews[0];
    assert.equal((await get(`/hrm/performance/reviews/${review.id}`, A.manager.token)).status, 200);
    assert.equal((await get(`/hrm/performance/reviews/${review.id}`, A.employee.token)).status, 200);
    assert.equal((await get(`/hrm/performance/reviews/${review.id}`, A.finance.token)).status, 404);
  });

  test("Finance runs payroll; HR Staff does not", async () => {
    assert.equal((await get("/hrm/payroll/runs", A.finance.token)).status, 200);
    assert.equal((await get("/hrm/payroll/runs", A.hrstaff.token)).status, 403);
    assert.equal((await get("/hrm/employees", A.hrstaff.token)).status, 200);
  });

  test("only roles below your own can be granted; only the Org Admin can grant Org Admin", async () => {
    const byHr = await post("/users", A.hr.token, { name: "Esc", email: "esc@esiatoptivest.test", role: "Org Admin" });
    assert.equal(byHr.status, 403);
    const peer = await post("/users", A.hr.token, { name: "Peer", email: "peer@esiatoptivest.test", role: "HR Manager" });
    assert.equal(peer.status, 403);
    const hrStaffPromote = await patch(
      `/hrm/employees/${A.employees.find((e) => e.email === "hrstaff@esiatoptivest.test").id}/login`,
      A.hr.token,
      { role: "Org Admin" },
    );
    assert.equal(hrStaffPromote.status, 403);
    const byAdmin = await post("/users", A.admin.token, { name: "Second Admin", email: "admin2@esiatoptivest.test", role: "Org Admin" });
    assert.equal(byAdmin.status, 201);
    assert.ok(byAdmin.body.meta.tempPassword);
  });

  test("users cannot change their own role or status", async () => {
    const self = A.users.find((u) => u.email === "admin@esiatoptivest.test");
    assert.equal((await patch(`/users/${self.id}`, A.admin.token, { role: "Employee" })).status, 403);
    assert.equal((await patch(`/users/${self.id}`, A.admin.token, { status: "suspended" })).status, 403);
  });

  test("HR Manager can change roles of people below them — not an Org Admin, a peer, or themselves", async () => {
    const byEmail = (e) => A.users.find((u) => u.email === e);
    const finance = byEmail("finance@esiatoptivest.test");
    const up = await patch(`/users/${finance.id}`, A.hr.token, { role: "HR Staff" });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal(up.body.data.user.role, "HR Staff");
    assert.equal((await patch(`/users/${finance.id}`, A.hr.token, { role: "Finance" })).status, 200);

    // Same thing from the employee profile ("Change role / login").
    const emp = A.employeeRecord;
    const viaEmployee = await patch(`/hrm/employees/${emp.id}/login`, A.hr.token, { role: "Branch Manager" });
    assert.equal(viaEmployee.status, 200, JSON.stringify(viaEmployee.body));
    assert.equal(viaEmployee.body.data.role, "Branch Manager");
    assert.equal((await patch(`/hrm/employees/${emp.id}/login`, A.hr.token, { role: "Employee" })).status, 200);
    // The employee profile shows the access role.
    assert.equal((await get(`/hrm/employees/${emp.id}`, A.hr.token)).body.data.user.role, "Employee");

    // Not above or beside themselves.
    assert.equal((await patch(`/users/${byEmail("admin@esiatoptivest.test").id}`, A.hr.token, { role: "Employee" })).status, 403);
    assert.equal((await patch(`/users/${finance.id}`, A.hr.token, { role: "HR Manager" })).status, 403);
    assert.equal((await patch(`/users/${byEmail("hr@esiatoptivest.test").id}`, A.hr.token, { role: "Employee" })).status, 403);
    // HR Staff (no user:write) cannot.
    assert.equal((await patch(`/users/${finance.id}`, A.hrstaff.token, { role: "Employee" })).status, 403);
  });

  test("employee validation errors name the field; blank optional bank fields are accepted", async () => {
    const base = {
      firstName: "Vera",
      lastName: "Nwosu",
      email: "vera.nwosu@esiatoptivest.test",
      phone: "+2348031230000",
      position: "Analyst",
      dateJoined: "2026-01-05",
    };
    const short = await post("/hrm/employees", A.hr.token, { ...base, email: "short.phone@esiatoptivest.test", phone: "0803" });
    assert.equal(short.status, 422);
    assert.ok(short.body.error.details.some((d) => d.path === "phone" && /too short/.test(d.message)));
    const bad = await post("/hrm/employees", A.hr.token, { ...base, email: "bad.acct@esiatoptivest.test", bank: { bankName: "GTBank", accountNumber: "12345" } });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.error.details.some((d) => d.path === "bank.accountNumber" && /10 digits/.test(d.message)));
    const ok = await post("/hrm/employees", A.hr.token, { ...base, bank: { bankName: "GTBank", accountNumber: "", accountName: "" } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });

  test("destructive operations are Org-Admin-only", async () => {
    const victim = A.employees.find((e) => !e.user);
    assert.equal((await del(`/hrm/employees/${victim.id}`, A.hr.token)).status, 403);
    assert.equal((await post(`/hrm/payroll/runs/${A.runs[0].id}/reopen`, A.hr.token, {})).status, 403);
  });

  test("a role change applies to the very next request (no re-login)", async () => {
    const target = A.users.find((u) => u.email === "hrstaff@esiatoptivest.test");
    const s = await login("hrstaff@esiatoptivest.test");
    assert.equal((await get("/hrm/employees", s.token)).status, 200);
    assert.equal((await patch(`/users/${target.id}`, A.admin.token, { role: "Employee" })).status, 200);
    assert.equal((await get("/hrm/employees", s.token)).status, 403);
    assert.equal((await patch(`/users/${target.id}`, A.admin.token, { role: "HR Staff" })).status, 200);
    assert.equal((await get("/hrm/employees", s.token)).status, 200);
  });

  test("suspending a user ends their live session immediately", async () => {
    const target = A.users.find((u) => u.email === "finance@esiatoptivest.test");
    const s = await login("finance@esiatoptivest.test");
    assert.equal((await patch(`/users/${target.id}`, A.admin.token, { status: "suspended" })).status, 200);
    const denied = await get("/hrm/payroll/runs", s.token);
    assert.ok([401, 403].includes(denied.status));
    const relogin = await post("/auth/login", null, { email: "finance@esiatoptivest.test", password: PASSWORD });
    assert.equal(relogin.status, 403);
    assert.equal((await patch(`/users/${target.id}`, A.admin.token, { status: "active" })).status, 200);
    A.finance = await login("finance@esiatoptivest.test");
  });

  test("a temporary password must be changed before anything else", async () => {
    const created = await post("/users", A.admin.token, { name: "New Hire", email: "newhire@esiatoptivest.test", role: "Employee" });
    const temp = created.body.meta.tempPassword;
    const s = await login("newhire@esiatoptivest.test", temp);
    assert.equal(s.session.mustChangePassword, true);
    const blocked = await get("/hrm/attendance/me", s.token);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, "PASSWORD_CHANGE_REQUIRED");
    assert.equal(
      (await post("/auth/change-password", s.token, { currentPassword: temp, newPassword: "Brand-New#Pass1" })).status,
      200,
    );
    const fresh = await login("newhire@esiatoptivest.test", "Brand-New#Pass1");
    assert.equal(fresh.session.mustChangePassword, false);
    assert.notEqual((await get("/hrm/leave/me", fresh.token)).status, 403);
  });
});

/* ------------------------------------------------------------------ */
describe("platform administration", () => {
  let P;
  before(async () => {
    P = await login("platform@hrm.local");
  });

  test("the Platform Admin has no organization and cannot read any HR data", async () => {
    assert.equal(P.session.scope, "platform");
    assert.equal(P.session.organizationId, null);
    const res = await get("/hrm/employees", P.token);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "ORG_CONTEXT_REQUIRED");
    assert.equal((await get(`/hrm/employees/${B.employees[0].id}`, P.token)).status, 403);
    assert.equal((await get("/users", P.token)).status, 403);
  });

  test("organization users — even Org Admins — cannot reach platform routes", async () => {
    assert.equal((await get("/platform/organizations", A.admin.token)).status, 403);
    assert.equal((await patch(`/platform/organizations/${B.orgId}/status`, A.admin.token, { status: "inactive" })).status, 403);
    assert.equal((await post(`/platform/organizations/${B.orgId}/admins`, A.admin.token, { name: "X", email: "x@x.test" })).status, 403);
  });

  test("the platform lists organizations with head-counts only", async () => {
    const list = await get("/platform/organizations", P.token);
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 4);
    const detail = await get(`/platform/organizations/${A.orgId}`, P.token);
    assert.equal(detail.status, 200);
    assert.ok(detail.body.data.stats.activeEmployees > 0);
    assert.ok(detail.body.data.admins.every((a) => !("passwordHash" in a)));
  });

  test("deactivating an organization cuts off its live sessions; reactivating restores access", async () => {
    const live = await login("employee@vendramart.test");
    assert.equal((await get("/hrm/attendance/me", live.token)).status, 200);
    assert.equal((await patch(`/platform/organizations/${B.orgId}/status`, P.token, { status: "inactive", reason: "test" })).status, 200);
    const cut = await get("/hrm/attendance/me", live.token);
    assert.equal(cut.status, 403);
    assert.equal(cut.body.error.code, "ORG_INACTIVE");
    // New sign-ins are refused too.
    const signIn = await post("/auth/login", null, { email: "admin@vendramart.test", password: PASSWORD });
    assert.equal(signIn.status, 403);
    assert.equal(signIn.body.error.code, "ORG_INACTIVE");
    // Organization A is unaffected.
    assert.equal((await get("/hrm/attendance/me", A.employee.token)).status, 200);
    assert.equal((await patch(`/platform/organizations/${B.orgId}/status`, P.token, { status: "active" })).status, 200);
    assert.equal((await get("/hrm/attendance/me", live.token)).status, 200);
  });

  test("creating an organization creates its first Org Admin inside it, and nowhere else", async () => {
    const res = await post("/platform/organizations", P.token, {
      name: "Umbrella Ltd",
      code: "UMB",
      admin: { name: "Umbrella Admin", email: "admin@umbrella.test", password: "Umbrella#123" },
    });
    assert.equal(res.status, 201);
    const first = await login("admin@umbrella.test", "Umbrella#123");
    assert.equal(first.session.organizationName, "Umbrella Ltd");
    // A platform-issued password is temporary: it must be changed before use.
    assert.equal((await get("/hrm/employees", first.token)).status, 403);
    await post("/auth/change-password", first.token, { currentPassword: "Umbrella#123", newPassword: "Umbrella#456" });
    const u = await login("admin@umbrella.test", "Umbrella#456");
    assert.equal((await get("/hrm/employees", u.token)).body.data.length, 0);
    const types = await get("/hrm/leave/types", u.token);
    assert.ok(types.body.data.length > 0, "default leave types were not provisioned");
    // A duplicate code is refused.
    const dup = await post("/platform/organizations", P.token, {
      name: "Umbrella Two",
      code: "UMB",
      admin: { name: "Second Admin", email: "admin2@umbrella.test" },
    });
    assert.equal(dup.status, 409);
    // …and the failed attempt left no account behind.
    assert.equal((await post("/auth/login", null, { email: "admin2@umbrella.test", password: "whatever-123" })).status, 401);
  });

  test("a Platform Admin can enter, switch between and leave organizations without signing out", async () => {
    const s = await login("platform@hrm.local");
    const cookieOf = (res) => (res.headers.get("set-cookie") || "").split(";")[0];

    // Not entered yet: no HR access.
    assert.equal((await get("/hrm/employees", s.token)).status, 403);

    // Enter A.
    const toA = await post("/auth/enter-org", s.token, { organizationId: A.orgId }, { headers: { cookie: s.cookie } });
    assert.equal(toA.status, 200, JSON.stringify(toA.body));
    assert.equal(toA.body.data.session.actingAs, true);
    assert.equal(toA.body.data.session.organizationId, A.orgId);
    const tokA = toA.body.data.accessToken;
    const aList = await get("/hrm/employees?limit=100", tokA);
    const aNow = (await get("/hrm/employees?limit=100", A.admin.token)).body.data; // fresh: earlier tests add employees
    assert.deepEqual(new Set(ids(aList.body.data)), new Set(ids(aNow)));
    // Entered into A, B's records are still invisible.
    assert.equal((await get(`/hrm/employees/${B.employees[0].id}`, tokA)).status, 404);
    // Platform routes are closed while inside an organization.
    assert.equal((await get("/platform/organizations", tokA)).status, 403);

    // Work inside A (a record with `createdBy` = the platform user must save fine).
    const dept = await post("/hrm/departments", tokA, { name: "Entered Dept" });
    assert.equal(dept.status, 201, JSON.stringify(dept.body));

    // Switch to B without signing out.
    const toB = await post("/auth/enter-org", tokA, { organizationId: B.orgId }, { headers: { cookie: s.cookie } });
    assert.equal(toB.status, 200);
    const tokB = toB.body.data.accessToken;
    const bList = await get("/hrm/employees?limit=100", tokB);
    const bNow = (await get("/hrm/employees?limit=100", B.admin.token)).body.data;
    assert.deepEqual(new Set(ids(bList.body.data)), new Set(ids(bNow)));
    assert.equal((await get(`/hrm/employees/${A.employees[0].id}`, tokB)).status, 404);

    // The entered organization survives a token refresh (page reload).
    const refreshed = await call("POST", "/auth/refresh", { headers: { cookie: s.cookie } });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.data.session.organizationId, B.orgId);
    assert.equal(refreshed.body.data.session.actingAs, true);
    const cookie2 = cookieOf(refreshed);

    // A's audit trail records who really acted.
    const audit = (await get("/audit?limit=100", A.admin.token)).body.data;
    assert.ok(audit.some((e) => e.action === "department.create" && e.actorRole === "Platform Admin"));
    assert.ok(audit.some((e) => e.action === "platform.enter_organization"));

    // Leave: back to the console, HR closed again.
    const out = await post("/auth/exit-org", refreshed.body.data.accessToken, {}, { headers: { cookie: cookie2 } });
    assert.equal(out.status, 200);
    assert.equal(out.body.data.session.actingAs, false);
    assert.equal(out.body.data.session.scope, "platform");
    assert.equal((await get("/platform/organizations", out.body.data.accessToken)).status, 200);
    assert.equal((await get("/hrm/employees", out.body.data.accessToken)).status, 403);
    const afterRefresh = await call("POST", "/auth/refresh", { headers: { cookie: cookie2 } });
    assert.equal(afterRefresh.body.data.session.actingAs, false);
  });

  test("only the Platform Admin can enter an organization", async () => {
    const res = await post("/auth/enter-org", A.admin.token, { organizationId: B.orgId }, { headers: { cookie: A.admin.cookie } });
    assert.equal(res.status, 403);
    assert.equal((await get("/auth/organizations", A.admin.token)).status, 403);
    assert.equal((await post("/auth/exit-org", A.hr.token, {})).status, 403);
  });

  test("an organization's last active Org Admin cannot be suspended", async () => {
    const detail = (await get(`/platform/organizations/${B.orgId}`, P.token)).body.data;
    assert.equal(detail.admins.length, 1);
    const res = await patch(`/platform/organizations/${B.orgId}/admins/${detail.admins[0].id}/status`, P.token, {
      status: "suspended",
    });
    assert.equal(res.status, 400);
    // An admin id from a different organization is not found under this one.
    const aAdmins = (await get(`/platform/organizations/${A.orgId}`, P.token)).body.data.admins;
    const cross = await patch(`/platform/organizations/${B.orgId}/admins/${aAdmins[0].id}/status`, P.token, {
      status: "suspended",
    });
    assert.equal(cross.status, 404);
  });

  test("platform actions are audited in the platform activity log", async () => {
    const log = await get("/platform/audit", P.token);
    assert.equal(log.status, 200);
    assert.ok(log.body.data.some((e) => e.action === "organization.deactivate"));
  });
});
