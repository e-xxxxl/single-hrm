import { Router } from "express";
import authRoutes from "./auth.routes.js";
import platformRoutes from "./platform.routes.js";
import organizationRoutes from "./organization.routes.js";
import userRoutes from "./user.routes.js";
import publicRoutes from "./public.routes.js";
import branchRoutes from "./branch.routes.js";
import departmentRoutes from "./department.routes.js";
import employeeRoutes from "./employee.routes.js";
import hrOverviewRoutes from "./hrOverview.routes.js";
import attendanceRoutes from "./attendance.routes.js";
import leaveRoutes from "./leave.routes.js";
import holidayRoutes from "./holiday.routes.js";
import notificationRoutes from "./notification.routes.js";
import payrollRoutes from "./payroll.routes.js";
import loanRoutes from "./loan.routes.js";
import performanceRoutes from "./performance.routes.js";
import targetRoutes from "./target.routes.js";
import trainingRoutes from "./training.routes.js";
import referralRoutes from "./referral.routes.js";
import recruitmentRoutes from "./recruitment.routes.js";
import documentRoutes from "./document.routes.js";
import disciplinaryRoutes from "./disciplinary.routes.js";
import fileRoutes from "./file.routes.js";
import maintenanceRoutes from "./maintenance.routes.js";
import reportsRoutes from "./reports.routes.js";
import settingsRoutes from "./settings.routes.js";
import auditRoutes from "./audit.routes.js";

/**
 * Central router, attached under /api in server.js.
 *
 *   /auth            sign-in, refresh, 2FA, sessions         (any account)
 *   /platform/*      organizations, platform settings         (Platform Admin only)
 *   /organization    the caller's own organization profile    (organization users)
 *   /users           the caller's organization's logins       (organization users)
 *   /hrm/*           every HR module                          (organization users)
 *   /audit           the caller's organization's audit trail  (organization users)
 *   /public/*        public-by-design assets (org logos)      (no auth)
 *
 * Every organization route runs verifyToken → scopeToOrg, which takes the
 * organization from the authenticated user and pins it for the request.
 */
const api = Router();

api.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

api.use("/auth", authRoutes);
api.use("/platform", platformRoutes);
api.use("/organization", organizationRoutes);
api.use("/users", userRoutes);
api.use("/public", publicRoutes);

api.use("/hrm/branches", branchRoutes);
api.use("/hrm/departments", departmentRoutes);
api.use("/hrm/employees", employeeRoutes);
api.use("/hrm/overview", hrOverviewRoutes);
api.use("/hrm/attendance", attendanceRoutes);
api.use("/hrm/leave", leaveRoutes);
api.use("/hrm/holidays", holidayRoutes);
api.use("/hrm/notifications", notificationRoutes);
api.use("/hrm/payroll", payrollRoutes);
api.use("/hrm/loans", loanRoutes);
api.use("/hrm/performance", performanceRoutes);
api.use("/hrm/targets", targetRoutes);
api.use("/hrm/trainings", trainingRoutes);
api.use("/hrm/referrals", referralRoutes);
api.use("/hrm/recruitment", recruitmentRoutes);
api.use("/hrm/documents", documentRoutes);
api.use("/hrm/disciplinary", disciplinaryRoutes);
api.use("/hrm/files", fileRoutes);
api.use("/hrm/maintenance", maintenanceRoutes);
api.use("/hrm/reports", reportsRoutes);
api.use("/hrm/settings", settingsRoutes);
api.use("/audit", auditRoutes);

export default api;
