"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { parseRelationshipLines } from "@/lib/pipeline/contacts";
import type { ContactRules } from "@/lib/types";
import { SPRING_SNAPPY, cn } from "@/lib/ui/cn";
import { Icon } from "./Icon";
import { send } from "./run/api";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { SegmentedControl } from "./ui/Tabs";
import { useToast } from "./ui/Toast";

type Lists = { doNotContact: string[]; relationships: string[] };

const toLists = (rules: ContactRules): Lists => ({
  doNotContact: rules.doNotContact,
  relationships: rules.relationships.map((r) => (r.note ? `${r.match}: ${r.note}` : r.match)),
});

const clean = (lines: string[]) => lines.map((l) => l.trim()).filter(Boolean);

/** One list as removable rows with an add box; or, for bulk paste, as plain text (one entry per line). */
function ListEditor({
  id,
  title,
  hint,
  placeholder,
  items,
  onChange,
  relationship = false,
}: {
  id: string;
  title: string;
  hint: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
  relationship?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"list" | "text">("list");
  const [query, setQuery] = useState("");

  const add = () => {
    const entries = clean(draft.split(/\r?\n/));
    if (entries.length === 0) return;
    const known = new Set(items.map((i) => i.toLowerCase()));
    onChange([...items, ...entries.filter((e) => !known.has(e.toLowerCase()))]);
    setDraft("");
  };
  const preview = relationship && draft.trim() ? parseRelationshipLines(draft)[0] : null;
  const visible = query.trim() ? items.filter((i) => i.toLowerCase().includes(query.trim().toLowerCase())) : items;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id} className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
            {title}
            <span className="acc rounded-full bg-subtle px-2 py-0.5 text-[11px] font-normal text-fg-muted">{items.length}</span>
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{hint}</p>
        </div>
        <SegmentedControl
          label={`${title} view`}
          size="sm"
          value={mode}
          onChange={setMode}
          items={[
            { value: "list", label: "List" },
            { value: "text", label: "Text" },
          ]}
        />
      </div>

      {mode === "text" ? (
        <label className="mt-4 block">
          <span className="sr-only">{title}, one per line</span>
          <textarea
            rows={Math.max(4, items.length + 1)}
            value={items.join("\n")}
            onChange={(e) => onChange(e.target.value.split(/\r?\n/))}
            onBlur={() => onChange(clean(items))}
            placeholder={placeholder}
            className="acc w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed transition-[border-color,box-shadow] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
          />
          <span className="mt-1 block text-[12px] text-fg-muted">One entry per line. Paste a whole list at once.</span>
        </label>
      ) : (
        <>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">Add to {title}</span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={placeholder.split("\n")[0]}
                className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm transition-[border-color,box-shadow] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
              />
            </label>
            <Button type="submit" size="sm" className="h-10" disabled={!draft.trim()}>
              <Icon name="plus" className="h-3.5 w-3.5" />
              Add
            </Button>
          </form>
          {preview && (
            <p className="mt-1.5 text-[12px] text-fg-muted">
              Matches <span className="acc text-fg">{preview.match}</span>
              {preview.note ? (
                <>
                  {" "}
                  with the note <span className="text-fg">“{preview.note}”</span>
                </>
              ) : (
                <> with no note. Add one after a colon, like “acme.com: customer since 2023”.</>
              )}
            </p>
          )}

          {items.length > 6 && (
            <label className="relative mt-4 block">
              <span className="sr-only">Filter {title}</span>
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" className="h-9 w-full rounded-lg border border-line bg-subtle/50 pl-8 pr-3 text-[13px] focus:border-accent focus:outline-none" />
            </label>
          )}

          <ul aria-labelledby={id} className={cn("mt-4", items.length > 0 && "divide-y divide-line-soft rounded-lg border border-line")}>
            <AnimatePresence initial={false}>
              {visible.map((item) => {
                const parsed = relationship ? parseRelationshipLines(item)[0] : null;
                return (
                  <motion.li
                    key={item}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ ...SPRING_SNAPPY, opacity: { duration: 0.15 } }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="acc text-[13px] text-fg">{parsed ? parsed.match : item}</span>
                        {parsed?.note && <span className="ml-2 text-[13px] text-fg-muted">{parsed.note}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => onChange(items.filter((i) => i !== item))}
                        aria-label={`Remove ${item}`}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-danger-soft hover:text-danger"
                      >
                        <Icon name="cross" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
          {items.length === 0 && <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-fg-muted">Nothing here yet.</p>}
        </>
      )}
    </Card>
  );
}

/** The rep's own contact list, checked before any research and before any send. */
export function ContactRulesPanel({ initial }: { initial: ContactRules }) {
  const [saved, setSaved] = useState(toLists(initial));
  const [values, setValues] = useState(saved);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dirty = clean(values.doNotContact).join("\n") !== saved.doNotContact.join("\n") || clean(values.relationships).join("\n") !== saved.relationships.join("\n");

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  async function save() {
    setBusy(true);
    const rules: ContactRules = {
      doNotContact: clean(values.doNotContact),
      relationships: parseRelationshipLines(clean(values.relationships).join("\n")),
    };
    const result = await send("/api/settings/contacts", "PUT", rules);
    setBusy(false);
    if (!result.ok) return toast({ tone: "bad", title: "Couldn't save the list", description: result.error });
    const next = toLists((result.data as { rules: ContactRules }).rules);
    setSaved(next);
    setValues(next);
    toast({ tone: "ok", title: "Contact list saved", description: "New runs are checked against it before any research." });
  }

  return (
    <div className="space-y-6">
      <ListEditor
        id="dnc-title"
        title="Do not contact"
        hint="Opt-outs: an email, domain or company. Never researched, never sent to."
        placeholder={"priya@example.com\nexample.com"}
        items={values.doNotContact}
        onChange={(doNotContact) => setValues((v) => ({ ...v, doNotContact }))}
      />
      <ListEditor
        id="rel-title"
        title="Existing relationships"
        hint="Customers, open deals, past contacts. The run stops and shows your note."
        placeholder={"acme.com: customer since 2023\nGlobex: open deal, owner Sam"}
        items={values.relationships}
        onChange={(relationships) => setValues((v) => ({ ...v, relationships }))}
        relationship
      />

      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[min(520px,calc(100vw-2rem))] items-center gap-3 rounded-2xl border border-line bg-surface/90 py-2.5 pl-4 pr-2.5 shadow-[var(--shadow-overlay)] backdrop-blur-md"
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
