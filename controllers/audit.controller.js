import * as service from "../services/audit.service.js";
import { catchAsync } from "../utils/catchAsync.js";

export const list = catchAsync(async (req, res) => {
  res.json(await service.listAudit(req.orgId, req.query));
});

export const facets = catchAsync(async (req, res) => {
  res.json({ data: await service.auditFacets(req.orgId) });
});

export default { list, facets };
