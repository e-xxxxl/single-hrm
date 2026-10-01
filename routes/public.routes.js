import { Router } from "express";
import * as org from "../controllers/organization.controller.js";

/**
 * Unauthenticated endpoints. Keep this list tiny: each one must expose only
 * data that is public by design.
 */
const router = Router();

// Organization logos render in <img> tags (no bearer token) — the logo is the
// only file ever served here, looked up via the organization's own `logoFile`.
router.get("/organizations/:id/logo", org.publicLogo);

export default router;
