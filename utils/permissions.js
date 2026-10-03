/**
 * Role → permission matrix.
 *
 * Permissions are plain `resource:action` strings. The authenticated request
 * carries the effective permission list for the user (recomputed from the
 * database on every request — see middleware/auth.js); middleware checks
 * membership against that list.
 *
 * There are two scopes and no role spans both:
 *   • Platform — "Platform Admin" manages organizations and platform settings.
 *     It holds only `platform:*` permissions and has no organization, so every
 *     organization-scoped route (scopeToOrg) refuses it. It can see that an
 *     organization exists and how big it is, never its HR records.
 *   • Organization — every other role acts inside exactly one organization,
 *     the one stored on the user record (never one named by the request).
 *
 * Roles are ordered highest-authority first. `roleRank()` is used where a
 * numeric comparison is needed (e.g. who may grant which role).
 */

export const PLATFORM_ROLE = "Platform Admin";
export const ORG_ADMIN_ROLE = "Org Admin";

export const ORG_ROLES = ["Org Admin", "HR Manager", "HR Staff", "Finance", "Branch Manager", "Employee"];
export const ROLES = [PLATFORM_ROLE, ...ORG_ROLES];

/** Roles allowed to perform destructive HR housekeeping (delete a department, a leave type, …). */
export const HR_ADMIN_ROLES = ["Org Admin", "HR Manager"];

export function roleRank(role) {
  const i = ROLES.indexOf(role);
  return i === -1 ? ROLES.length : i;
}

/** All known permissions, grouped for readability. */
export const PERMISSIONS = {
  // Platform administration (Platform Admin only)
  platform: ["platform:read", "platform:write"],

  // Organization profile, users & configuration
  org: ["org:read", "org:write"],
  user: ["user:read", "user:write"],
  settings: ["settings:read", "settings:write"],
  audit: ["audit:read"],

  // People
  employee: ["employee:read", "employee:write", "employee:deactivate", "employee:read_sensitive"],
  department: ["department:read", "department:write"],
  branch: ["branch:read", "branch:write"],

  // Attendance
  attendance: ["attendance:read", "attendance:clock", "attendance:manage", "attendance:report"],

  // Leave
  leave: ["leave:read", "leave:request", "leave:approve_manager", "leave:approve_hr", "leave:configure"],

  // Payroll
  payroll: [
    "payroll:read",
    "payroll:read_own",
    "payroll:run",
    "payroll:approve",
    "payroll:export",
    "payroll:configure",
  ],

  // Performance & targets
  performance: ["performance:read", "performance:write", "performance:review"],
  target: ["target:read", "target:write", "target:update_progress"],

  // Recruitment
  recruitment: ["recruitment:read", "recruitment:write", "recruitment:move_stage"],

  // Documents
  document: ["document:read", "document:write", "document:write_own", "document:delete"],

  // Trainings
  training: ["training:read", "training:write"],

  // Disciplinary (restricted)
  disciplinary: ["disciplinary:read", "disciplinary:write"],

  // Notifications & reports
  notification: ["notification:read"],
  report: ["report:hr", "report:finance"],
};

/** Flattened list of every permission string. */
export const ALL_PERMISSIONS = Object.values(PERMISSIONS).flat();

/** Every permission that can be held inside an organization. */
export const ORG_PERMISSIONS = ALL_PERMISSIONS.filter((p) => !p.startsWith("platform:"));

const P = PERMISSIONS;

/** What every signed-in employee can do for themselves. */
const SELF_SERVICE = [
  "org:read",
  "notification:read",
  "attendance:read",
  "attendance:clock",
  "leave:read",
  "leave:request",
  "payroll:read_own",
  "performance:read",
  "target:read",
  "target:update_progress",
  "document:read",
  "document:write_own",
  "training:read",
];

/**
 * Base permission sets per role. The lists are explicit so an audit can read
 * exactly what each role can do. No role holds a wildcard.
 */
export const ROLE_PERMISSIONS = {
  "Platform Admin": [...P.platform],

  "Org Admin": [...ORG_PERMISSIONS],

  "HR Manager": [
    "org:read",
    // HR can create logins and change roles — but only for roles below HR Manager
    // (see assignableRoles / user.service.js); Org Admin and peers stay protected.
    ...P.user,
    ...P.settings,
    ...P.audit,
    ...P.employee,
    ...P.department,
    ...P.branch,
    ...P.attendance,
    ...P.leave,
    // Full payroll access except deleting / reopening a finalized run, which
    // stays Org-Admin-only (requireRole(ORG_ADMIN_ROLE) in payroll.routes.js).
    ...P.payroll,
    ...P.performance,
    ...P.target,
    ...P.recruitment,
    ...P.document,
    ...P.training,
    ...P.disciplinary,
    "notification:read",
    "report:hr",
  ],

  "HR Staff": [
    ...SELF_SERVICE,
    "employee:read",
    "employee:write",
    "department:read",
    "branch:read",
    "attendance:manage",
    "attendance:report",
    "recruitment:read",
    "recruitment:write",
    "recruitment:move_stage",
    "document:write",
    "report:hr",
  ],

  Finance: [
    ...SELF_SERVICE,
    "employee:read",
    "employee:read_sensitive",
    "department:read",
    "branch:read",
    ...P.payroll,
    "report:hr",
    "report:finance",
  ],

  "Branch Manager": [
    ...SELF_SERVICE,
    "employee:read",
    "department:read",
    "branch:read",
    "attendance:report",
    "leave:approve_manager",
  ],

  Employee: [...SELF_SERVICE],
};

/**
 * Resolve the effective permission list for a role plus any per-user
 * overrides (grants / revokes). Overrides can never cross scopes: an
 * organization user can't be granted a platform permission and vice versa.
 */
export function resolvePermissions(role, { grant = [], revoke = [] } = {}) {
  const base = ROLE_PERMISSIONS[role];
  if (!base) return [];
  const allowed = role === PLATFORM_ROLE ? P.platform : ORG_PERMISSIONS;
  const set = new Set([...base, ...grant.filter((p) => allowed.includes(p))]);
  for (const r of revoke) set.delete(r);
  return [...set];
}

/** True when `permissions` contains `required`. */
export function hasPermission(permissions, required) {
  if (!Array.isArray(permissions)) return false;
  return permissions.includes(required);
}

/**
 * Roles the actor may hand out inside their organization: an Org Admin may
 * grant any organization role; anyone else only roles strictly below their
 * own (so an HR Manager can't mint an Org Admin, or another HR Manager).
 */
export function assignableRoles(actorRole) {
  if (actorRole === ORG_ADMIN_ROLE) return [...ORG_ROLES];
  const rank = roleRank(actorRole);
  return ORG_ROLES.filter((r) => roleRank(r) > rank);
}

export default {
  PLATFORM_ROLE,
  ORG_ADMIN_ROLE,
  ORG_ROLES,
  ROLES,
  HR_ADMIN_ROLES,
  roleRank,
  PERMISSIONS,
  ALL_PERMISSIONS,
  ORG_PERMISSIONS,
  ROLE_PERMISSIONS,
  resolvePermissions,
  hasPermission,
  assignableRoles,
};
