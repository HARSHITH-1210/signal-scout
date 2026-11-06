"use client";

import { useTheme } from "next-themes";
import { useMounted } from "../ui/Motion";
import { SegmentedControl } from "../ui/Tabs";

const SUN = "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85";
const MOON = "M13.2 9.6A5.5 5.5 0 0 1 6.4 2.8a5.5 5.5 0 1 0 6.8 6.8Z";
const SYSTEM = "M2.5 3.5h11v7.5h-11zM6 13.5h4M8 11v2.5";

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
      <path d={d} />
    </svg>
  );
}

type Mode = "system" | "light" | "dark";

/** System / Light / Dark. Rendered only after mount so server and client markup match. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  if (!mounted) return <div aria-hidden className="h-[34px] w-[94px] rounded-lg border border-line bg-subtle" />;
  return (
    <SegmentedControl<Mode>
      label="Colour theme"
      size="sm"
      value={(theme as Mode) ?? "system"}
      onChange={setTheme}
      items={[
        { value: "system", label: <Glyph d={SYSTEM} />, title: "System theme" },
        { value: "light", label: <Glyph d={SUN} />, title: "Light theme" },
        { value: "dark", label: <Glyph d={MOON} />, title: "Dark theme" },
      ]}
    />
  );
}
