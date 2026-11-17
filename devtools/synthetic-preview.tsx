import "./synthetic-preview.css";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { mountLivePanel } from "../src/live/panel.tsx";
import { Button } from "../src/ui/button.tsx";
import { createSyntheticSource } from "./synthetic-source.ts";

function SyntheticPreview() {
  const container = useRef<HTMLDivElement>(null);
  const source = useRef<ReturnType<typeof createSyntheticSource> | null>(null);
  const [phase, setPhase] = useState("Smooth");
  const [paused, setPaused] = useState(false);
  const playing = useRef(true);
  useEffect(() => {
    if (!container.current) return;
    const demo = createSyntheticSource();
    source.current = demo;
    const panel = mountLivePanel(container.current, {
      onBudgetChange: (budget) => {
        demo.setBudget(budget);
        panel.update(demo.snapshot());
      },
    });
    panel.update(demo.snapshot());
    const timer = setInterval(() => {
      if (!playing.current) return;
      panel.update(demo.advance(250));
      setPhase(demo.phase);
    }, 250);
    return () => {
      clearInterval(timer);
      source.current = null;
      panel.destroy();
    };
  }, []);
  return (
    <section aria-label="Synthetic performance demo">
      <p class="my-3 text-copy-13 text-jank-text-secondary">
        Repeats smooth frames → 80ms CPU spike → recovery → GPU burst → recovery → CPU burst. All
        frame, CPU, GPU and overhead values are generated; no stress workload runs.
      </p>
      <div class="flex flex-wrap gap-2">
        {(["CPU spike", "CPU burst", "GPU burst"] as const).map((kind) => (
          <Button
            key={kind}
            onPress={() => {
              source.current?.inject(kind);
              playing.current = true;
              setPaused(false);
            }}
          >
            {kind === "CPU spike" ? "Inject 80ms spike" : `${kind} · 2s`}
          </Button>
        ))}
        <Button
          onPress={() => {
            playing.current = !playing.current;
            setPaused(!playing.current);
          }}
        >
          {paused ? "Play demo" : "Pause demo"}
        </Button>
      </div>
      <p role="status" class="my-3 text-label-13">
        Synthetic · {paused ? "Paused" : phase}
      </p>
      <div ref={container} />
      <p class="my-3 text-copy-13 text-jank-text-secondary">
        CPU bars average the visible window; GPU passes show a simulated sample two frames behind.
        Pause stops the demo clock. The panel’s Freeze holds its display while the demo continues.
        Capture is available in the real browser and Three.js examples.
      </p>
    </section>
  );
}

export function startSyntheticPreview(container: HTMLElement) {
  render(<SyntheticPreview />, container);
  return () => render(null, container);
}
