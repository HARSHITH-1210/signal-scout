import { describe, expect, it } from "vitest";
import { guessColumns, kindFromStatus, parseTable, planImport, toCsv, type ImportOptions } from "@/lib/contacts/importer";
import { entryKind, normaliseEntry, validateContactRules } from "@/lib/contacts/rules";
import { checkContactRules } from "@/lib/pipeline/contacts";

describe("contact entries", () => {
  it("knows what each entry matches by", () => {
    expect(entryKind("priya@acme.test")).toBe("email");
    expect(entryKind("acme.test")).toBe("domain");
    expect(entryKind("Acme Holdings")).toBe("company");
  });

  it("normalises emails, domains and website URLs, and keeps company spelling", () => {
    expect(normaliseEntry("  Priya@ACME.test ")).toEqual({ ok: true, value: "priya@acme.test", kind: "email" });
    expect(normaliseEntry("mailto:priya@acme.test")).toMatchObject({ ok: true, value: "priya@acme.test" });
    expect(normaliseEntry("https://www.Acme.test/about?x=1")).toEqual({ ok: true, value: "acme.test", kind: "domain" });
    expect(normaliseEntry("acme.test/pricing")).toMatchObject({ ok: true, value: "acme.test" });
    expect(normaliseEntry("Acme  Holdings")).toEqual({ ok: true, value: "Acme Holdings", kind: "company" });
  });

  it("refuses shared mail providers as domains, invalid emails and blanks", () => {
    expect(normaliseEntry("gmail.com")).toMatchObject({ ok: false, reason: expect.stringMatching(/shared mail provider/) });
    expect(normaliseEntry("https://www.outlook.com")).toMatchObject({ ok: false });
    expect(normaliseEntry("someone@gmail.com")).toMatchObject({ ok: true, kind: "email" });
    expect(normaliseEntry("not an @ email")).toMatchObject({ ok: false });
    expect(normaliseEntry("   ")).toMatchObject({ ok: false });
  });

  it("validates a whole list: normalises, de-duplicates, names the first bad entry", () => {
    const ok = validateContactRules({
      doNotContact: ["ACME.test", "acme.test", "https://globex.test/"],
      relationships: [
        { match: "Initech", kind: "customer", note: "  owner  Sam " },
        { match: "initech", note: "dupe" },
      ],
    });
    expect(ok).toEqual({ ok: true, value: { doNotContact: ["acme.test", "globex.test"], relationships: [{ match: "Initech", kind: "customer", note: "owner Sam" }] } });
    expect(validateContactRules({ doNotContact: ["gmail.com"], relationships: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/gmail\.com/) });
  });

  it("puts the relationship type in front of the note a held run shows", () => {
    const hold = checkContactRules({ company: "Initech" }, { doNotContact: [], relationships: [{ match: "Initech", kind: "open_deal", note: "owner Sam" }] });
    expect(hold).toMatchObject({ kind: "relationship", note: "Open deal · owner Sam" });
    const legacy = checkContactRules({ company: "Initech" }, { doNotContact: [], relationships: [{ match: "Initech", note: "" }] });
    expect(legacy).toMatchObject({ kind: "relationship", note: null });
  });
});

describe("CSV import", () => {
  const crm = "Company,Website,Deal Stage,Owner,Email\nInitech,https://initech.test,Closed Won,Sam,bill@initech.test\nGlobex,globex.test,Negotiation,Ana,\nHooli,,Churned,Lee,\n,,,,\n";

  it("detects a header row, or treats a first row of emails as data", () => {
    expect(parseTable(crm)).toMatchObject({ hasHeader: true, headers: ["Company", "Website", "Deal Stage", "Owner", "Email"] });
    expect(parseTable(crm).rows).toHaveLength(3);
    const pasted = parseTable("a@acme.test\nb@acme.test\n");
    expect(pasted).toMatchObject({ hasHeader: false, headers: ["Entry"], rows: [["a@acme.test"], ["b@acme.test"]] });
    expect(parseTable("one\ttwo\nx@a.test\ty").headers).toEqual(["one", "two"]); // tab-separated
  });

  it("guesses email first, then domain, then company; reads stage as type and owner as note", () => {
    const t = parseTable(crm);
    expect(guessColumns(t)).toEqual({ match: 4, kind: 2, notes: [3], fallbacks: [1, 0] });
    const noEmail = parseTable("Account Name,Domain,Status\nInitech,initech.test,Customer");
    expect(guessColumns(noEmail).match).toBe(1);
    expect(guessColumns(parseTable("x,y\nfoo,acme.test\nbar,globex.test")).match).toBe(1); // by content
  });

  it("reads CRM statuses as relationship types", () => {
    expect(kindFromStatus("Closed Won")).toBe("customer");
    expect(kindFromStatus("Closed Lost")).toBe("past_contact");
    expect(kindFromStatus("Churned")).toBe("past_contact");
    expect(kindFromStatus("Negotiation")).toBe("open_deal");
    expect(kindFromStatus("Reseller partner")).toBe("partner");
    expect(kindFromStatus("open_deal")).toBe("open_deal");
    expect(kindFromStatus("???")).toBeNull();
  });

  it("plans an import: new entries with type and note, duplicates and skipped rows counted", () => {
    const t = parseTable(crm);
    const options: ImportOptions = { target: "relationships", match: 1, kindColumn: 2, defaultKind: "other", notes: [3] };
    const plan = planImport(t, options, ["GLOBEX.test"]);
    expect(plan.relationships).toEqual([{ match: "initech.test", kind: "customer", note: "Owner: Sam" }]);
    expect(plan.duplicates).toBe(1);
    expect(plan.skipped).toEqual([{ row: 4, value: "", reason: "Empty" }]);
    expect(plan.kinds).toEqual({ email: 0, domain: 1, company: 0 });
  });

  it("falls back to the row's other identifier columns when the match cell is empty", () => {
    const t = parseTable(crm);
    const plan = planImport(t, { target: "relationships", match: 1, kindColumn: 2, defaultKind: "other", notes: [], fallbacks: [0] }, []);
    expect(plan.relationships.map((r) => r.match)).toEqual(["initech.test", "globex.test", "Hooli"]);
    expect(plan.kinds).toEqual({ email: 0, domain: 2, company: 1 });
  });

  it("imports an unsubscribe list into Do not contact, skipping shared-mail domains and repeats", () => {
    const t = parseTable("email\nA@acme.test\na@acme.test\ngmail.com\nb@globex.test");
    const plan = planImport(t, { target: "doNotContact", match: 0, kindColumn: null, defaultKind: "other", notes: [] }, []);
    expect(plan.doNotContact).toEqual(["a@acme.test", "b@globex.test"]);
    expect(plan.duplicates).toBe(1);
    expect(plan.skipped).toMatchObject([{ row: 4, value: "gmail.com" }]);
  });

  it("exports CSV that re-imports, with formula-looking cells defused", () => {
    const csv = toCsv("relationships", [{ match: "Initech", kind: "open_deal", note: "=HYPERLINK(\"x\"), owner" }]);
    expect(csv).toBe('entry,type,note\r\nInitech,open_deal,"\'=HYPERLINK(""x""), owner"');
    const t = parseTable(csv);
    const g = guessColumns(t);
    const plan = planImport(t, { target: "relationships", match: g.match, kindColumn: g.kind, defaultKind: "other", notes: g.notes }, []);
    expect(plan.relationships[0]).toMatchObject({ match: "Initech", kind: "open_deal" });
  });
});
