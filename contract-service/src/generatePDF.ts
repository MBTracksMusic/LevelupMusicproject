import fs from "node:fs";
import PDFDocument from "pdfkit";
import type { ContractPdfPayload } from "./types.js";

export function generatePDF(filePath: string, payload: ContractPdfPayload): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc.fontSize(18).text("CONTRAT DE LICENCE", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#555555").text(`Reference achat: ${payload.purchaseId}`, { align: "center" });
    doc.moveDown(1.2);
    doc.fillColor("#000000");

    doc.fontSize(12).text(`Date: ${payload.contractDate}`);
    doc.moveDown(0.2);
    doc.text(`Producteur: ${payload.producerName}`);
    doc.moveDown(0.2);
    doc.text(`Acheteur: ${payload.buyerName}`);
    doc.moveDown(0.2);
    doc.text(`Titre: ${payload.trackTitle}`);
    doc.moveDown(0.2);
    doc.text(`Licence: ${payload.licenseName}`);
    doc.moveDown();

    doc.fontSize(13).text("Description de licence", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).text(payload.licenseDescription, { lineGap: 3 });
    doc.moveDown();

    doc.fontSize(13).text("Droits et limites", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11);
    for (const row of payload.rights) {
      doc.text(`- ${row.label}: ${row.value}`, { lineGap: 2 });
    }
    doc.moveDown();

    doc.fontSize(13).text("Clause de credit", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).text(payload.creditClause, { lineGap: 3 });

    doc.end();

    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}
