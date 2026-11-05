import type { ComponentChildren } from "preact";
import { IconButton } from "./button.tsx";
import { DismissIcon } from "./icons.tsx";

const tones = {
  info: "border-gray-400 bg-gray-100 text-gray-1000",
  warning: "border-amber-400 bg-amber-100 text-amber-1000",
  error: "border-red-400 bg-red-100 text-red-1000",
  success: "border-green-400 bg-green-100 text-green-1000",
  frozen: "border-teal-400 bg-teal-100 text-teal-1000",
  pending: "border-purple-400 bg-purple-100 text-purple-1000",
};
const glyphs = { info: "ⓘ", warning: "⊘", error: "✕", success: "✓", frozen: "▣", pending: "◎" };

export function Notice({
  tone = "info",
  children,
  action,
  onDismiss,
  id,
  role,
}: {
  tone?: keyof typeof tones;
  children: ComponentChildren;
  action?: ComponentChildren;
  onDismiss?: () => void;
  id?: string;
  /** Errors are alerts by default; a cancelled run is reported politely as a status (guide 4.6). */
  role?: "status" | "alert";
}) {
  return (
    <div
      id={id}
      role={role ?? (tone === "error" ? "alert" : "status")}
      class={`relative flex items-start gap-2 rounded-md border py-2 pl-3 font-sans text-copy-13 ${onDismiss ? "pr-12" : "pr-3"} ${tones[tone]}`}
    >
      <span aria-hidden="true">{glyphs[tone]}</span>
      <div class="min-w-0 flex-1">
        <div>{children}</div>
        {action && <div class="mt-2">{action}</div>}
      </div>
      {onDismiss && (
        <div class="absolute inset-y-0 right-1 flex items-center">
          <IconButton label="Dismiss notice" onPress={onDismiss}>
            <DismissIcon />
          </IconButton>
        </div>
      )}
    </div>
  );
}
