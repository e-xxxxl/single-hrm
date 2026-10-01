/**
 * Nigerian payroll statutory calculations — PAYE (Personal Income Tax) and
 * pension, per the Nigeria Tax Act 2025 (effective January 2026): the old
 * Consolidated Relief Allowance + 7-band graduated table was replaced with a
 * flat ₦800,000 annual tax-free threshold and these bands on the remainder:
 *
 *   ≤ 800,000                 0%
 *   800,000 – 3,000,000      15%
 *   3,000,000 – 12,000,000   18%
 *   12,000,000 – 25,000,000  21%
 *   25,000,000 – 50,000,000  23%
 *   > 50,000,000              25%
 *
 * Company policy: the computed tax is split 50/50 — half is deducted from the
 * employee's pay, half is absorbed by the employer (still remitted in full).
 *
 * All helpers work in Naira. Callers pass ANNUAL figures to computePAYE and
 * divide the result by 12 for a monthly run.
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Graduated annual tax bands on taxable income: [bandWidth, rate]. Last band is open-ended. */
const BANDS = [
  [800_000, 0],
  [2_200_000, 0.15], // up to 3,000,000
  [9_000_000, 0.18], // up to 12,000,000
  [13_000_000, 0.21], // up to 25,000,000
  [25_000_000, 0.23], // up to 50,000,000
  [Infinity, 0.25],
];

/**
 * @param grossAnnual        total annual taxable emoluments
 * @param pensionAnnual      employee pension contribution (tax-deductible)
 * @param nhfAnnual          National Housing Fund contribution (tax-deductible)
 * @param otherReliefsAnnual any additional statutory reliefs (life assurance…)
 * @returns { taxableIncome, annualTax, monthlyTax, employeeAnnualTax, employeeMonthlyTax,
 *            employerAnnualTax, employerMonthlyTax, effectiveRate, breakdown }
 */
export function computePAYE(grossAnnual, { pensionAnnual = 0, nhfAnnual = 0, otherReliefsAnnual = 0 } = {}) {
  const gross = Math.max(0, grossAnnual);
  const reliefs = pensionAnnual + nhfAnnual + otherReliefsAnnual;
  const taxableIncome = Math.max(0, round2(gross - reliefs));

  let remaining = taxableIncome;
  let annualTax = 0;
  const breakdown = [];
  for (const [width, rate] of BANDS) {
    if (remaining <= 0) break;
    const slice = Math.min(remaining, width);
    const tax = slice * rate;
    if (rate > 0) breakdown.push({ amount: round2(slice), rate, tax: round2(tax) });
    annualTax += tax;
    remaining -= slice;
  }
  annualTax = round2(annualTax);

  // Company policy: employee bears half the computed tax, employer the rest.
  const employeeAnnualTax = round2(annualTax / 2);
  const employerAnnualTax = round2(annualTax - employeeAnnualTax);

  return {
    grossAnnual: round2(gross),
    taxableIncome,
    annualTax,
    monthlyTax: round2(annualTax / 12),
    employeeAnnualTax,
    employeeMonthlyTax: round2(employeeAnnualTax / 12),
    employerAnnualTax,
    employerMonthlyTax: round2(employerAnnualTax / 12),
    effectiveRate: gross > 0 ? round2((annualTax / gross) * 100) : 0,
    breakdown,
  };
}

/**
 * Contributory Pension Scheme. Employee 8%, employer 10% of the pensionable
 * base (basic + housing + transport). Only the employee share is deducted from
 * net pay; the employer share is reported for remittance.
 */
export function computePension(pensionableMonthly, { employeeRate = 0.08, employerRate = 0.1 } = {}) {
  const base = Math.max(0, pensionableMonthly);
  return {
    pensionableBase: round2(base),
    employee: round2(base * employeeRate),
    employer: round2(base * employerRate),
    total: round2(base * (employeeRate + employerRate)),
  };
}

/** National Housing Fund — 2.5% of basic salary (optional per employee). */
export function computeNHF(basicMonthly) {
  return round2(Math.max(0, basicMonthly) * 0.025);
}

export const roundMoney = round2;

export default { computePAYE, computePension, computeNHF, roundMoney };
