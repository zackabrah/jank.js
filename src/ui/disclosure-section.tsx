import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { ChevronIcon } from "./icons.tsx";

export function DisclosureSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section class="border-t border-jank-divider">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        class="group focus-ring flex h-8 w-full items-center gap-1.5 whitespace-nowrap text-left font-sans text-label-13 font-medium text-jank-text hover:bg-gray-alpha-100 focus-visible:-outline-offset-2"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronIcon class="group-aria-expanded:rotate-90" />
        {title}
        {!open && (
          <span class="ml-auto truncate pl-2 font-mono text-label-12 font-normal text-jank-text-secondary">
            {summary}
          </span>
        )}
      </button>
      <div id={contentId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
