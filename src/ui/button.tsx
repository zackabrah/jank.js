import type { ComponentChildren } from "preact";

type ActionProps = {
  children: ComponentChildren;
  onPress?: () => void;
  type?: "button" | "submit";
  pressed?: boolean;
  compact?: boolean;
  fullWidth?: boolean;
  tone?: "capture";
  unavailable?: { reason: string; reasonId: string; onExplain: () => void } | undefined;
};
type ButtonProps = ActionProps &
  ({ variant?: "secondary" | "primary"; label?: never } | { variant: "icon"; label: string });

const variants = {
  secondary:
    "gap-1.5 border border-gray-alpha-400 bg-jank-surface px-2 text-jank-text hover:bg-gray-alpha-100",
  primary: "bg-jank-text px-3 text-jank-surface hover:bg-gray-900",
  icon: "justify-center text-jank-text-secondary hover:bg-gray-alpha-200 hover:text-jank-text",
};

export function Button({
  children,
  onPress,
  pressed,
  unavailable,
  variant = "secondary",
  label,
  compact = false,
  fullWidth = false,
  tone,
  type = "button",
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      aria-disabled={unavailable ? true : undefined}
      aria-describedby={unavailable?.reasonId}
      title={unavailable?.reason}
      class={`focus-ring inline-flex flex-none items-center whitespace-nowrap rounded-md font-sans text-label-13 font-medium aria-disabled:cursor-not-allowed aria-disabled:border-gray-400 aria-disabled:bg-gray-100 aria-disabled:text-jank-text-disabled ${tone === "capture" ? "aria-pressed:bg-purple-200 aria-pressed:border-purple-700 aria-pressed:text-purple-1000" : "aria-pressed:bg-gray-200 aria-pressed:text-jank-text"} ${variants[variant]} ${fullWidth ? "w-full justify-center" : ""} ${variant === "icon" ? (compact ? "size-6 focus-visible:-outline-offset-2" : "size-8") : compact ? "h-6" : "h-8"}`}
      onClick={(event) => {
        if (unavailable) {
          event.preventDefault();
          unavailable.onExplain();
        } else onPress?.();
      }}
    >
      {children}
    </button>
  );
}

export function IconButton(props: ActionProps & { label: string }) {
  return <Button {...props} variant="icon" />;
}
