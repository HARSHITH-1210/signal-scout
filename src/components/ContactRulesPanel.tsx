"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toCsv } from "@/lib/contacts/importer";
import { ENTRY_KIND_LABEL, entryKey, entryKind, normaliseEntry, RELATIONSHIP_KINDS, relationshipLabel, type EntryKind } from "@/lib/contacts/rules";
import { checkContactRules, type ContactSubject } from "@/lib/pipeline/contacts";
import type { ContactRules, RelationshipEntry, RelationshipKind } from "@/lib/types";
import { cn } from "@/lib/ui/cn";
import { ImportDialog, LIST_TITLE, selectClass, type ListName } from "./contacts/ImportDialog";
import { Icon } from "./Icon";
import { send } from "./run/api";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { useConfirm } from "./ui/Dialog";
import { useToast } from "./ui/Toast";

const PAGE = 100;
const inputClass =
  "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm transition-[border-color,box-shadow] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15";

const KIND_STYLE: Record<EntryKind, string> = {
  email: "bg-info-soft text-info",
  domain: "bg-accent-soft text-accent",
  company: "bg-subtle text-fg-muted",
};

function KindBadge({ value }: { value: string }) {
  const kind = entryKind(value);
  return <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]", KIND_STYLE[kind])}>{ENTRY_KIND_LABEL[kind]}</span>;
}

const MATCH_HELP: Record<EntryKind, (v: string) => string> = {
  email: (v) => `Matches only ${v}`,
  domain: (v) => `Matches anyone at ${v} (their email or company website), including subdomains`,
  company: (v) => `Matches a prospect whose company is ${v}`,
};

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/** What the page explains up front: the two lists, how entries match, and when they're checked. */
function HowItWorks() {
  return (
    <Card className="p-5 sm:p-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <h2 className="flex items-center gap-2 text-[14px] font-semibold">
            <span aria-hidden className="h-2 w-2 rounded-full bg-danger" />
            Do not contact
          </h2>
          <p className="mt-1 text-[13px] text-fg-muted">People who opted out, competitors, anyone off-limits. A match is never researched and never emailed. Nothing overrides it.</p>
        </div>
        <div>
          <h2 className="flex items-center gap-2 text-[14px] font-semibold">
            <span aria-hidden className="h-2 w-2 rounded-full bg-warn" />
            Existing relationships
          </h2>
          <p className="mt-1 text-[13px] text-fg-muted">Customers, open deals, past contacts, partners. A match pauses the run before research and shows your note; you decide whether to go ahead.</p>
        </div>
      </div>
      <div className="mt-5 border-t border-line-soft pt-4">
        <p className="t-label">Each entry is one of</p>
        <ul className="mt-2 grid gap-2 text-[13px] text-fg-muted sm:grid-cols-3">
          {(["email", "domain", "company"] as EntryKind[]).map((k) => (
            <li key={k} className="flex items-start gap-2">
              <span className={cn("mt-px shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]", KIND_STYLE[k])}>{ENTRY_KIND_LABEL[k]}</span>
              <span>{k === "email" ? "That one address" : k === "domain" ? "Everyone at that domain" : "That company, by name"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-fg-muted">Checked when a run starts, again once the prospect is identified, and right before any email is sent.</p>
      </div>
    </Card>
  );
}

/** Type an email, website or company to see what a run would do with it, using the lists as edited (saved or not). */
function CheckContact({ rules }: { rules: ContactRules }) {
  const [value, setValue] = useState("");
  const result = useMemo(() => {
    const n = normaliseEntry(value);
    if (!value.trim()) return null;
    if (!n.ok) return { tone: "muted" as const, text: n.reason };
    const subject: ContactSubject = n.kind === "email" ? { email: n.value } : n.kind === "domain" ? { website: n.value, domain: n.value } : { company: n.value };
    const hold = checkContactRules(subject, rules);
    if (!hold)
      return {
        tone: "ok" as const,
        text:
          n.kind === "company"
            ? "No match by name. A run would go ahead, but domain entries are also checked once the run finds the company's website."
            : "No match. A run would go ahead (company-name entries are also checked once the run identifies the company).",
      };
    if (hold.kind === "do_not_contact") return { tone: "bad" as const, text: `Blocked by Do not contact (${hold.match}). Never researched or emailed.` };
    return { tone: "warn" as const, text: `Paused: existing relationship (${hold.match})${hold.note ? `, ${hold.note}` : ""}. You'd choose whether to go ahead.` };
  }, [value, rules]);

  return (
    <Card className="p-5 sm:p-6">
      <label className="block">
        <span className="text-[14px] font-semibold">Check a contact</span>
        <span className="block text-[12px] text-fg-muted">An email, website or company name, checked against both lists as they are now</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} className={cn(inputClass, "mt-2")} autoComplete="off" />
      </label>
      {result && (
        <p
          role="status"
          className={cn(
            "mt-2 text-[13px]",
            result.tone === "bad" ? "text-danger" : result.tone === "warn" ? "text-warn" : result.tone === "ok" ? "text-ok" : "text-fg-muted",
          )}
        >
          {result.text}
        </p>
      )}
    </Card>
  );
}

/** One list: add, filter, edit, remove, import, export, clear. */
function ListCard({
  list,
  rules,
  onChange,
  onImport,
}: {
  list: ListName;
  rules: ContactRules;
  onChange: (next: ContactRules) => void;
  onImport: () => void;
}) {
  const rel = list === "relationships";
  const entries: RelationshipEntry[] = rel ? rules.relationships : rules.doNotContact.map((match) => ({ match, note: "" }));
  const [match, setMatch] = useState("");
  const [kind, setKind] = useState<RelationshipKind>("customer");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const confirm = useConfirm();
  const titleId = `${list}-title`;

  const preview = match.trim() ? normaliseEntry(match) : null;
  const onOtherList = preview?.ok && rel && rules.doNotContact.some((d) => entryKey(d) === entryKey(preview.value));

  const set = (next: RelationshipEntry[]) =>
    onChange(rel ? { ...rules, relationships: next } : { ...rules, doNotContact: next.map((e) => e.match) });

  function add() {
    const n = normaliseEntry(match);
    if (!n.ok) return setError(n.reason);
    if (entries.some((e) => entryKey(e.match) === entryKey(n.value))) return setError(`${n.value} is already in this list.`);
    set([{ match: n.value, ...(rel ? { kind } : {}), note: rel ? note.trim() : "" }, ...entries]);
    setMatch("");
    setNote("");
    setError(null);
  }

  async function clearAll() {
    const ok = await confirm({
      title: `Clear ${LIST_TITLE[list]}?`,
      description: `All ${entries.length.toLocaleString("en")} entries are removed when you save. Export first if you might want them back.`,
      confirmLabel: "Clear list",
      tone: "danger",
    });
    if (ok) set([]);
  }

  const q = query.trim().toLowerCase();
  const visible = q ? entries.filter((e) => e.match.toLowerCase().includes(q) || e.note.toLowerCase().includes(q) || (relationshipLabel(e.kind) ?? "").toLowerCase().includes(q)) : entries;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
          <span aria-hidden className={cn("h-2 w-2 rounded-full", rel ? "bg-warn" : "bg-danger")} />
          {LIST_TITLE[list]}
          <span className="acc rounded-full bg-subtle px-2 py-0.5 text-[11px] font-normal text-fg-muted">{entries.length.toLocaleString("en")}</span>
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={onImport}>
            <Icon name="upload" className="h-3.5 w-3.5" />
            Import CSV
          </Button>
          {entries.length > 0 && (
            <>
              <Button size="sm" variant="ghost" onClick={() => download(rel ? "existing-relationships.csv" : "do-not-contact.csv", toCsv(list, rel ? rules.relationships : rules.doNotContact))}>
                <Icon name="download" className="h-3.5 w-3.5" />
                Export
              </Button>
              <Button size="sm" variant="ghost" className="hover:bg-danger-soft hover:text-danger" onClick={clearAll}>
                Clear
              </Button>
            </>
          )}
        </div>
      </div>

      <form
        className={cn("mt-4 grid gap-2", rel ? "sm:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1.4fr)_auto]" : "sm:grid-cols-[minmax(0,1fr)_auto]")}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="block min-w-0">
          <span className="text-[12px] font-medium text-fg-muted">Email, domain or company</span>
          <input
            value={match}
            onChange={(e) => {
              setMatch(e.target.value);
              setError(null);
            }}
            aria-invalid={Boolean(error)}
            className={cn(inputClass, "mt-1")}
            autoComplete="off"
          />
        </label>
        {rel && (
          <>
            <label className="block">
              <span className="text-[12px] font-medium text-fg-muted">Type</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as RelationshipKind)} className={cn(selectClass, "mt-1 w-full")}>
                {RELATIONSHIP_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="text-[12px] font-medium text-fg-muted">Note (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={cn(inputClass, "mt-1")} autoComplete="off" />
            </label>
          </>
        )}
        <Button type="submit" size="sm" className="h-10 self-end" disabled={!match.trim()}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          Add
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-1.5 text-[12px] text-danger">
          {error}
        </p>
      ) : (
        preview && (
          <p className="mt-1.5 text-[12px] text-fg-muted">
            {preview.ok ? MATCH_HELP[preview.kind](preview.value) : <span className="text-danger">{preview.reason}</span>}
            {onOtherList && <span className="text-warn"> · It&apos;s also on Do not contact, which always wins.</span>}
          </p>
        )
      )}

      {entries.length > 6 && (
        <label className="relative mt-4 block">
          <span className="sr-only">Filter {LIST_TITLE[list]}</span>
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-subtle/50 pl-8 pr-3 text-[13px] focus:border-accent focus:outline-none" />
        </label>
      )}

      {entries.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-fg-muted">
          Nothing here yet. Add entries above, or import a CSV.
        </p>
      ) : (
        <>
          <ul aria-labelledby={titleId} className="mt-4 divide-y divide-line-soft rounded-lg border border-line">
            <AnimatePresence initial={false}>
              {visible.slice(0, shown).map((entry) => (
                <motion.li
                  key={entry.match}
                  layout="position"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
                >
                  <KindBadge value={entry.match} />
                  <span className="acc min-w-0 flex-1 truncate text-[13px] text-fg" title={entry.match}>
                    {entry.match}
                  </span>
                  {rel && (
                    <>
                      <select
                        aria-label={`Type for ${entry.match}`}
                        value={entry.kind ?? "other"}
                        onChange={(e) => set(entries.map((x) => (x.match === entry.match ? { ...x, kind: e.target.value as RelationshipKind } : x)))}
                        className={cn(selectClass, "h-8 text-[13px]")}
                      >
                        {RELATIONSHIP_KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={`Note for ${entry.match}`}
                        value={entry.note}
                        maxLength={300}
                        onChange={(e) => set(entries.map((x) => (x.match === entry.match ? { ...x, note: e.target.value } : x)))}
                        className="h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-[13px] text-fg-muted hover:border-line focus:border-accent focus:text-fg focus:outline-none sm:w-64"
                      />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => set(entries.filter((x) => x.match !== entry.match))}
                    aria-label={`Remove ${entry.match}`}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-danger-soft hover:text-danger"
                  >
                    <Icon name="cross" className="h-3.5 w-3.5" />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {q && visible.length === 0 && <p className="mt-3 text-[13px] text-fg-muted">No entries match that filter.</p>}
          {visible.length > shown && (
            <Button size="sm" variant="ghost" className="mt-3" onClick={() => setShown((s) => s + PAGE * 2)}>
              Show more ({(visible.length - shown).toLocaleString("en")} hidden)
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

const same = (a: ContactRules, b: ContactRules) => JSON.stringify(a) === JSON.stringify(b);

/** The rep's contact list, checked before any research and before any send. */
export function ContactRulesPanel({ initial }: { initial: ContactRules }) {
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState<{ target: ListName; key: number } | null>(null);
  const toast = useToast();
  const dirty = !same(values, saved);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  async function save() {
    setBusy(true);
    const result = await send("/api/settings/contacts", "PUT", values);
    setBusy(false);
    if (!result.ok) return toast({ tone: "bad", title: "Couldn't save the contact list", description: result.error });
    const next = (result.data as { rules: ContactRules }).rules;
    setSaved(next);
    setValues(next);
    toast({ tone: "ok", title: "Contact list saved", description: "Every new run is checked against it." });
  }

  function imported(target: ListName, added: ContactRules) {
    const count = target === "doNotContact" ? added.doNotContact.length : added.relationships.length;
    setValues((v) =>
      target === "doNotContact" ? { ...v, doNotContact: [...added.doNotContact, ...v.doNotContact] } : { ...v, relationships: [...added.relationships, ...v.relationships] },
    );
    toast({ tone: "ok", title: `${count.toLocaleString("en")} ${count === 1 ? "entry" : "entries"} added to ${LIST_TITLE[target]}`, description: "Save the list to apply them." });
  }

  const openImport = (target: ListName) => setImporting((i) => ({ target, key: (i?.key ?? 0) + 1 }));

  return (
    <div className="space-y-6 pb-20">
      <HowItWorks />
      <CheckContact rules={values} />
      <ListCard list="doNotContact" rules={values} onChange={setValues} onImport={() => openImport("doNotContact")} />
      <ListCard list="relationships" rules={values} onChange={setValues} onImport={() => openImport("relationships")} />

      {importing && (
        <ImportDialog key={importing.key} open initialTarget={importing.target} rules={values} onClose={() => setImporting(null)} onImport={imported} />
      )}

      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] sm:bottom-4 z-40 mx-auto flex w-[min(520px,calc(100vw-2rem))] items-center gap-3 rounded-2xl border border-line bg-surface/90 py-2.5 pl-4 pr-2.5 shadow-[var(--shadow-overlay)] backdrop-blur-md"
          >
            <span className="flex flex-1 items-center gap-2 text-sm text-fg-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />
              Unsaved changes
            </span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setValues(saved)}>
              Discard
            </Button>
            <Button size="sm" variant="primary" onClick={save} loading={busy}>
              {busy ? "Saving…" : "Save list"}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
