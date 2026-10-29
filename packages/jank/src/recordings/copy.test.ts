import { expect, it } from "vitest";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { copyRecording } from "./copy.ts";

it.each([false, true])(
  "detaches all nested recording data, with viewport present: %s",
  (hasViewport) => {
    const fixture = recordingFixture();
    const source = {
      ...fixture,
      metadata: {
        ...fixture.metadata,
        application: hasViewport ? null : fixture.metadata.application,
        environment: {
          ...fixture.metadata.environment,
          viewport: hasViewport ? { widthPx: 800, heightPx: 600, pixelRatio: 2 } : null,
        },
      },
    };
    const before = structuredClone(source);
    const copy = copyRecording(source);
    expect(copy).toEqual(source);
    for (const value of [
      copy.clock,
      copy.capture,
      copy.metadata,
      copy.metadata.application,
      copy.metadata.environment,
      copy.metadata.environment.timer,
      copy.metadata.environment.viewport,
      copy.frames[0]?.cpu,
      copy.frames[0]?.scopes[0],
      copy.frames[0]?.coverage,
      copy.frames[0]?.overhead,
      copy.channels[0],
      copy.counters[0]?.values,
      copy.events[0],
      copy.gpu[0]?.passes[0],
    ]) {
      if (value) {
        Reflect.set(value, "consumerProperty", "changed");
      }
    }
    expect(source).toEqual(before);
  },
);
