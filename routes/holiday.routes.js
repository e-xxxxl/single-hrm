import { Router } from "express";
import * as ctrl from "../controllers/holiday.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { createHolidaySchema, updateHolidaySchema, holidayListQuerySchema } from "../utils/validators/holiday.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

const read = checkPermission("leave:read");
const write = checkPermission("leave:configure");

router.get("/", read, validate(holidayListQuerySchema, "query"), ctrl.list);
router.post("/", write, validate(createHolidaySchema), ctrl.create);
router.patch("/:id", write, validate(updateHolidaySchema), ctrl.update);
router.delete("/:id", write, ctrl.remove);

export default router;
