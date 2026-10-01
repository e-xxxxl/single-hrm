import { Router } from "express";
import * as ctrl from "../controllers/notification.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";

const router = Router();
router.use(verifyToken, scopeToOrg, checkPermission("notification:read"));

router.get("/", ctrl.list);
router.get("/unread-count", ctrl.unreadCount);
router.patch("/:id/read", ctrl.markRead);
router.post("/read-all", ctrl.markAllRead);

export default router;
