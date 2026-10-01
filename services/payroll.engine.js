import { computePAYE, computePension, computeNHF, roundMoney } from "../utils/payroll/tax.js";

/**
 * Pure payroll calculation. Given an employee's salary structure and this
 * period's variable inputs, produce the payslip breakdown. No database access —
 * the caller gathers inputs (trip counts, unpaid-leave days, working days) and
 * persists the result.
 *
 * strategy: "fixed-monthly" | "hybrid" | "allowance-based"
 */
export function calculatePayslip({
  strategy,
  structure,
  tripCount = 0,
  tripAmountTotal = null, // sum of per-trip overrides; when null, use flat rate
  unpaidLeaveDays = 0,
  workingDaysInMonth = 22,
  loanDeduction = 0, // this month's installment on an approved loan (computed by the caller from the Loan record)
}) {
  const earnings = [];
  let commission = 0;

  const basic = structure.basic || 0;
  const housing = structure.housing || 0;
  const transport = structure.transport || 0;
  const subsidy = structure.subsidy || 0;
  const dataAllowance = structure.dataAllowance || 0;
  const exGratia = structure.exGratia || 0;
  const referralBonus = structure.referralBonus || 0;
  const overtime = structure.overtime || 0;
  const custom = structure.customEarnings || [];

  if (strategy === "fixed-monthly") {
    const gross = structure.grossMonthly || fixedComponentsTotal(structure);
    earnings.push({ label: "Monthly salary", amount: roundMoney(gross) });
  } else if (strategy === "hybrid") {
    if (basic) earnings.push({ label: "Base salary", amount: roundMoney(basic) });
    if (housing) earnings.push({ label: "Housing allowance", amount: roundMoney(housing) });
    if (transport) earnings.push({ label: "Transport allowance", amount: roundMoney(transport) });
    if (exGratia) earnings.push({ label: "Ex gratia", amount: roundMoney(exGratia) });
    if (referralBonus) earnings.push({ label: "Referral bonus", amount: roundMoney(referralBonus) });
    if (overtime) earnings.push({ label: "Overtime", amount: roundMoney(overtime) });
    for (const c of custom) earnings.push({ label: c.name, amount: roundMoney(c.amount) });
    commission =
      tripAmountTotal != null
        ? roundMoney(tripAmountTotal)
        : roundMoney(tripCount * (structure.commissionPerTrip || 0));
    if (commission > 0 || tripCount > 0) {
      earnings.push({ label: `Trip commission (${tripCount} trip${tripCount === 1 ? "" : "s"})`, amount: commission });
    }
  } else {
    // allowance-based (AJCL)
    if (basic) earnings.push({ label: "Basic", amount: roundMoney(basic) });
    if (housing) earnings.push({ label: "Housing allowance", amount: roundMoney(housing) });
    if (transport) earnings.push({ label: "Transport allowance", amount: roundMoney(transport) });
    if (subsidy) earnings.push({ label: "Subsidy", amount: roundMoney(subsidy) });
    if (dataAllowance) earnings.push({ label: "Data allowance", amount: roundMoney(dataAllowance) });
    if (exGratia) earnings.push({ label: "Ex gratia", amount: roundMoney(exGratia) });
    if (referralBonus) earnings.push({ label: "Referral bonus", amount: roundMoney(referralBonus) });
    if (overtime) earnings.push({ label: "Overtime", amount: roundMoney(overtime) });
    for (const c of custom) earnings.push({ label: c.name, amount: roundMoney(c.amount) });
  }

  const grossEarnings = roundMoney(earnings.reduce((s, e) => s + e.amount, 0));

  // Pro-rata unpaid leave deduction.
  const deductions = [];
  let unpaidLeaveDeduction = 0;
  if (unpaidLeaveDays > 0 && workingDaysInMonth > 0) {
    const daily = grossEarnings / workingDaysInMonth;
    unpaidLeaveDeduction = roundMoney(daily * unpaidLeaveDays);
    deductions.push({
      label: `Unpaid leave (${unpaidLeaveDays} day${unpaidLeaveDays === 1 ? "" : "s"})`,
      amount: unpaidLeaveDeduction,
    });
  }

  const taxableGross = roundMoney(grossEarnings - unpaidLeaveDeduction);

  // PAYE is charged only on basic + housing + transport, not the whole
  // gross — subsidy, data allowance, ex gratia, referral bonus, overtime,
  // custom earnings and trip commission are all excluded. Pro-rated for
  // unpaid leave using the same ratio applied to the overall gross above.
  // For a fixed-monthly structure there's no basic/housing/transport
  // breakdown (it's one lump sum), so the whole taxable gross is used as
  // before.
  const payeBase =
    strategy === "fixed-monthly"
      ? taxableGross
      : roundMoney((basic + housing + transport) * (grossEarnings > 0 ? taxableGross / grossEarnings : 1));

  // Pension (employee 8%, employer 10%) on the pensionable base.
  let pension = { employee: 0, employer: 0, pensionableBase: 0 };
  if (structure.pensionApplicable) {
    const base = pensionableBase(structure) || (strategy === "fixed-monthly" ? taxableGross : 0);
    pension = computePension(base);
    if (pension.employee > 0) deductions.push({ label: "Pension (8%)", amount: pension.employee });
  }

  // NHF (2.5% of basic).
  let nhf = 0;
  if (structure.nhfApplicable) {
    nhf = computeNHF(basic || taxableGross);
    if (nhf > 0) deductions.push({ label: "NHF (2.5%)", amount: nhf });
  }

  // PAYE — annualise the month's taxable gross. Company policy: only the
  // employee's half is deducted from pay; the employer half is reported but
  // not withheld (see computePAYE).
  let taxDetail = null;
  let paye = 0;
  let payeEmployer = 0;
  if (structure.payeApplicable) {
    taxDetail = computePAYE(payeBase * 12, {
      pensionAnnual: pension.employee * 12,
      nhfAnnual: nhf * 12,
    });
    paye = taxDetail.employeeMonthlyTax;
    payeEmployer = taxDetail.employerMonthlyTax;
    if (paye > 0) deductions.push({ label: "PAYE tax (employee half)", amount: paye });
  }

  // Post-tax deductions — taken from what's already been earned and taxed,
  // so they don't touch the PAYE/pension base above.
  const latenessDeduction = structure.latenessDeduction || 0;
  if (latenessDeduction > 0) deductions.push({ label: "Lateness deduction", amount: roundMoney(latenessDeduction) });
  const otherDeductions = structure.otherDeductions || 0;
  if (otherDeductions > 0) deductions.push({ label: "Other deductions", amount: roundMoney(otherDeductions) });
  if (loanDeduction > 0) deductions.push({ label: "Loan repayment", amount: roundMoney(loanDeduction) });

  const totalDeductions = roundMoney(deductions.reduce((s, d) => s + d.amount, 0));
  const netPay = roundMoney(grossEarnings - totalDeductions);

  return {
    strategy,
    earnings,
    grossEarnings,
    commission,
    tripCount,
    deductions,
    paye,
    payeEmployer,
    pensionEmployee: pension.employee,
    pensionEmployer: pension.employer,
    nhf,
    unpaidLeaveDeduction,
    totalDeductions,
    netPay,
    taxDetail,
  };
}

function fixedComponentsTotal(s) {
  const custom = (s.customEarnings || []).reduce((sum, c) => sum + (c.amount || 0), 0);
  return (
    (s.basic || 0) + (s.housing || 0) + (s.transport || 0) + (s.subsidy || 0) + (s.dataAllowance || 0) +
    (s.exGratia || 0) + (s.referralBonus || 0) + (s.overtime || 0) + custom
  );
}

function pensionableBase(s) {
  const custom = (s.customEarnings || [])
    .filter((c) => c.pensionable)
    .reduce((sum, c) => sum + (c.amount || 0), 0);
  return (s.basic || 0) + (s.housing || 0) + (s.transport || 0) + custom;
}

export default { calculatePayslip };
