import { z } from "zod";
import { NIGERIAN_STATES, PFA_LIST } from "../nigeria.js";
import { ORG_ROLES } from "../permissions.js";
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_STATUSES,
  GENDERS,
  MARITAL_STATUSES,
} from "../../models/hrm/Employee.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");
const optionalDate = z.coerce.date().optional();

const emergencyContact = z
  .object({
    name: z.string().max(120).optional(),
    relationship: z.string().max(60).optional(),
    phone: z.string().max(30).optional(),
    address: z.string().max(300).optional(),
  })
  .partial();

const bank = z
  .object({
    bankName: z.string().max(120).optional(),
    accountNumber: z.string().regex(/^\d{10}$/,"NUBAN account numbers are 10 digits").optional(),
    accountName: z.string().max(160).optional(),
  })
  .partial();

const pension = z
  .object({
    pfaName: z.enum([...PFA_LIST, ""]).optional(),
    pfaPin: z.string().max(40).optional(),
  })
  .partial();

export const createEmployeeSchema = z.object({
  employeeId: z.string().max(30).optional(),

  firstName: z.string().min(1).max(80),
  middleName: z.string().max(80).optional(),
  lastName: z.string().min(1).max(80),
  email: z.string().email(),
  phone: z.string().min(7).max(30),
  altPhone: z.string().max(30).optional(),
  dateOfBirth: optionalDate,
  gender: z.enum(GENDERS).optional(),
  maritalStatus: z.enum(MARITAL_STATUSES).optional(),
  nationality: z.string().max(60).optional(),
  stateOfOrigin: z.enum(NIGERIAN_STATES).optional(),
  lga: z.string().max(80).optional(),
  residentialAddress: z.string().max(300).optional(),
  residentialState: z.enum(NIGERIAN_STATES).optional(),
  photoUrl: z.string().max(400).optional(),
  nin: z.string().regex(/^\d{11}$/,"NIN is 11 digits").optional(),
  bvn: z.string().regex(/^\d{11}$/,"BVN is 11 digits").optional(),
  emergencyContact: emergencyContact.optional(),

  position: z.string().min(2).max(120),
  grade: z.string().max(40).optional(),
  department: objectId.optional(),
  branch: objectId.optional(),
  reportingManager: objectId.optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
  dateJoined: z.coerce.date(),
  confirmationDate: optionalDate,
  probationEndDate: optionalDate,
  contractEndDate: optionalDate,

  bank: bank.optional(),
  pension: pension.optional(),
  taxId: z.string().max(40).optional(),
  taxState: z.enum(NIGERIAN_STATES).optional(),

  // Optionally create a platform login for this employee at the same time.
  provisionLogin: z
    .object({
      role: z.enum(ORG_ROLES),
      password: z.string().min(8).max(128).optional(),
    })
    .optional(),
});

export const updateEmployeeSchema = createEmployeeSchema
  .partial()
  .extend({
    exitDate: optionalDate,
    exitReason: z.string().max(300).optional(),
  });

export const employeeStatusSchema = z.object({
  status: z.enum(["active", "inactive"]),
  reason: z.string().max(300).optional(),
});

export default { createEmployeeSchema, updateEmployeeSchema, employeeStatusSchema };
