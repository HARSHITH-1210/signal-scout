"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DiscoverResult, DiscoveredCompany } from "@/lib/discover/discover";
import { EASE_OUT, cn } from "@/lib/ui/cn";
import { Icon } from "./Icon";
import { send } from "./run/api";
import { Spinner } from "./ui/Button";
import { Skeleton } from "./ui/Card";
import { InfoTip, Tooltip } from "./ui/Tooltip";
import { T_PILL, T_PILL_PRIMARY } from "./ui/telemetry";


function researchHref(c: DiscoveredCompany) {
  const q = new URLSearchParams({ company: c.name });
  if (c.website) q.set("website", c.website);
  return `/runs/new?${q}`;
}

function CompanyCard({ company, index }: { company: DiscoveredCompany; index: number }) {
  const blocked = company.contact?.kind === "do_not_contact";
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT, delay: Math.min(index, 10) * 0.04 }}
      className={cn("t-card flex flex-wrap items-start gap-4 p-5", blocked && "opacity-60")}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-[16px] font-semibold tracking-[-0.01em]">{company.name}</h3>
          {company.website && <span className="t-mono text-[11px] text-[var(--t-muted)]">{company.website}</span>}
          {company.contact && (
            <span className={cn("t-label", blocked ? "text-[var(--t-bad)]" : "text-[var(--t-warn)]")}>
              {blocked ? "Do not contact" : company.contact.note ? `Relationship · ${company.contact.note}` : "Existing relationship"}
            </span>
          )}
        </div>
        {company.reason && <p className="mt-1.5 text-[14px] text-[var(--t-soft)]">{company.reason}</p>}
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`Sources for ${company.name}`}>
          {company.sources.map((s) => (
            <li key={s.url}>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={s.title}
                className="inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-[var(--t-line)] px-2.5 py-1 text-[11px] text-[var(--t-muted)] transition-colors hover:border-[var(--t-muted)] hover:text-[var(--t-fg)]"
              >
                <span className="truncate">{s.domain}</span>
                <Icon name="external" className="h-3 w-3 shrink-0" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      {blocked ? (
        <Tooltip align="end" content={`On your do-not-contact list (${company.contact!.match}).`}>
          <button type="button" disabled className={cn(T_PILL, "border border-[var(--t-line)]")}>
            Research →
          </button>
        </Tooltip>
      ) : (
        <Link href={researchHref(company)} className={T_PILL_PRIMARY}>
          Research →
        </Link>
      )}
    </motion.li>
  );
}

/** Search for companies by description; each result links to a prefilled New run. */
export function DiscoverSearch() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [searched, setSearched] = useState("");

  async function run(q: string) {
    const text = q.trim();
    if (text.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    const res = await send("/api/discover", "POST", { query: text });
    setBusy(false);
    setSearched(text);
    if (!res.ok) {
      setResult(null);
      setError(res.error);
      return;
    }
    setResult(res.data as DiscoverResult);
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(query);
  };

  return (
    <div>
      <form onSubmit={submit} role="search" className="flex flex-wrap items-center gap-2 rounded-full border border-[var(--t-pill-line)] bg-[var(--t-pill-box)] p-1.5 pl-5">
        <Icon name="search" className="h-4 w-4 text-[var(--t-muted)]" />
        <label className="min-w-0 flex-1">
          <span className="sr-only">Describe the companies you&apos;re looking for</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
            autoFocus
            className="h-10 w-full bg-transparent text-[15px] text-[var(--t-fg)] outline-none placeholder:text-[var(--t-dim)]"
          />
        </label>
        <button type="submit" disabled={busy || query.trim().length < 3} className={T_PILL_PRIMARY}>
          {busy && <Spinner />}
          {busy ? "Searching…" : "Search"}
        </button>
      </form>


      <section aria-live="polite" aria-busy={busy} className="mt-8">
        {busy ? (
          <ul className="space-y-3" aria-label="Loading results">
            {[0, 1, 2].map((i) => (
              <li key={i} className="t-card space-y-3 p-5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-full max-w-lg" />
                <Skeleton className="h-6 w-32 rounded-full" />
              </li>
            ))}
          </ul>
        ) : error ? (
          <p role="alert" className="t-card t-mono px-5 py-4 text-[12px] text-[var(--t-bad)]">
            {error}
          </p>
        ) : result ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="t-label">
                {result.companies.length} {result.companies.length === 1 ? "company" : "companies"} · “{searched}”
              </h2>
              <InfoTip label="How results are found" align="start">
                Found in {result.searched} web results. Each company is named in the sources shown{result.dropped > 0 ? `; ${result.dropped} unverified ${result.dropped === 1 ? "suggestion was" : "suggestions were"} dropped` : ""}.
              </InfoTip>
            </div>
            {result.companies.length === 0 ? (
              <p className="t-card px-5 py-8 text-center text-[14px] text-[var(--t-muted)]">No companies found. Try a broader search.</p>
            ) : (
              <ul className="space-y-3">
                <AnimatePresence initial={false}>
                  {result.companies.map((c, i) => (
                    <CompanyCard key={`${searched}-${c.name}`} company={c} index={i} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
