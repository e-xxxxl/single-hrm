import { HrDocument } from "../models/hrm/HrDocument.js";
import { PerformanceReview } from "../models/hrm/PerformanceReview.js";
import { Target } from "../models/hrm/Target.js";
import { Organization } from "../models/hrm/Organization.js";
import { notify } from "./notification.service.js";
import { logger } from "../utils/logger.js";
import { runWithTenant } from "../utils/tenantContext.js";
import { HR_ADMIN_ROLES } from "../utils/permissions.js";

const DAY = 86400000;

/**
 * Daily HR housekeeping: refresh derived statuses and fire threshold-based
 * notifications (contract expiry 30/14/7, reviews due, targets due). Idempotent
 * — each alert threshold fires at most once (tracked on the document / a marker).
 *
 * Each organization is processed inside its own tenant context, so every query
 * and notification for it is pinned to it (models/plugins/tenantScope.js) — a
 * bug here can't spill one organization's alerts into another's.
 */
export async function runDailyHrChecks({ organizationId } = {}) {
  const orgFilter = organizationId ? { _id: organizationId } : {};
  const orgs = await Organization.find({ ...orgFilter, status: "active" }).select("_id settings name");
  const report = { organizations: 0, documentAlerts: 0, reviewAlerts: 0, targetAlerts: 0 };

  for (const org of orgs) {
    report.organizations += 1;
    try {
      await runWithTenant(org._id, () => checkOrganization(org, report));
    } catch (err) {
      logger.warn(`[maintenance] HR checks failed for ${org.name}: ${err.message}`);
    }
  }

  logger.info(
    `[maintenance] HR checks — ${report.organizations} org(s), ` +
      `${report.documentAlerts} document, ${report.reviewAlerts} review, ${report.targetAlerts} target alerts`,
  );
  return report;
}

async function checkOrganization(org, report) {
  const thresholds = org.settings?.contractAlertDays?.length ? org.settings.contractAlertDays : [30, 14, 7];
  const prefs = org.settings?.notifications || {};

  // ---- Document expiry ----
  const docs = await HrDocument.find({
    organizationId: org._id,
    status: { $ne: "archived" },
    expiryDate: { $ne: null },
  }).populate("employee", "firstName lastName employeeId");

  for (const doc of docs) {
    const daysLeft = Math.ceil((doc.expiryDate - Date.now()) / DAY);
    doc.refreshStatus();
    let changed = doc.isModified("status");

    for (const t of thresholds) {
      if (daysLeft <= t && daysLeft >= 0 && !doc.alertsSent.includes(t)) {
        doc.alertsSent.push(t);
        changed = true;
        report.documentAlerts += 1;
        if (prefs.contractExpiry !== false) {
          await notify(org._id, {
            to: { roles: HR_ADMIN_ROLES },
            type: "contract.expiring",
            title: `Document expiring in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
            body: `${doc.name}${doc.employee ? ` — ${doc.employee.firstName} ${doc.employee.lastName}` : ""}`,
            link: `/hrm/documents?highlight=${doc._id}`,
          });
        }
      }
    }
    if (daysLeft < 0 && !doc.alertsSent.includes(0)) {
      doc.alertsSent.push(0);
      changed = true;
      report.documentAlerts += 1;
      if (prefs.contractExpiry !== false) {
        await notify(org._id, {
          to: { roles: HR_ADMIN_ROLES },
          type: "contract.expiring",
          title: "Document has expired",
          body: `${doc.name}${doc.employee ? ` — ${doc.employee.firstName} ${doc.employee.lastName}` : ""}`,
          link: `/hrm/documents?highlight=${doc._id}`,
        });
      }
    }
    if (changed) await doc.save();
  }

  // ---- Reviews due within 7 days ----
  const dueReviews = await PerformanceReview.find({
    organizationId: org._id,
    status: { $nin: ["completed", "acknowledged"] },
    dueDate: { $gte: new Date(), $lte: new Date(Date.now() + 7 * DAY) },
  }).populate("employee reviewer", "firstName lastName");
  for (const review of dueReviews) {
    if (!review.reviewer?._id) continue;
    report.reviewAlerts += 1;
    if (prefs.reviewDue === false) continue;
    await notify(org._id, {
      to: { employee: review.reviewer._id },
      type: "review.due",
      title: "Performance review due soon",
      body: `${review.cycle} review for ${review.employee?.firstName} ${review.employee?.lastName}`,
      link: `/hrm/performance/${review._id}`,
    });
  }

  // ---- Targets due within 3 days ----
  const dueTargets = await Target.find({
    organizationId: org._id,
    status: { $in: ["not_started", "in_progress", "at_risk"] },
    deadline: { $gte: new Date(), $lte: new Date(Date.now() + 3 * DAY) },
    employee: { $ne: null },
  }).select("title deadline employee");
  for (const target of dueTargets) {
    report.targetAlerts += 1;
    if (prefs.targetDeadline === false) continue;
    await notify(org._id, {
      to: { employee: target.employee },
      type: "target.deadline",
      title: "Target deadline approaching",
      body: `"${target.title}" is due ${new Date(target.deadline).toLocaleDateString("en-NG")}`,
      link: `/hrm/targets`,
    });
  }
}

let timer = null;
/** Start a lightweight in-process daily scheduler (dev / single-instance). */
export function startHrScheduler() {
  if (timer) return;
  const tick = () => {
    runDailyHrChecks().catch((err) => logger.error("[maintenance] failed:", err.message));
  };
  // First run 60s after boot, then every 24h.
  setTimeout(tick, 60_000).unref?.();
  timer = setInterval(tick, 24 * 60 * 60 * 1000);
  timer.unref?.();
}

export default { runDailyHrChecks, startHrScheduler };
