import { withUnit } from "../src/format.ts";
import { ResetIcon } from "../src/ui/icons.tsx";
import "./components.css";
import { render } from "preact";
import { useId, useState } from "preact/hooks";
import { Button, IconButton } from "../src/ui/button.tsx";
import { DisclosureSection } from "../src/ui/disclosure-section.tsx";
import { Notice } from "../src/ui/notice.tsx";
import { StateBadge } from "../src/ui/state-badge.tsx";

function Examples({ light = false }: { light?: boolean }) {
  const reasonId = useId();
  const [pressed, setPressed] = useState(false);
  const [explanations, setExplanations] = useState(0);
  const [actions, setActions] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  return (
    <section
      class={`rounded-xl border border-jank-divider bg-jank-surface p-4 text-jank-text ${light ? "light-theme" : "dark-theme"}`}
    >
      <h2 class="mb-4 text-heading-16">{light ? "Light" : "Dark"}</h2>
      <div class="mb-4 flex flex-wrap gap-2">
        <Button variant="primary" onPress={() => setActions((n) => n + 1)}>
          Primary
        </Button>
        <Button pressed={pressed} onPress={() => setPressed((value) => !value)}>
          Toggle pressed
        </Button>
        <IconButton
          label="Reset demo counts"
          onPress={() => {
            setActions(0);
            setExplanations(0);
          }}
        >
          <ResetIcon />
        </IconButton>
        <Button
          onPress={() => setActions((n) => n + 1)}
          unavailable={{
            reason: "This example action is unavailable.",
            reasonId,
            onExplain: () => setExplanations((n) => n + 1),
          }}
        >
          Unavailable action
        </Button>
      </div>
      <Notice id={reasonId} tone="warning">
        This example action is unavailable. Pressing it explains the restriction without running the
        action.
      </Notice>
      <p role="status" class="my-3 font-mono text-label-12">
        Actions: {actions} · Explanations: {explanations} · Pressed: {String(pressed)}
      </p>
      <DisclosureSection title="Example section" summary="A preserved text field" defaultOpen>
        <div class="py-3">
          <label class="block text-label-13">
            Example value
            <input
              class="focus-ring mt-2 block h-8 w-full rounded-md border border-jank-control bg-jank-fill px-2"
              defaultValue="Collapse keeps this value"
            />
          </label>
        </div>
      </DisclosureSection>
      <div class="my-4 flex flex-wrap gap-2">
        <StateBadge state="live" />
        <StateBadge state="frozen" />
        <StateBadge state="recording" detail={withUnit(4.2, "s")} />
        <StateBadge state="armed" />
        <StateBadge state="capturing" />
        <StateBadge state="cooldown" detail={withUnit(3, "s")} />
        <StateBadge state="activity" detail="2" />
      </div>
      <div class="grid gap-3">
        <Notice>Neutral information pushes content down.</Notice>
        <Notice tone="success">The capture was saved.</Notice>
        <Notice tone="frozen">The display is frozen. Collection continues.</Notice>
        <Notice tone="pending">Changes apply when you re-arm.</Notice>
        {!dismissed ? (
          <Notice tone="error" onDismiss={() => setDismissed(true)}>
            Example failure. The existing recording is preserved.
          </Notice>
        ) : (
          <Button onPress={() => setDismissed(false)}>Show error again</Button>
        )}
      </div>
    </section>
  );
}
const root = document.getElementById("app");
if (!root) throw new Error("Missing review root");
render(
  <main class="mx-auto max-w-5xl p-8">
    <h1 class="mb-3 text-heading-24">Shared component review</h1>
    <p class="mb-6 text-copy-13 text-jank-text-secondary">
      Demo state only. Tab through controls; use Enter or Space. Unavailable actions explain
      themselves. Disclosures preserve their contents.
    </p>
    <div class="grid grid-cols-2 gap-6">
      <Examples />
      <Examples light />
    </div>
  </main>,
  root,
);
import.meta.hot?.dispose(() => render(null, root));

if (import.meta.env.DEV) void import("../devtools/index.tsx");
