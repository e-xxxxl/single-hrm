/** Nigerian reference data used for validation and forms. */

export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
  "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo", "Jigawa",
  "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger",
  "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe",
  "Zamfara", "FCT - Abuja",
];

/** Pension Fund Administrators (subset of licensed PFAs). */
export const PFA_LIST = [
  "Access Pensions",
  "ARM Pension Managers",
  "AXA Mansard Pensions",
  "CrusaderSterling Pensions",
  "Fidelity Pension Managers",
  "FCMB Pensions",
  "Guaranty Trust Pension Managers",
  "Leadway Pensure",
  "NLPC Pension Fund Administrators",
  "Norrenberger Pensions",
  "NPF Pensions",
  "Premium Pension",
  "Stanbic IBTC Pension Managers",
  "Tangerine APT Pensions",
  "Trustfund Pensions",
  "Veritas Glanvills Pensions",
];

/** Loosely validate a Nigerian phone number (accepts +234 / 0 prefixes). */
export function isNigerianPhone(value) {
  return /^(?:\+?234|0)(?:70|71|80|81|90|91|70)\d{8}$/.test(String(value).replace(/[\s-]/g, ""));
}

/** Normalise a phone number to +234XXXXXXXXXX where possible. */
export function normalisePhone(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+234")) return digits;
  if (digits.startsWith("234")) return `+${digits}`;
  if (digits.startsWith("0")) return `+234${digits.slice(1)}`;
  return digits;
}

/** Validate an 11-digit National Identification Number. */
export function isValidNIN(value) {
  return /^\d{11}$/.test(String(value || "").trim());
}

/** Validate a 10-digit Bank Verification Number. */
export function isValidBVN(value) {
  return /^\d{11}$/.test(String(value || "").trim());
}
