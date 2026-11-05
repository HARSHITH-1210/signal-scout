import { ProviderError } from "../../errors";
import type { Identity, ProspectInput, QueryLogEntry, Source, SourceCategory } from "../../types";
import type { SearchQuery } from "../../providers/search";
import { isoDateDaysAgo, SourceCollector, type StageContext } from "../context";

export const MAX_SOURCES = 25;

interface PlannedQuery {
  category: SourceCategory;
  query: SearchQuery;
}

/** Five targeted queries, one per signal family. Exported for tests. */
export function planResearchQueries(identity: Identity, prospect: ProspectInput, now: Date): PlannedQuery[] {
  const company = identity.resolvedCompany ?? prospect.company ?? "";
  const name = identity.resolvedName ?? prospect.name;
  const role = identity.resolvedRole ?? prospect.role ?? "";
  const year = now.getUTCFullYear();
  const qualified = identity.companyDomain ? `${company} (${identity.companyDomain})` : company;
  const plan: PlannedQuery[] = [
    { category: "news", query: { query: `${qualified} news announcement`, topic: "news", maxResults: 6, startDate: isoDateDaysAgo(now, 540) } },
    { category: "funding", query: { query: `${company} raises funding round OR acquisition OR investment`, maxResults: 5 } },
    { category: "hiring", query: { query: `${company} hiring jobs careers ${role ? roleFunction(role) : ""}`.trim(), maxResults: 5 } },
    { category: "person", query: { query: `"${name}" ${company} interview OR podcast OR keynote OR wrote`, maxResults: 5 } },
    { category: "priorities", query: { query: `${company} strategy priorities challenges ${year - 1} ${year}`, maxResults: 5 } },
  ];
  // Without a named person there is no one to search interviews for; company-level research only.
  return name ? plan : plan.filter((p) => p.category !== "person");
}

/** Maps a job title to the function it likely hires for, to make the hiring query relevant to the prospect. */
function roleFunction(role: string): string {
  const r = role.toLowerCase();
  if (/financ|cfo|controller|account|treasur|fp&a/.test(r)) return "finance";
  if (/sales|revenue|cro|business development|gtm/.test(r)) return "sales";
  if (/market|cmo|growth|brand/.test(r)) return "marketing";
  if (/engineer|cto|technolog|develop|software|data/.test(r)) return "engineering";
  if (/operat|coo|supply|procure/.test(r)) return "operations";
  if (/people|hr|talent|recruit|chro/.test(r)) return "people";
  return "";
}

export interface ResearchResult {
  sources: Source[];
  log: QueryLogEntry[];
  failedQueries: number;
}

/** Runs all research queries in parallel; partial failure is tolerated, total failure is not. */
export async function research(
  ctx: StageContext,
  identity: Identity,
  prospect: ProspectInput,
  identitySources: Source[],
): Promise<ResearchResult> {
  const planned = planResearchQueries(identity, prospect, ctx.deps.now());
  const collector = new SourceCollector(identitySources);
  collector.rescore(identity.companyDomain);

  ctx.emit("research", "running", `Running ${planned.length} searches in parallel`, {
    queries: planned.map((p) => ({ category: p.category, query: p.query.query })),
  });

  const settled = await Promise.allSettled(planned.map((p) => ctx.deps.search.search(p.query)));

  const log: QueryLogEntry[] = [];
  let failedQueries = 0;
  settled.forEach((outcome, i) => {
    const { category, query } = planned[i];
    if (outcome.status === "fulfilled") {
      let added = 0;
      for (const result of outcome.value) {
        if (collector.size >= MAX_SOURCES) break;
        const before = collector.size;
        collector.add(result, category, identity.companyDomain);
        if (collector.size > before) added++;
      }
      log.push({ category, query: query.query, resultCount: outcome.value.length, error: null });
      ctx.emit("research", "running", `${category}: ${outcome.value.length} results, ${added} new`);
    } else {
      failedQueries++;
      const reason = outcome.reason;
      if (reason instanceof ProviderError && (reason.kind === "config" || reason.kind === "auth")) throw reason;
      const message = reason instanceof Error ? reason.message : "Search failed";
      log.push({ category, query: query.query, resultCount: 0, error: message });
      ctx.emit("research", "running", `${category}: search failed (${message})`);
    }
  });

  if (failedQueries === planned.length) {
    const first = log.find((l) => l.error)?.error ?? "unknown error";
    throw new ProviderError("tavily", "unavailable", `All research searches failed (${first}).`);
  }
  return { sources: collector.all(), log, failedQueries };
}
