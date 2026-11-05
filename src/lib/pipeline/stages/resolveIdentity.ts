import { z } from "zod";
import { ProviderError } from "../../errors";
import type { Identity, IdentityCandidate, ProspectInput, QueryLogEntry, Source } from "../../types";
import type { StageContext } from "../context";
import { SourceCollector } from "../context";
import { containsWords, mentionsCompany, mentionsPerson } from "../evidence";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "../sanitize";
import { domainOf } from "../sourceReliability";

const IdentityOutput = z.object({
  status: z.enum(["resolved", "ambiguous", "not_found"]),
  personConfirmed: z.boolean(),
  employment: z.enum(["current", "former", "unknown"]),
  currentCompany: z.string().nullable(),
  reasoning: z.string(),
  resolvedName: z.string().nullable(),
  resolvedRole: z.string().nullable(),
  resolvedCompany: z.string().nullable(),
  companyDomain: z.string().nullable(),
  companyDescription: z.string().nullable(),
  evidenceSourceIds: z.array(z.string()),
  candidates: z.array(
    z.object({
      name: z.string(),
      role: z.string().nullable(),
      company: z.string().nullable(),
      description: z.string(),
      evidenceSourceId: z.string().nullable(),
    }),
  ),
});
type IdentityOutput = z.infer<typeof IdentityOutput>;

const SYSTEM = `You resolve which real person and company a B2B sales rep means, using only the provided search results.
${UNTRUSTED_DATA_RULE}

Rules:
- "resolved": the results identify one specific company that matches the rep's identifiers. Set personConfirmed=true only if a result explicitly ties this person's name to that company. If the company is clear but the person is not visible publicly, use "resolved" with personConfirmed=false.
- "ambiguous": two or more distinct people or companies plausibly match and the rep's details do not decide between them (e.g. several companies share the name, or several people with this name hold similar roles). List each distinct candidate (max 5) with the source id that describes it.
- "not_found": no result matches the rep's person name or company at all.
- Prefer "ambiguous" over "not_found" when results show partial matches the rep could choose from: the right name at a company with the same name but a different role, or several distinct companies sharing the name. Let the rep decide; describe each candidate so the difference is obvious.
- The rep may give only some details (just a company, just a website, just a LinkedIn URL, just a role or a note). Work with what is there:
  - No person name given: the target is the company. If one company is clearly identified, use "resolved" with personConfirmed=false and resolvedName=null, unless a source explicitly ties the rep's LinkedIn URL or other details to one named person.
  - Details that fit many companies or people (e.g. only a role, or a common company name): use "ambiguous" with candidates, or "not_found".
- Never guess. Every field you fill must be supported by a cited source. Use null for anything the sources don't state.
- employment: "current" only if a source says the person holds this role or company now; "former" if a source says they left, previously worked there, or are an ex-employee; otherwise "unknown".
- currentCompany: when employment is "former" and a source says where the person works now, that company's name; otherwise null.
- Documents marked as the rep's own (domain "your document") are trusted descriptions of the intended prospect.
- companyDomain: the company's own website domain (e.g. "acme.com") only if it appears in the sources or the rep provided it.
- evidenceSourceIds: ids of sources that support your conclusion.
- reasoning: 1-3 sentences a sales rep can read.`;

function describeProspect(p: ProspectInput): string {
  return [
    `Name: ${p.name ?? "(not provided)"}`,
    `Company: ${p.company ?? "(not provided)"}`,
    `Role: ${p.role ?? "(not provided)"}`,
    `LinkedIn URL (rep-provided, not fetched): ${p.linkedinUrl ?? "(not provided)"}`,
    `Company website: ${p.companyWebsite ?? "(not provided)"}`,
    `Rep notes: ${p.notes ?? "(none)"}`,
  ].join("\n");
}

/** Turns a LinkedIn slug like "priya-raman-4b2a91" into search words ("priya raman"). A search hint only, never a fact. */
export function linkedinSlugWords(url: string | undefined): string | null {
  const slug = url ? /\/in\/([^/?#]+)/i.exec(url)?.[1] : undefined;
  if (!slug) return null;
  const words = decodeURIComponent(slug)
    .split(/[-_]+/)
    .filter((w) => /^\p{L}{2,}$/u.test(w));
  return words.length ? words.join(" ") : null;
}

const tidy = (q: string) => q.replace(/\s+/g, " ").trim();

/** Builds identity searches from whichever fields the rep provided. Exported for tests. */
export function identityQueries(p: ProspectInput): string[] {
  const queries: string[] = [];
  const slugWords = linkedinSlugWords(p.linkedinUrl);
  if (p.name) queries.push(tidy(`"${p.name}" ${p.company ?? ""} ${p.role ?? ""}`));
  else if (slugWords) queries.push(tidy(`"${slugWords}" ${p.company ?? ""} ${p.role ?? ""} linkedin`));
  if (p.company && !p.companyWebsite) queries.push(tidy(`${p.company} company official website about`));
  // Nothing identifying beyond a role or a note: search with exactly what the rep wrote.
  if (queries.length === 0 && !p.companyWebsite) queries.push(tidy(`${p.role ?? ""} ${p.notes ?? ""}`));
  return queries.filter((q) => q.length > 0);
}

export interface IdentityStageResult {
  identity: Identity;
  sources: Source[];
  log: QueryLogEntry[];
  limitations: string[];
}

/** Searches for the prospect, asks Claude to classify the match, then applies deterministic downgrades. */
export async function resolveIdentity(
  ctx: StageContext,
  prospect: ProspectInput,
  documents: { name: string; text: string }[] = [],
): Promise<IdentityStageResult> {
  const { search, llm } = ctx.deps;
  const userDomain = prospect.companyWebsite ? domainOf(prospect.companyWebsite) : null;
  const collector = new SourceCollector();
  const log: QueryLogEntry[] = [];
  let failures = 0;

  for (const doc of documents) {
    const added = collector.addDocument(doc);
    ctx.emit("resolve_identity", "running", `Reading your document ${doc.name}`);
    log.push({ category: "document", query: doc.name, resultCount: added.length, error: null });
  }

  if (prospect.companyWebsite) {
    ctx.emit("resolve_identity", "running", `Reading company website ${userDomain}`);
    try {
      const pages = await search.extract([prospect.companyWebsite]);
      for (const page of pages)
        collector.add({ url: page.url, title: `${userDomain} (company website)`, content: page.rawContent, rawContent: page.rawContent, publishedDate: null, score: 1 }, "website", userDomain);
      log.push({ category: "website", query: prospect.companyWebsite, resultCount: pages.length, error: null });
    } catch (error) {
      if (error instanceof ProviderError && (error.kind === "config" || error.kind === "auth")) throw error;
      failures++;
      log.push({ category: "website", query: prospect.companyWebsite, resultCount: 0, error: error instanceof Error ? error.message : "failed" });
    }
  }

  const queries = identityQueries(prospect);
  for (const query of queries) {
    ctx.emit("resolve_identity", "running", `Searching: ${query}`);
    try {
      const results = await search.search({ query, maxResults: 8, subject: prospect.name ?? prospect.company });
      for (const r of results) collector.add(r, "identity", userDomain);
      log.push({ category: "identity", query, resultCount: results.length, error: null });
    } catch (error) {
      if (error instanceof ProviderError && (error.kind === "config" || error.kind === "auth")) throw error;
      failures++;
      log.push({ category: "identity", query, resultCount: 0, error: error instanceof Error ? error.message : "failed" });
    }
  }

  const attempts = queries.length + (prospect.companyWebsite ? 1 : 0);
  if (attempts > 0 && failures === attempts) {
    const first = log.find((l) => l.error)?.error ?? "Search failed.";
    // Uploaded documents can still identify the prospect; without them, this is "couldn't search", not "found nothing".
    if (documents.length === 0) throw new ProviderError("tavily", "unavailable", `Couldn't search the web, so the prospect wasn't looked up: ${first}`);
    ctx.degrade?.("documents_only", "Web search was unavailable, so identity rests on your documents alone.");
  }

  const sources = collector.all();
  if (sources.length === 0) {
    return {
      identity: notFound("No public search results mention this prospect or company."),
      sources,
      log,
      limitations: ["No public search results or documents matched the prospect's details."],
    };
  }

  ctx.emit("resolve_identity", "running", `Matching the prospect against ${sources.length} results`);
  const request = {
    task: "resolve_identity" as const,
    effort: "low" as const,
    system: SYSTEM,
    user: `PROSPECT (from the sales rep):\n${describeProspect(prospect)}\n\nSOURCES:\n${sources.map(wrapUntrusted).join("\n\n")}`,
    schema: IdentityOutput,
  };
  const output = await llm.generate(request);
  const result = applyIdentityChecks(output, prospect, sources, userDomain, log);
  return secondOpinion(ctx, result, request, prospect, sources, userDomain, log);
}

/**
 * A match that rests on a single source gets a second opinion from a different AI provider, when one is
 * configured. If the two disagree about who this is, the run pauses for the rep instead of guessing.
 * Exported for tests.
 */
export async function secondOpinion(
  ctx: StageContext,
  result: IdentityStageResult,
  request: Parameters<StageContext["deps"]["llm"]["generate"]>[0] & { schema: typeof IdentityOutput },
  prospect: ProspectInput,
  sources: Source[],
  userDomain: string | null,
  log: QueryLogEntry[],
): Promise<IdentityStageResult> {
  const first = result.identity;
  const llm = ctx.deps.llm;
  if (first.status !== "resolved" || first.evidenceUrls.length > 1 || !llm.served) return result;
  const firstBy = llm.served("resolve_identity");
  let other: IdentityStageResult;
  try {
    const output = await llm.generate({ ...request, independentOf: "resolve_identity" });
    other = applyIdentityChecks(output, prospect, sources, userDomain, log);
  } catch {
    return result; // a second opinion is a bonus check; its failure never fails the run
  }
  const secondBy = llm.served("resolve_identity");
  if (!secondBy || secondBy === firstBy) return result; // no independent provider was available
  const second = other.identity;
  const sameCompany =
    second.status === "resolved" &&
    (mentionsCompany(second.resolvedCompany ?? "", first.resolvedCompany, null) || mentionsCompany(first.resolvedCompany ?? "", second.resolvedCompany, null));
  const samePerson = !first.resolvedName || !second.resolvedName || mentionsPerson(second.resolvedName, first.resolvedName);
  if (sameCompany && samePerson) {
    ctx.emit("resolve_identity", "running", `A second AI provider (${secondBy}) independently confirmed the match.`);
    return result;
  }
  const describe = (i: Identity) => [i.resolvedName, i.resolvedCompany].filter(Boolean).join(" at ") || "no confident match";
  const candidates: IdentityCandidate[] = [
    { name: first.resolvedName ?? first.resolvedCompany ?? "Match A", role: first.resolvedRole, company: first.resolvedCompany, description: `${firstBy ?? "First model"}'s match`, evidenceUrl: first.evidenceUrls[0] ?? null },
    ...(second.status === "resolved"
      ? [{ name: second.resolvedName ?? second.resolvedCompany ?? "Match B", role: second.resolvedRole, company: second.resolvedCompany, description: `${secondBy}'s match`, evidenceUrl: second.evidenceUrls[0] ?? null }]
      : second.candidates),
  ].slice(0, 5);
  return {
    ...result,
    identity: {
      ...first,
      status: "ambiguous",
      resolvedName: null,
      resolvedRole: null,
      resolvedCompany: null,
      companyDomain: null,
      companyDescription: null,
      personConfirmed: false,
      candidates,
      reasoning: `Two AI providers disagreed about this match (${firstBy ?? "first"}: ${describe(first)}; ${secondBy}: ${describe(second)}), and it rests on a single source. Pick the right one.`,
    },
  };
}

function notFound(reasoning: string): Identity {
  return {
    status: "not_found",
    resolvedName: null,
    resolvedRole: null,
    resolvedCompany: null,
    companyDomain: null,
    companyDescription: null,
    reasoning,
    evidenceUrls: [],
    candidates: [],
    personConfirmed: false,
    confirmedByUser: false,
  };
}

/** True when "former", "ex-" or "previously" appears close to the person's name in the text. */
export function formerNear(text: string, name: string): boolean {
  const last = name.trim().split(/\s+/).pop();
  if (!last) return false;
  const pattern = new RegExp(`\\b(former|formerly|ex-|previously|used to be)\\b[^.\\n]{0,60}\\b${last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b|\\b${last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^.\\n]{0,60}\\b(former|formerly|previously|left the company|departed)\\b`, "i");
  return pattern.test(text);
}

function groundedRole(role: string | null, evidence: Source[], repRole: string | undefined): string | null {
  if (role && evidence.some((s) => containsWords(`${s.title}\n${s.text}`, role))) return role;
  return repRole ?? null;
}

/** Deterministic guardrails over the model's classification. Exported for unit tests. */
export function applyIdentityChecks(
  output: IdentityOutput,
  prospect: ProspectInput,
  sources: Source[],
  userDomain: string | null,
  log: QueryLogEntry[],
): IdentityStageResult {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const evidence = output.evidenceSourceIds.map((id) => byId.get(id)).filter((s): s is Source => Boolean(s));
  const limitations: string[] = [];
  // The person we're checking for: whoever the rep named, else whoever the model tied to their details.
  const personName = prospect.name ?? output.resolvedName ?? null;

  const candidates: IdentityCandidate[] = output.candidates.slice(0, 5).map((c) => ({
    name: c.name,
    role: c.role,
    company: c.company,
    description: c.description,
    evidenceUrl: c.evidenceSourceId ? (byId.get(c.evidenceSourceId)?.url ?? null) : null,
  }));

  // Only accept a company domain we can see in sources or that the rep gave us.
  const sourceDomains = new Set(sources.map((s) => s.domain));
  const modelDomain = output.companyDomain?.toLowerCase().replace(/^www\./, "") ?? null;
  const companyDomain = userDomain ?? (modelDomain && [...sourceDomains].some((d) => d === modelDomain || d.endsWith(`.${modelDomain}`)) ? modelDomain : null);

  let status = output.status;
  let personConfirmed = output.personConfirmed;
  let reasoning = output.reasoning;

  if (status === "resolved") {
    const company = output.resolvedCompany ?? prospect.company ?? null;
    const evidenceText = (s: Source) => `${s.title}\n${s.url}\n${s.text}`;
    const companyBacked = evidence.some((s) => mentionsCompany(evidenceText(s), company, companyDomain));
    const repCompanyMatches =
      !prospect.company || !output.resolvedCompany || mentionsCompany(output.resolvedCompany, prospect.company, null) || mentionsCompany(prospect.company, output.resolvedCompany, null);

    if (evidence.length === 0 || !companyBacked) {
      status = candidates.length >= 2 ? "ambiguous" : "not_found";
      personConfirmed = false;
      reasoning = `The model's match could not be tied to a cited source that mentions the company, so it was not accepted. ${reasoning}`;
    } else if (!repCompanyMatches) {
      status = "ambiguous";
      personConfirmed = false;
      reasoning = `Sources point to "${output.resolvedCompany}", which differs from the company the rep entered ("${prospect.company}"). ${reasoning}`;
      if (candidates.length === 0)
        candidates.push({ name: output.resolvedName ?? prospect.name ?? output.resolvedCompany ?? "Suggested match", role: output.resolvedRole, company: output.resolvedCompany, description: "Match suggested by search results", evidenceUrl: evidence[0]?.url ?? null });
    } else if (personConfirmed && (!personName || !evidence.some((s) => mentionsPerson(evidenceText(s), personName)))) {
      personConfirmed = false;
    }
    // People move on: "former CFO of X" mentions X but doesn't confirm they're there now.
    const describedAsFormer = output.employment === "former" || (personName ? evidence.some((s) => formerNear(evidenceText(s), personName)) : false);
    if (status === "resolved" && describedAsFormer && personName) {
      // Job change: never pitch the old company. Pause for the rep; the move itself can be the hook.
      const moved = output.currentCompany?.trim() || null;
      const newCompany =
        moved && !mentionsCompany(moved, company, null) && sources.some((s) => mentionsCompany(evidenceText(s), moved, null)) ? moved : null;
      status = "ambiguous";
      personConfirmed = false;
      candidates.length = 0;
      if (newCompany)
        candidates.push({
          name: personName,
          role: null,
          company: newCompany,
          description: `Now at ${newCompany}, previously at ${company ?? "their old company"}. Research ${newCompany}; the move itself can be the opening.`,
          evidenceUrl: sources.find((s) => mentionsCompany(evidenceText(s), newCompany, null))?.url ?? null,
        });
      candidates.push({
        name: personName,
        role: output.resolvedRole,
        company,
        description: `Still at ${company ?? "the company"}. Sources describe them as a former employee, so only pick this if you know they're still there.`,
        evidenceUrl: evidence[0]?.url ?? null,
      });
      reasoning = `Possible job change: sources describe ${personName} as a former employee of ${company ?? "the company"}${newCompany ? ` and now at ${newCompany}` : ""}. Research is paused so the draft doesn't pitch the wrong company.`;
      limitations.push(`${personName} may have changed jobs. Confirm where they work now; if they moved, the move is a natural opening.`);
    }
  }
  if (status === "ambiguous" && candidates.length === 0) status = "not_found";

  if (status === "resolved" && !personConfirmed && limitations.length === 0)
    limitations.push(
      prospect.name
        ? `${prospect.name} could not be confirmed at this company from public sources; research is company-level and relies on the rep's details for the person.`
        : "No specific person was identified, so research and the draft are about the company. Choose the recipient yourself.",
    );
  if (status === "not_found") limitations.push("The prospect's identity could not be confirmed from public sources.");

  return {
    identity: {
      status,
      // A name the rep didn't give is only used once a cited source confirms it.
      resolvedName: status === "resolved" ? (prospect.name ?? (personConfirmed ? output.resolvedName : null)) : null,
      // The model's role is kept only if a cited source states it; otherwise the rep's own entry (if any) stands.
      resolvedRole: status === "resolved" ? groundedRole(output.resolvedRole, evidence, prospect.role) : null,
      resolvedCompany: status === "resolved" ? (output.resolvedCompany ?? prospect.company ?? null) : null,
      companyDomain: status === "resolved" ? companyDomain : null,
      companyDescription: status === "resolved" ? output.companyDescription : null,
      reasoning,
      evidenceUrls: evidence.map((s) => s.url),
      candidates: status === "ambiguous" ? candidates : [],
      personConfirmed: status === "resolved" && personConfirmed,
      confirmedByUser: false,
    },
    sources,
    log,
    limitations,
  };
}
