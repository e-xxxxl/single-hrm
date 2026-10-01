/**
 * Seed the platform's organizations.
 *
 * Always creates the Platform Admin and the four organizations
 *
 *   ESIAT  EsiatOptivest
 *   PWWE   PwweFoundation
 *   VMART  VendraMart
 *   SJI    SJI
 *
 * each with an Org Admin and the standard leave types — the same thing the
 * Platform Admin's "New organization" does.
 *
 * With `demo` (npm run dev:mem, the tests, or `npm run seed -- --demo`) every
 * organization additionally gets sample HR data — branches, departments,
 * employees with logins for every role, salaries, attendance, leave, documents
 * (with stored files), KPIs, reviews, targets, recruitment, a disciplinary case
 * and a calculated payroll run — all different per organization, so isolation
 * is easy to see. Everything is created through the real services, inside each
 * organization's tenant context (the same path a request takes).
 *
 * Without `demo` (a real database) no sample people are created; Org Admins
 * get a temporary password (SEED_PASSWORD, or a generated one printed here)
 * that they must change at first sign-in. Their email defaults to
 * admin@<slug>.local — override per organization with SEED_ADMIN_EMAIL_<CODE>
 * (e.g. SEED_ADMIN_EMAIL_ESIAT), or add the real administrators afterwards from
 * the platform console.
 *
 * Idempotent: an organization whose code already exists is left untouched.
 *
 *   npm run seed            # organizations + admins only
 *   npm run seed -- --demo  # plus sample HR data (development only)
 */
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { connectDatabase, closeDatabase } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { runWithTenant } from "../utils/tenantContext.js";
import { PLATFORM_ROLE, resolvePermissions } from "../utils/permissions.js";
import { dayKey } from "../utils/datetime.js";
import { Organization } from "../models/hrm/Organization.js";
import { User } from "../models/hrm/User.js";
import { getPlatformSettings } from "../models/hrm/PlatformSetting.js";
import * as platform from "../services/platform.service.js";
import * as branches from "../services/branch.service.js";
import * as departments from "../services/department.service.js";
import * as employees from "../services/employee.service.js";
import * as salary from "../services/salaryStructure.service.js";
import * as leave from "../services/leave.service.js";
import * as leaveTypes from "../services/leaveType.service.js";
import * as attendance from "../services/attendance.service.js";
import * as holidays from "../services/holiday.service.js";
import * as documents from "../services/document.service.js";
import * as performance from "../services/performance.service.js";
import * as targets from "../services/target.service.js";
import * as recruitment from "../services/recruitment.service.js";
import * as disciplinary from "../services/disciplinary.service.js";
import * as payroll from "../services/payroll.service.js";
import * as trainings from "../services/training.service.js";
import { saveUpload, fileRef } from "../services/file.service.js";
import { notify } from "../services/notification.service.js";

export const DEFAULT_DEV_PASSWORD = "Demo@12345";

/** The platform's organizations. Profile details beyond the name are left for each Org Admin to fill in. */
export const ORGANIZATIONS = [
  { name: "EsiatOptivest", code: "ESIAT", slug: "esiatoptivest", brandColor: "blue" },
  { name: "PwweFoundation", code: "PWWE", slug: "pwwefoundation", brandColor: "green" },
  { name: "VendraMart", code: "VMART", slug: "vendramart", brandColor: "orange" },
  { name: "SJI", code: "SJI", slug: "sji", brandColor: "purple" },
];

/**
 * Sample HR data per organization (demo mode only). Every organization gets
 * a login for each role at <role>@<slug>.test: admin, hr, hrstaff, finance,
 * manager (line manager of `employee`) and employee.
 */
const DEMO = {
  ESIAT: {
    payrollStrategy: "allowance-based",
    branches: [
      { name: "Lagos Head Office", code: "LOS", state: "Lagos", address: "Victoria Island, Lagos", latitude: 6.4281, longitude: 3.4219 },
      { name: "Abuja Office", code: "ABJ", state: "FCT - Abuja", address: "Wuse II, Abuja", latitude: 9.0765, longitude: 7.4731 },
    ],
    departments: ["Human Resources", "Finance", "Investments", "Client Services"],
    people: [
      { key: "admin", first: "Adaeze", last: "Okafor", position: "Chief Operating Officer", dept: "Human Resources", role: "Org Admin", gross: 1_200_000, gender: "Female" },
      { key: "hr", first: "Tunde", last: "Bakare", position: "HR Manager", dept: "Human Resources", role: "HR Manager", gross: 650_000, gender: "Male" },
      { key: "hrstaff", first: "Kemi", last: "Adeyemi", position: "HR Officer", dept: "Human Resources", role: "HR Staff", gross: 320_000, gender: "Female" },
      { key: "finance", first: "Ifeanyi", last: "Eze", position: "Finance Lead", dept: "Finance", role: "Finance", gross: 580_000, gender: "Male" },
      { key: "manager", first: "Musa", last: "Ibrahim", position: "Head of Investments", dept: "Investments", role: "Branch Manager", gross: 900_000, gender: "Male" },
      { key: "employee", first: "Chiamaka", last: "Nwosu", position: "Investment Analyst", dept: "Investments", role: "Employee", gross: 450_000, gender: "Female", manager: "manager" },
      { first: "Seun", last: "Ogunleye", position: "Portfolio Associate", dept: "Investments", gross: 380_000, gender: "Male", manager: "manager" },
      { first: "Halima", last: "Yusuf", position: "Client Relations Officer", dept: "Client Services", gross: 300_000, gender: "Female", branch: 1 },
    ],
    job: { title: "Senior Investment Analyst", dept: "Investments", applicant: "Olumide Ade" },
  },
  PWWE: {
    payrollStrategy: "fixed-monthly",
    branches: [{ name: "Ibadan Office", code: "IBD", state: "Oyo", address: "Bodija, Ibadan", latitude: 7.4125, longitude: 3.9107 }],
    departments: ["Administration", "Accounts", "Programs", "Outreach"],
    people: [
      { key: "admin", first: "Folake", last: "Adebayo", position: "Executive Director", dept: "Administration", role: "Org Admin", gross: 900_000, gender: "Female" },
      { key: "hr", first: "Samuel", last: "Oyelaran", position: "Head of Admin & HR", dept: "Administration", role: "HR Manager", gross: 520_000, gender: "Male" },
      { key: "hrstaff", first: "Ruth", last: "Ogundipe", position: "Admin Officer", dept: "Administration", role: "HR Staff", gross: 250_000, gender: "Female" },
      { key: "finance", first: "Daniel", last: "Akinola", position: "Accountant", dept: "Accounts", role: "Finance", gross: 400_000, gender: "Male" },
      { key: "manager", first: "Esther", last: "Olaniyan", position: "Programs Manager", dept: "Programs", role: "Branch Manager", gross: 600_000, gender: "Female" },
      { key: "employee", first: "Tobi", last: "Fashola", position: "Program Officer", dept: "Programs", role: "Employee", gross: 280_000, gender: "Male", manager: "manager" },
      { first: "Grace", last: "Olatunji", position: "Community Liaison", dept: "Outreach", gross: 220_000, gender: "Female", manager: "manager" },
    ],
    job: { title: "Monitoring & Evaluation Officer", dept: "Programs", applicant: "Bisi Alade" },
  },
  VMART: {
    payrollStrategy: "hybrid",
    branches: [
      { name: "Port Harcourt Store", code: "PHC", state: "Rivers", address: "Trans-Amadi, Port Harcourt", latitude: 4.8156, longitude: 7.0498 },
      { name: "Kano Warehouse", code: "KAN", state: "Kano", address: "Bompai Road, Kano", latitude: 12.0022, longitude: 8.592 },
    ],
    departments: ["People & Culture", "Accounts", "Store Operations", "Logistics"],
    people: [
      { key: "admin", first: "Emeka", last: "Obi", position: "Managing Director", dept: "People & Culture", role: "Org Admin", gross: 1_500_000, gender: "Male" },
      { key: "hr", first: "Blessing", last: "Etim", position: "Head of People", dept: "People & Culture", role: "HR Manager", gross: 700_000, gender: "Female" },
      { key: "hrstaff", first: "Yetunde", last: "Salami", position: "People Officer", dept: "People & Culture", role: "HR Staff", gross: 300_000, gender: "Female" },
      { key: "finance", first: "Garba", last: "Sani", position: "Chief Accountant", dept: "Accounts", role: "Finance", gross: 620_000, gender: "Male" },
      { key: "manager", first: "Ngozi", last: "Umeh", position: "Store Manager", dept: "Store Operations", role: "Branch Manager", gross: 520_000, gender: "Female" },
      { key: "employee", first: "Bola", last: "Akande", position: "Sales Associate", dept: "Store Operations", role: "Employee", gross: 210_000, gender: "Male", manager: "manager" },
      { first: "Aisha", last: "Bello", position: "Cashier", dept: "Store Operations", gross: 180_000, gender: "Female", manager: "manager" },
      { first: "Chidi", last: "Okonkwo", position: "Delivery Rider", dept: "Logistics", gross: 150_000, gender: "Male", branch: 1, commissionPerTrip: 1_500 },
      { first: "Fatima", last: "Lawal", position: "Warehouse Clerk", dept: "Logistics", gross: 170_000, gender: "Female", branch: 1 },
    ],
    job: { title: "Inventory Supervisor", dept: "Logistics", applicant: "Kunle Afolabi" },
  },
  SJI: {
    payrollStrategy: "fixed-monthly",
    branches: [{ name: "Enugu Campus", code: "ENU", state: "Enugu", address: "Independence Layout, Enugu", latitude: 6.4584, longitude: 7.5464 }],
    departments: ["Human Resources", "Bursary", "Academics", "Facilities"],
    people: [
      { key: "admin", first: "Nnamdi", last: "Eze", position: "Director", dept: "Human Resources", role: "Org Admin", gross: 1_000_000, gender: "Male" },
      { key: "hr", first: "Amaka", last: "Okeke", position: "HR Manager", dept: "Human Resources", role: "HR Manager", gross: 550_000, gender: "Female" },
      { key: "hrstaff", first: "Ijeoma", last: "Nnaji", position: "HR Assistant", dept: "Human Resources", role: "HR Staff", gross: 240_000, gender: "Female" },
      { key: "finance", first: "Obinna", last: "Chukwu", position: "Bursar", dept: "Bursary", role: "Finance", gross: 500_000, gender: "Male" },
      { key: "manager", first: "Chinwe", last: "Agu", position: "Head of Academics", dept: "Academics", role: "Branch Manager", gross: 650_000, gender: "Female" },
      { key: "employee", first: "Kelechi", last: "Onyema", position: "Lecturer", dept: "Academics", role: "Employee", gross: 350_000, gender: "Male", manager: "manager" },
      { first: "Uche", last: "Madu", position: "Facilities Officer", dept: "Facilities", gross: 200_000, gender: "Male" },
    ],
    job: { title: "Laboratory Technician", dept: "Academics", applicant: "Ebere Nwafor" },
  },
};
/** Split a gross into structure components appropriate for the org's strategy. */
function structureFor(strategy, gross) {
  if (strategy === "fixed-monthly") return { grossMonthly: gross, basic: 0 };
  return {
    basic: Math.round(gross * 0.5),
    housing: Math.round(gross * 0.25),
    transport: Math.round(gross * 0.15),
    dataAllowance: Math.round(gross * 0.1),
  };
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** `d` itself if it is a weekday, otherwise the following Monday. */
function weekdayOnOrAfter(d) {
  let x = new Date(d);
  while (x.getDay() === 0 || x.getDay() === 6) x = addDays(x, 1);
  return x;
}

/** The last `n` weekdays before today, oldest first. */
function recentWeekdays(n) {
  const out = [];
  let d = addDays(new Date(), -1);
  while (out.length < n) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) out.unshift(new Date(d));
    d = addDays(d, -1);
  }
  return out;
}

async function markSeededLogin(userId, password) {
  const user = await User.findById(userId).select("+passwordHash");
  await user.setPassword(password);
  user.mustChangePassword = false;
  await user.save();
}

/** Create one organization with its Org Admin; in demo mode, fill it with sample HR data. */
async function seedOrganization(org, platformAdmin, { password, demo }) {
  const exists = await Organization.findOne({ code: org.code });
  if (exists) {
    logger.info(`org ${org.code} already exists — skipped`);
    return { organization: exists };
  }

  if (!demo) {
    const email = (process.env[`SEED_ADMIN_EMAIL_${org.code}`] || `admin@${org.slug}.local`).toLowerCase();
    const { organization, admin } = await platform.createOrganization(
      { userId: platformAdmin._id },
      { ...org, admin: { name: `${org.name} Administrator`, email, password } },
    );
    // Temporary: the admin must choose their own password at first sign-in.
    logger.info(`organization ${organization.name} (${organization.code}) — Org Admin ${admin.email}`);
    return { organization, admin };
  }

  const domain = `${org.slug}.test`;
  const demoSpec = DEMO[org.code];
  const spec = {
    ...demoSpec,
    domain,
    org: { ...org, payrollStrategy: demoSpec.payrollStrategy, state: demoSpec.branches[0].state },
  };
  const adminPerson = spec.people.find((x) => x.key === "admin");
  const { organization } = await platform.createOrganization(
    { userId: platformAdmin._id },
    { ...spec.org, admin: { name: `${adminPerson.first} ${adminPerson.last}`, email: `admin@${domain}`, password } },
  );
  const orgId = organization._id;
  await runWithTenant(orgId, async () => {
    const adminUser = await User.findOne({ organizationId: orgId, email: `admin@${spec.domain}` });
    await markSeededLogin(adminUser._id, password);
    const actor = {
      userId: adminUser._id,
      name: adminUser.name,
      role: "Org Admin",
      permissions: resolvePermissions("Org Admin"),
    };

    const branchDocs = [];
    for (const b of spec.branches) branchDocs.push(await branches.createBranch(orgId, b));
    const deptDocs = {};
    for (const name of spec.departments) {
      deptDocs[name] = await departments.createDepartment(orgId, { name, code: name.slice(0, 3).toUpperCase() });
    }

    // ---- Employees (+ logins for everyone with a role) ----
    const people = {};
    const joined = addDays(new Date(), -420);
    let n = 0;
    for (const p of spec.people) {
      n += 1;
      const email = p.role ? `${p.key}@${spec.domain}` : `${p.first}.${p.last}@${spec.domain}`.toLowerCase();
      const { employee } = await employees.createEmployee(
        orgId,
        {
          firstName: p.first,
          lastName: p.last,
          email,
          phone: `+23480${String(spec.org.code.charCodeAt(0))}${String(1000000 + n).slice(1)}`,
          gender: p.gender,
          dateOfBirth: new Date(1985 + (n % 10), (n * 3) % 12, 5 + n),
          position: p.position,
          department: String(deptDocs[p.dept]._id),
          branch: String(branchDocs[p.branch || 0]._id),
          reportingManager: p.manager ? String(people[p.manager]._id) : undefined,
          employmentType: "Full-time",
          employmentStatus: "Active",
          dateJoined: addDays(joined, n * 7),
          contractEndDate: p.key === "employee" ? addDays(new Date(), 21) : undefined,
          bank: { bankName: "Demo Bank", accountNumber: String(1000000000 + n * 7919), accountName: `${p.first} ${p.last}` },
          taxState: spec.org.state === "FCT - Abuja" ? "FCT - Abuja" : spec.org.state,
        },
        actor,
      );
      if (p.role && p.role !== "Org Admin") {
        const { user } = await employees.provisionEmployeeLogin(orgId, employee, { role: p.role, password }, actor);
        await markSeededLogin(user._id, password);
      }
      await salary.setStructure(
        orgId,
        employee._id,
        { ...structureFor(spec.org.payrollStrategy, p.gross), commissionPerTrip: p.commissionPerTrip || 0, reason: "Initial salary" },
        actor.userId,
      );
      people[p.key || `p${n}`] = employee;
    }
    // Department heads
    await departments.updateDepartment(orgId, deptDocs[spec.departments[0]]._id, { head: String(people.hr._id) });
    await departments.updateDepartment(orgId, deptDocs[spec.departments[2]]._id, { head: String(people.manager._id) });

    const employeeActor = async (key) => {
      const u = await User.findOne({ organizationId: orgId, employee: people[key]._id });
      return { userId: u._id, name: u.name, role: u.role, permissions: resolvePermissions(u.role) };
    };

    // ---- Holidays ----
    const year = new Date().getFullYear();
    await holidays.createHoliday(orgId, actor, { name: "New Year's Day", date: new Date(year, 0, 1) });
    await holidays.createHoliday(orgId, actor, { name: "Independence Day", date: new Date(year, 9, 1) });
    await holidays.createHoliday(orgId, actor, { name: `${spec.org.code} Founders' Day`, date: new Date(year, 5, 15), recurringAnnually: true });

    // ---- Attendance: last 5 weekdays for everyone ----
    const days = recentWeekdays(5);
    for (const [i, e] of Object.values(people).entries()) {
      for (const [j, d] of days.entries()) {
        const late = (i + j) % 4 === 0;
        const inAt = new Date(d);
        inAt.setUTCHours(late ? 8 : 7, late ? 40 : 45, 0, 0);
        const outAt = new Date(d);
        outAt.setUTCHours(16, 5, 0, 0);
        await attendance.manualUpsert(orgId, actor.userId, {
          employee: e._id,
          dayKey: dayKey(d, "Africa/Lagos"),
          status: late ? "Late" : "Present",
          clockIn: { at: inAt },
          clockOut: { at: outAt },
          notes: "Seeded attendance",
        });
      }
    }

    // ---- Leave: one pending (self-service), one fully approved ----
    const types = await leaveTypes.listLeaveTypes(orgId, {});
    const annual = types.find((t) => t.category === "annual") || types[0];
    const casual = types.find((t) => t.category === "casual") || annual;
    const staffActor = await employeeActor("employee");
    const start = weekdayOnOrAfter(addDays(new Date(), 30));
    await leave.createRequest(orgId, staffActor, {
      leaveType: String(annual._id),
      startDate: start,
      endDate: addDays(start, 4),
      reason: "Family vacation",
    });
    const hrStaffActor = await employeeActor("hrstaff");
    const casualStart = weekdayOnOrAfter(addDays(new Date(), 10));
    const approved = await leave.createRequest(orgId, hrStaffActor, {
      leaveType: String(casual._id),
      startDate: casualStart,
      endDate: casualStart,
      reason: "Personal errands",
    });
    const hrActor = await employeeActor("hr");
    await leave.managerDecision(orgId, hrActor, approved.id, { action: "approve", comment: "OK" });
    await leave.hrDecision(orgId, hrActor, approved.id, { action: "approve", comment: "Enjoy", coverageOverride: true });

    // ---- Documents (with a real stored file) ----
    const contract = await saveUpload(
      orgId,
      {
        buffer: Buffer.from(`Employment contract — ${people.employee.firstName} ${people.employee.lastName}, ${spec.org.name}\n`),
        originalname: "employment-contract.txt",
        mimetype: "text/plain",
        size: 80,
      },
      { purpose: "document", userId: actor.userId },
    );
    await documents.createDocument(orgId, actor, {
      employee: people.employee._id,
      category: "contract",
      name: "Employment Contract",
      fileUrl: fileRef(contract._id),
      fileName: contract.originalName,
      fileType: contract.mimeType,
      fileSize: contract.size,
      issueDate: addDays(new Date(), -400),
      expiryDate: addDays(new Date(), 21),
    });
    const handbook = await saveUpload(
      orgId,
      { buffer: Buffer.from(`${spec.org.name} staff handbook\n`), originalname: "staff-handbook.txt", mimetype: "text/plain", size: 40 },
      { purpose: "document", userId: actor.userId },
    );
    await documents.createDocument(orgId, actor, {
      category: "hr_letter",
      name: `${spec.org.name} Staff Handbook`,
      fileUrl: fileRef(handbook._id),
      fileName: handbook.originalName,
      fileType: handbook.mimeType,
      fileSize: handbook.size,
    });

    // ---- Performance, targets, trainings ----
    const kpi = await performance.createKpi(orgId, { name: "Delivery quality", category: "Quality", unit: "%" });
    await performance.createKpi(orgId, { name: "Attendance rate", category: "Discipline", unit: "%" });
    await performance.createReview(orgId, actor, {
      employee: people.employee._id,
      reviewer: people.manager._id,
      cycle: `Q${Math.floor(new Date().getMonth() / 3) + 1} ${year}`,
      type: "quarterly",
      dueDate: addDays(new Date(), 5),
      kpis: [{ kpi: kpi._id, name: kpi.name, weight: 2, target: "95%" }],
    });
    await targets.createTarget(orgId, actor, {
      employee: String(people.employee._id),
      title: `${spec.job.dept} quarterly objectives`,
      targetValue: 100,
      baselineValue: 0,
      metricUnit: "%",
      startDate: addDays(new Date(), -30),
      deadline: addDays(new Date(), 60),
    });
    const training = await trainings.createTraining(orgId, actor.userId, { name: "Workplace Safety", category: "Compliance" });
    await trainings.recordAttendance(orgId, actor.userId, {
      employee: String(people.employee._id),
      training: String(training._id),
      dateAttended: addDays(new Date(), -60),
    });

    // ---- Recruitment ----
    const job = await recruitment.createJob(orgId, actor, {
      title: spec.job.title,
      department: deptDocs[spec.job.dept]._id,
      branch: branchDocs[0]._id,
      openings: 1,
      status: "open",
      description: `Join ${spec.org.name}.`,
    });
    await recruitment.addApplicant(orgId, actor, {
      jobPosting: job._id,
      name: spec.job.applicant,
      email: `${spec.job.applicant.split(" ")[0].toLowerCase()}@candidates.test`,
      source: "referral",
    });

    // ---- Disciplinary (restricted) ----
    const lastPerson = Object.values(people).at(-1);
    await disciplinary.createCase(orgId, actor, {
      employee: lastPerson._id,
      incidentDate: addDays(new Date(), -3),
      category: "attendance",
      severity: "minor",
      description: "Repeated late resumption without notice.",
    });

    // ---- Payroll: last month, calculated ----
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const run = await payroll.createRun(orgId, { year: prev.getFullYear(), month: prev.getMonth() + 1 }, actor);
    await payroll.calculateRun(orgId, run._id, actor);

    // ---- Notifications ----
    await notify(orgId, {
      to: { employee: people.employee._id },
      type: "general",
      title: `Welcome to ${spec.org.name}`,
      body: "Your HR self-service account is ready.",
      link: "/hrm/attendance",
    });
  });

  logger.info(`seeded organization ${spec.org.name} (${spec.org.code}) with demo HR data`);
  return { organization };
}

export async function seed({ password, demo = false } = {}) {
  const seedPassword =
    password ||
    env.seedPassword ||
    (() => {
      const generated = crypto.randomBytes(9).toString("base64url");
      logger.warn(`SEED_PASSWORD not set — generated a password for every seeded login: ${generated}`);
      return generated;
    })();

  await getPlatformSettings();

  // ---- Platform Admin ----
  const email = env.seedPlatformAdminEmail.toLowerCase().trim();
  let platformAdmin = await User.findOne({ email }).select("+passwordHash");
  if (!platformAdmin) {
    platformAdmin = new User({ name: "Platform Administrator", email, role: PLATFORM_ROLE, organizationId: null });
    await platformAdmin.setPassword(seedPassword);
    platformAdmin.mustChangePassword = !demo;
    await platformAdmin.save();
    logger.info(`created Platform Admin: ${email}`);
  }

  const organizations = [];
  for (const org of ORGANIZATIONS) {
    const { organization } = await seedOrganization(org, platformAdmin, { password: seedPassword, demo });
    organizations.push(organization);
  }

  return { platformAdmin, organizations, password: seedPassword };
}
// Run as a CLI when invoked directly.
if (process.argv[1]?.endsWith("seed.js")) {
  (async () => {
    try {
      await connectDatabase();
      await seed({ demo: process.argv.includes("--demo") });
      logger.info("seed complete");
      await closeDatabase();
      process.exit(0);
    } catch (err) {
      logger.error("seed failed:", err);
      await closeDatabase();
      process.exit(1);
    }
  })();
}
