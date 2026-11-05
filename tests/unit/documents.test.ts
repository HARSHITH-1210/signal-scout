import { describe, expect, it } from "vitest";
import { chunkText, csvRowText, detectKind, DocumentError, parseCsv, parseDocument, prospectFromCsvRow, relevantChunks } from "@/lib/documents/parse";
import { isPublicHostname, validateProspect } from "@/lib/pipeline/validate";

/** Builds a minimal one-page PDF with real text, so extraction is exercised for real. */
function makePdf(lines: string[]): Uint8Array {
  const content = `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe("document parsing", () => {
  it("extracts real text from a PDF", async () => {
    const parsed = await parseDocument("brief.pdf", makePdf(["Account brief: Northwind Freight", "Priya Raman is VP Finance.", "Northwind plans to expand cross-border lanes in 2026."]));
    expect(parsed.kind).toBe("pdf");
    expect(parsed.pages).toBe(1);
    expect(parsed.text).toContain("Priya Raman is VP Finance.");
  });

  it("refuses a PDF with no selectable text instead of pretending to read it", async () => {
    await expect(parseDocument("scan.pdf", makePdf([]))).rejects.toThrow(/no selectable text/);
  });

  it("detects type from the bytes, not the name", () => {
    expect(detectKind("renamed.csv", makePdf(["x"]))).toBe("pdf");
    expect(() => detectKind("photo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(DocumentError);
  });

  it("parses CSV with quotes, a BOM and blank lines, and caps cell length", () => {
    const parsed = parseCsv('﻿Name,Company,Notes\n"Raman, Priya",Northwind,"said ""hi"""\n\n,,\nDana,Quietbrook,\n');
    expect(parsed.csv!.headers).toEqual(["Name", "Company", "Notes"]);
    expect(parsed.csv!.rows).toEqual([["Raman, Priya", "Northwind", 'said "hi"'], ["Dana", "Quietbrook", ""]]);
  });

  it("maps common CRM headers, joins first and last names, and ignores non-profile LinkedIn links", () => {
    const headers = ["First Name", "Last Name", "Job Title", "Account Name", "Work Email", "LinkedIn"];
    expect(prospectFromCsvRow(headers, ["Priya", "Raman", "VP Finance", "Northwind", "priya@northwind.io", "https://linkedin.com/in/priya-raman"])).toEqual({
      name: "Priya Raman",
      role: "VP Finance",
      company: "Northwind",
      companyWebsite: "northwind.io",
      linkedinUrl: "https://linkedin.com/in/priya-raman",
      email: "priya@northwind.io",
    });
    expect(prospectFromCsvRow(headers, ["", "", "", "Acme", "", "https://linkedin.com/company/acme"])).toEqual({ company: "Acme" });
  });

  it("uses only the chosen row as evidence text", () => {
    expect(csvRowText(["Name", "Company", "Empty"], ["Priya", "Northwind", ""])).toBe("Name: Priya\nCompany: Northwind");
  });

  it("chunks long text and picks the chunks most relevant to a query", () => {
    const text = Array.from({ length: 40 }, (_, i) => (i === 30 ? "Our AP automation cut invoice processing time for freight carriers." : `Paragraph ${i} about something else entirely.`)).join("\n");
    expect(chunkText(text, 400).length).toBeGreaterThan(3);
    expect(relevantChunks(text, "invoice automation freight", 1, 300)[0]).toContain("invoice processing");
  });
});

describe("validation", () => {
  it("refuses internal or IP-literal company websites (F-17)", () => {
    expect(isPublicHostname("ramp.com")).toBe(true);
    expect(isPublicHostname("169.254.169.254")).toBe(false);
    expect(isPublicHostname("printer.local")).toBe(false);
    expect(isPublicHostname("intranet.corp")).toBe(false);
    expect(validateProspect({ companyWebsite: "http://169.254.169.254/latest/meta-data" }).ok).toBe(false);
  });

  it("accepts a run with only documents attached", () => {
    expect(validateProspect({}, { allowEmpty: true }).ok).toBe(true);
    expect(validateProspect({}).ok).toBe(false);
  });
});
