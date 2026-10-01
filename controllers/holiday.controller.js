import * as service from "../services/holiday.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";

export const list = catchAsync(async (req, res) => {
  res.json({ data: await service.listHolidays(req.orgId, req.query) });
});

export const create = catchAsync(async (req, res) => {
  const holiday = await service.createHoliday(req.orgId, req.auth, req.body);
  await recordAudit(req, {
    action: "holiday.create",
    entityType: "Holiday",
    entityId: holiday._id,
    entityLabel: holiday.name,
    summary: `Added holiday "${holiday.name}"`,
  });
  res.status(201).json({ data: holiday });
});

export const update = catchAsync(async (req, res) => {
  const holiday = await service.updateHoliday(req.orgId, req.params.id, req.body);
  await recordAudit(req, {
    action: "holiday.update",
    entityType: "Holiday",
    entityId: holiday._id,
    entityLabel: holiday.name,
    summary: `Updated holiday "${holiday.name}"`,
  });
  res.json({ data: holiday });
});

export const remove = catchAsync(async (req, res) => {
  await service.deleteHoliday(req.orgId, req.params.id);
  await recordAudit(req, {
    action: "holiday.delete",
    entityType: "Holiday",
    entityId: req.params.id,
    summary: "Deleted a holiday",
  });
  res.json({ data: { ok: true } });
});

export default { list, create, update, remove };
