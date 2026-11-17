const states = {
  live: { text: "Live", name: "Collecting", glyph: "●", classes: "bg-green-200 text-jank-live" },
  frozen: {
    text: "Frozen",
    name: "Display frozen",
    glyph: "▣",
    classes: "bg-teal-200 text-jank-frozen",
  },
  recording: { text: "Rec", name: "Recording", glyph: "●", classes: "bg-jank-rec text-white" },
  armed: {
    text: "Armed",
    name: "Auto-capture armed",
    glyph: "◎",
    classes: "bg-purple-200 text-jank-capture",
  },
  capturing: {
    text: "Capturing",
    name: "Capturing",
    glyph: "◉",
    classes: "bg-jank-capture text-jank-surface",
  },
  cooldown: {
    text: "Cooldown",
    name: "Auto-capture cooldown",
    glyph: "◌",
    classes: "border border-dashed border-purple-700 text-jank-capture",
  },
  comparing: {
    text: "A/B",
    name: "Comparison running",
    glyph: "⇄",
    classes: "border border-blue-700 text-blue-900",
  },
  activity: { text: "Loading", name: "Loading", glyph: "◐", classes: "bg-gray-200 text-jank-text" },
};

export function StateBadge({
  state,
  detail,
  id,
  hidden,
  compact = false,
}: {
  state: keyof typeof states;
  detail?: string;
  id?: string;
  hidden?: boolean;
  compact?: boolean;
}) {
  const { text, name, glyph, classes } = states[state];
  return (
    <span
      id={id}
      role="status"
      aria-label={name}
      title={name}
      hidden={hidden}
      class={`inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full px-2 font-sans text-label-12 font-medium tabular-nums ${compact ? "" : "gap-1"} ${classes}`}
    >
      {state === "cooldown" ? (
        <svg
          aria-hidden="true"
          class="size-3 shrink-0"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <circle cx="6" cy="6" r="4.5" stroke-dasharray="1 3" />
        </svg>
      ) : (
        <span aria-hidden="true">{glyph}</span>
      )}
      {!compact && text}
      {(!compact || state === "activity" || state === "comparing") && detail && (
        <span aria-hidden="true">{detail}</span>
      )}
    </span>
  );
}
