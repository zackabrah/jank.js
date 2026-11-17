import type { PanelMode } from "./state-strip.tsx";

export function ModeIcon({ mode }: { mode: PanelMode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="size-4"
    >
      {mode === "full" ? (
        <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
      ) : mode === "mini" ? (
        <>
          <rect x="2" y="3" width="12" height="10" rx="2" />
          <rect
            x="7.5"
            y="7.5"
            width="4.5"
            height="3.5"
            rx="0.75"
            fill="currentColor"
            stroke="none"
          />
        </>
      ) : (
        <rect x="2" y="6.25" width="12" height="3.5" rx="1.75" />
      )}
    </svg>
  );
}
