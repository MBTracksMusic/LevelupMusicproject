import fs from "node:fs";
import PDFDocument from "pdfkit";

export function generatePDF(filePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);
    doc.fontSize(18).text("CONTRAT DE LICENCE", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(content, { lineGap: 4 });
    doc.end();

    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}
