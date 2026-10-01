import * as service from "../services/notification.service.js";
import { catchAsync } from "../utils/catchAsync.js";

export const list = catchAsync(async (req, res) => {
  res.json(await service.listForUser(req.orgId, req.auth.userId, req.query));
});

export const unreadCount = catchAsync(async (req, res) => {
  res.json({ data: { unread: await service.unreadCount(req.orgId, req.auth.userId) } });
});

export const markRead = catchAsync(async (req, res) => {
  res.json({ data: await service.markRead(req.orgId, req.auth.userId, req.params.id) });
});

export const markAllRead = catchAsync(async (req, res) => {
  res.json({ data: await service.markAllRead(req.orgId, req.auth.userId) });
});

export default { list, unreadCount, markRead, markAllRead };
