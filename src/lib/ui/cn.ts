/** Join class names, skipping falsy values. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Shared motion tokens (see DESIGN.md § Motion). */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const SPRING_SNAPPY = { type: "spring", stiffness: 500, damping: 35 } as const;
export const SPRING_SOFT = { type: "spring", stiffness: 300, damping: 30 } as const;

/** Enter transition for list items and cards: rise, fade and unblur. */
export const RISE_IN = {
  initial: { opacity: 0, y: 8, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.3, ease: EASE_OUT },
} as const;
