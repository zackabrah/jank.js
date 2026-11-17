import type { ComponentChildren } from "preact";

/**
 * 16 px Geist-style stroke icons. Buttons carry the accessible name; icons stay hidden from
 * assistive technology. Never use Unicode characters as button icons.
 */
function Icon({
  class: className = "size-4",
  children,
}: {
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

/**
 * Right-pointing chevron for disclosures. The caller rotates it from state with a group variant
 * (`group-aria-expanded:rotate-90` on buttons, `group-open:rotate-90` in details), so script never
 * swaps glyphs.
 */
export function ChevronIcon({ class: className = "" }: { class?: string }) {
  return (
    <Icon
      class={`size-3 text-jank-text-secondary transition-transform motion-reduce:transition-none ${className}`}
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Icon>
  );
}

export function DismissIcon() {
  return (
    <Icon class="size-3.5">
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}

export function ResetIcon() {
  return (
    <Icon>
      <path d="M3 8a5 5 0 1 0 1.5-3.57" />
      <path d="M3 2.5v2.5h2.5" />
    </Icon>
  );
}
