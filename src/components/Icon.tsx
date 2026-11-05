// Authored icon set: 16px grid, 1.6 stroke, round caps. Decorative (aria-hidden) unless a parent labels it.
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
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The product mark: a specimen tag with its eyelet. */
export function Mark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path d="M9 4h14a2 2 0 0 1 2 2v14l-9 8-9-8V6a2 2 0 0 1 2-2Z" fill="#e8eee6" />
      <circle cx="16" cy="10" r="2.6" fill="none" stroke="#1f3b2d" strokeWidth="1.8" />
      <path d="M11 16h10M11 19.5h7" stroke="#1f3b2d" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
