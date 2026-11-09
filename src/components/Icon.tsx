// Authored icon set: 16px grid, 1.5 stroke, round caps. Decorative (aria-hidden) unless a parent labels it.
const PATHS = {
  runs: "M3 4h10M3 8h10M3 12h6",
  plus: "M8 3v10M3 8h10",
  sender: "M8 8.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM3 13.5c.8-2.2 2.7-3.3 5-3.3s4.2 1.1 5 3.3",
  check: "M3.5 8.5l3 3 6-7",
  alert: "M8 4.5v4.25M8 11.25v.01",
  cross: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  dash: "M4.5 8h7",
  external: "M9.5 3.5h3v3M12.5 3.5L7.5 8.5M11 9.5v2.5a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 1 .5-.5H7",
  arrowLeft: "M9.5 4L5.5 8l4 4",
  upload: "M8 10.5V3M5 6l3-3 3 3M3 10.5v2a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-2",
  file: "M4 2.5h5l3 3v8a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-10.5a.5.5 0 0 1 .5-.5ZM9 2.5v3h3",
  table: "M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11M6.5 3.5v9",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5M6.8 7v4M9.2 7v4",
  copy: "M5.5 5.5h7v7h-7zM10.5 5.5v-2h-7v7h2",
  refresh: "M12.5 8a4.5 4.5 0 1 1-1.3-3.2M12.5 3v2.5H10",
  chevron: "M6 4l4 4-4 4",
  doc: "M4.5 2.5h7v11h-7zM6.5 5.5h3M6.5 8h3M6.5 10.5h2",
  mail: "M2.5 4h11v8h-11zM2.5 4.5l5.5 4 5.5-4",
  edit: "M10.5 3l2.5 2.5L6 12.5H3.5V10zM9 4.5l2.5 2.5",
  search: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM14 14l-3.5-3.5",
  signOut: "M6.5 13.5h-3v-11h3M10 11l3-3-3-3M13 8H6.5",
  arrowRight: "M3 8h10M9 4l4 4-4 4",
  spark: "M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M4 12l1.8-1.8M10.2 5.8 12 4",
  clock: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 4.5V8l2.5 1.5",
  globe: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM2 8h12M8 2c1.6 1.7 2.4 3.7 2.4 6S9.6 12.3 8 14M8 2C6.4 3.7 5.6 5.7 5.6 8s.8 4.3 2.4 6",
  stop: "M4.5 4.5h7v7h-7z",
  more: "M4 8h.01M8 8h.01M12 8h.01",
  shield: "M8 2l5 2v4c0 3-2.2 5.2-5 6-2.8-.8-5-3-5-6V4z",
  contacts: "M6 7.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM2 13c.6-2 2.1-3 4-3s3.4 1 4 3M10.5 3.2a2.2 2.2 0 0 1 0 4.1M12 10.2c1 .4 1.7 1.3 2 2.8",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The product mark: an obsidian tile with a signal rising from a point. */
export function Mark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`bg-obsidian-gradient inline-grid shrink-0 place-items-center rounded-[28%] ${className}`}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="h-[58%] w-[58%]">
        <circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none" />
        <path d="M4 7.5a4.5 4.5 0 0 1 4.5 4.5" opacity="0.85" />
        <path d="M4 3a9 9 0 0 1 9 9" opacity="0.55" />
      </svg>
    </span>
  );
}
