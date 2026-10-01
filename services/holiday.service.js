import { Holiday } from "../models/hrm/Holiday.js";
import { AppError } from "../utils/AppError.js";

export async function listHolidays(orgId, query = {}) {
  const filter = { organizationId: orgId };
  if (query.year) {
    const y = Number(query.year);
    filter.date = { $gte: new Date(y, 0, 1), $lte: new Date(y, 11, 31, 23, 59, 59) };
  }
  return Holiday.find(filter).sort({ date: 1 });
}

export async function createHoliday(orgId, actor, input) {
  return Holiday.create({
    organizationId: orgId,
    name: input.name,
    date: input.date,
    recurringAnnually: input.recurringAnnually ?? true,
    notes: input.notes,
    createdBy: actor.userId,
  });
}

export async function updateHoliday(orgId, id, input) {
  const editable = ["name", "date", "recurringAnnually", "notes"];
  const $set = {};
  for (const f of editable) if (input[f] !== undefined) $set[f] = input[f];
  const holiday = await Holiday.findOneAndUpdate({ _id: id, organizationId: orgId }, { $set }, { new: true, runValidators: true });
  if (!holiday) throw AppError.notFound("Holiday not found");
  return holiday;
}

export async function deleteHoliday(orgId, id) {
  const res = await Holiday.deleteOne({ _id: id, organizationId: orgId });
  if (res.deletedCount === 0) throw AppError.notFound("Holiday not found");
  return { ok: true };
}

/**
 * Holidays falling within [from, to], shaped as calendar-ready single-day
 * items. Recurring holidays are re-anchored onto every year the window
 * touches — a holiday created once continues showing up every year without
 * HR having to re-enter it.
 */
export async function holidaysInRange(orgId, from, to) {
  const holidays = await Holiday.find({ organizationId: orgId });
  const years = new Set([from.getFullYear(), to.getFullYear()]);
  const items = [];

  for (const h of holidays) {
    if (h.recurringAnnually) {
      for (const year of years) {
        const occurrence = new Date(year, h.date.getMonth(), h.date.getDate());
        if (occurrence >= from && occurrence <= to) {
          items.push(toCalendarItem(h, occurrence));
        }
      }
    } else if (h.date >= from && h.date <= to) {
      items.push(toCalendarItem(h, h.date));
    }
  }
  return items;
}

function toCalendarItem(holiday, occurrence) {
  const iso = occurrence.toISOString().slice(0, 10);
  return {
    id: `${holiday._id}:${iso}`,
    kind: "holiday",
    name: holiday.name,
    startDate: iso,
    endDate: iso,
  };
}

export default { listHolidays, createHoliday, updateHoliday, deleteHoliday, holidaysInRange };
