import fs from "fs";
import os from "os";
import path from "path";
import PdfPrinter from "pdfmake";

async function testPdf() {
    try {
        const fonts = {
            Helvetica: {
                normal: "Helvetica",
                bold: "Helvetica-Bold",
                italics: "Helvetica-Oblique",
                bolditalics: "Helvetica-BoldOblique"
            }
        };
        const printer = new PdfPrinter(fonts);
        const docDefinition = {
            content: ["Hello World"],
            defaultStyle: { font: "Helvetica", fontSize: 12 }
        };

        const pdfDoc = printer.createPdfKitDocument(docDefinition);
        const tmpPath = path.join(os.tmpdir(), "test_pdf.pdf");

        await new Promise<void>((resolve, reject) => {
            const stream = fs.createWriteStream(tmpPath);
            pdfDoc.pipe(stream);
            pdfDoc.end();
            stream.on("finish", () => resolve());
            stream.on("error", reject);
        });

        console.log("PDF created successfully at: " + tmpPath);
    } catch (e) {
        console.error("Test failed", e);
    }
}

testPdf();
