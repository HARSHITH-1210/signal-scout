import type { LlmProvider } from "../providers/llm";
import type { SearchProvider, SearchResult } from "../providers/search";
import type { SenderProfile, Source, SourceCategory, StageName, StageStatus } from "../types";
import { chunkText } from "../documents/parse";
import { looksLikePromptInjection, sanitizeText } from "./sanitize";
import { assessReliability, domainOf } from "./sourceReliability";

const SUSPICIOUS = { score: 0.05, label: "Contains instructions aimed at AI (treated as untrusted)" };

export interface PipelineDeps {
  search: SearchProvider;
  llm: LlmProvider;
  now: () => Date;
}

export interface StageContext {
  runId: string;
  deps: PipelineDeps;
  sender: SenderProfile;
  emit: (stage: StageName, status: StageStatus, message: string, detail?: Record<string, unknown>) => void;
}

export function normaliseUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$|^gclid$/i.test(key)) u.searchParams.delete(key);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Accumulates deduplicated sources with stable ids (S1, S2, ...) across stages of one run. */
export class SourceCollector {
  private readonly byUrl = new Map<string, Source>();

  constructor(existing: Source[] = []) {
    for (const s of existing) this.byUrl.set(normaliseUrl(s.url), s);
  }

  add(result: SearchResult, category: SourceCategory, companyDomain: string | null): Source | null {
    const key = normaliseUrl(result.url);
    const existing = this.byUrl.get(key);
    if (existing) return existing;
    const text = sanitizeText(result.rawContent && result.rawContent.length > result.content.length ? result.rawContent : result.content);
    if (text.length < 40) return null; // nothing to verify against
    const domain = domainOf(result.url);
    if (!domain) return null;
    const suspicious = looksLikePromptInjection(`${result.title}\n${result.rawContent ?? ""}\n${result.content}`);
    const reliability = suspicious ? SUSPICIOUS : assessReliability(domain, companyDomain);
    const source: Source = {
      id: `S${this.byUrl.size + 1}`,
      url: result.url,
      title: sanitizeText(result.title, 300),
      domain,
      publishedDate: result.publishedDate,
      category,
      text,
      suspicious,
      reliability: reliability.score,
      reliabilityLabel: reliability.label,
      origin: "web",
      fetchedAt: new Date().toISOString(),
    };
    this.byUrl.set(key, source);
    return source;
  }

  /**
   * Adds a rep-uploaded document as one or more sources (long files are split into chunks so each
   * fits a source slot). Quotes from it are verified against this exact text, like a web page.
   */
  addDocument(doc: { name: string; text: string }): Source[] {
    const added: Source[] = [];
    const parts = chunkText(sanitizeText(doc.text, 60_000), 3200, 200).slice(0, 6);
    parts.forEach((text, i) => {
      const url = `upload://${encodeURIComponent(doc.name)}${parts.length > 1 ? `#part-${i + 1}` : ""}`;
      const key = normaliseUrl(url);
      if (this.byUrl.has(key) || text.length < 20) return;
      const suspicious = looksLikePromptInjection(text);
      const source: Source = {
        id: `S${this.byUrl.size + 1}`,
        url,
        title: parts.length > 1 ? `${doc.name} (part ${i + 1} of ${parts.length})` : doc.name,
        domain: "your document",
        publishedDate: null,
        category: "document",
        text,
        suspicious,
        reliability: suspicious ? SUSPICIOUS.score : 0.85,
        reliabilityLabel: suspicious ? SUSPICIOUS.label : "Your document",
        origin: "prospect_document",
        fetchedAt: new Date().toISOString(),
      };
      this.byUrl.set(key, source);
      added.push(source);
    });
    return added;
  }

  /** Re-tier reliability once the company's own domain is known. */
  rescore(companyDomain: string | null) {
    for (const source of this.byUrl.values()) {
      if (source.suspicious || source.origin === "prospect_document") continue;
      const r = assessReliability(source.domain, companyDomain);
      source.reliability = r.score;
      source.reliabilityLabel = r.label;
    }
  }

  get size() {
    return this.byUrl.size;
  }

  all(): Source[] {
    return [...this.byUrl.values()];
  }
}

export function isoDateDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}
