import PDFDocument from "pdfkit";

const NGN = (n) =>
  "NGN " +
  Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Render a payslip to a PDF Buffer. Deliberately plain — a document an employee
 * or a bank would accept, not a designed marketing piece.
 */
export function generatePayslipPdf(payslip, organization) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const s = payslip.employeeSnapshot || {};
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // Header
    doc.fontSize(16).font("Helvetica-Bold").text(organization?.name || "Organization", left, 50);
    if (organization?.address) {
      doc.fontSize(9).font("Helvetica").fillColor("#555").text(organization.address);
    }
    doc.moveDown(0.5);
    doc.fillColor("#000").fontSize(12).font("Helvetica-Bold").text("Payslip");
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#555")
      .text(`${payslip.periodLabel}  ·  Ref ${payslip.payrollRun?.reference || ""}`);
    doc.fillColor("#000");

    let y = doc.y + 14;
    doc
      .moveTo(left, y)
      .lineTo(right, y)
      .strokeColor("#ddd")
      .stroke();
    y += 12;

    // Employee block
    const col2 = left + width / 2;
    doc.fontSize(9).font("Helvetica-Bold").text("Employee", left, y);
    doc.font("Helvetica").text(`${s.name || ""} (${s.employeeId || ""})`, left, y + 12);
    doc.text(`${s.position || ""}${s.department ? " · " + s.department : ""}`, left, y + 24);
    doc.text(`${s.branch || ""}`, left, y + 36);

    doc.font("Helvetica-Bold").text("Payment", col2, y);
    doc.font("Helvetica").text(`${s.bank?.bankName || "—"}`, col2, y + 12);
    doc.text(`${s.bank?.accountNumber || "—"}`, col2, y + 24);
    doc.text(`Tax state: ${s.taxState || "—"}   PFA: ${s.pfaName || "—"}`, col2, y + 36);

    y += 60;

    // Earnings table
    y = section(doc, "Earnings", payslip.earnings, left, right, y);
    y = totalLine(doc, "Gross earnings", payslip.grossEarnings, left, right, y);
    y += 10;

    // Deductions table
    y = section(doc, "Deductions", payslip.deductions, left, right, y);
    y = totalLine(doc, "Total deductions", payslip.totalDeductions, left, right, y);
    y += 16;

    // Net pay
    doc
      .moveTo(left, y)
      .lineTo(right, y)
      .strokeColor("#000")
      .stroke();
    y += 8;
    doc.fontSize(12).font("Helvetica-Bold").text("Net pay", left, y);
    doc.text(NGN(payslip.netPay), left, y, { width, align: "right" });
    y += 24;

    // Statutory note
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#666")
      .text(
        `PAYE (employee) ${NGN(payslip.paye)} · PAYE (company) ${NGN(payslip.payeEmployer)} · ` +
          `Pension employee ${NGN(payslip.pensionEmployee)} · Pension employer ${NGN(payslip.pensionEmployer)}` +
          (payslip.nhf ? ` · NHF ${NGN(payslip.nhf)}` : "") +
          (payslip.tripCount ? ` · Trips ${payslip.tripCount}` : ""),
        left,
        y,
        { width },
      );
    doc.text(
      `Generated ${new Date().toLocaleString("en-NG")}. This payslip is confidential.`,
      left,
      y + 14,
      { width },
    );

    doc.end();
  });
}

function section(doc, title, items, left, right, y) {
  const width = right - left;
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#000").text(title, left, y);
  y += 16;
  doc.fontSize(9).font("Helvetica");
  for (const item of items || []) {
    doc.text(item.label, left, y, { width: width * 0.7 });
    doc.text(NGN(item.amount), left, y, { width, align: "right" });
    y += 14;
  }
  if (!items || items.length === 0) {
    doc.fillColor("#888").text("None", left, y);
    doc.fillColor("#000");
    y += 14;
  }
  return y;
}

function totalLine(doc, label, amount, left, right, y) {
  const width = right - left;
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#ddd").stroke();
  y += 4;
  doc.fontSize(9).font("Helvetica-Bold");
  doc.text(label, left, y, { width: width * 0.7 });
  doc.text(NGN(amount), left, y, { width, align: "right" });
  return y + 16;
}

export default { generatePayslipPdf };
