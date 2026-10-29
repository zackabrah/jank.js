import type { FrameSample, ScopeCoverage, ScopeSample } from "../core/frames.ts";
import { collectionLimits } from "../core/limits.ts";
import { recordingLimits } from "./limits.ts";
import {
  choice,
  integer,
  invalid,
  list,
  nullable,
  number,
  object,
  reference,
} from "./read-values.ts";

function coverage(value: unknown, path: string): ScopeCoverage {
  const data = object(value, path);
  const status = choice(data.status, `${path}.status`, ["complete", "truncated", "not-collected"]);
  if (status === "truncated") {
    return { status, omittedScopes: integer(data.omittedScopes, `${path}.omittedScopes`, 1) };
  }
  return { status };
}

function readScope(value: unknown, path: string, channelIds: ReadonlySet<string>): ScopeSample {
  const data = object(value, path);
  const startedAtMs = number(data.startedAtMs, `${path}.startedAtMs`);
  return {
    channelId: reference(data.channelId, `${path}.channelId`, channelIds),
    startedAtMs,
    endedAtMs: number(data.endedAtMs, `${path}.endedAtMs`, startedAtMs),
  };
}

function readFrame(value: unknown, path: string, channelIds: ReadonlySet<string>): FrameSample {
  const data = object(value, path);
  const startedAtMs = number(data.startedAtMs, `${path}.startedAtMs`);
  const endedAtMs = number(data.endedAtMs, `${path}.endedAtMs`, startedAtMs);
  if (endedAtMs === startedAtMs) {
    invalid(`${path}.endedAtMs`, "A sealed frame needs a positive interval");
  }
  const cpu = object(data.cpu, `${path}.cpu`);
  const overhead = object(data.overhead, `${path}.overhead`);
  const scopes = list(
    data.scopes,
    `${path}.scopes`,
    collectionLimits.scopesPerFrame,
    (value, scopePath) => {
      const scope = readScope(value, scopePath, channelIds);
      number(scope.startedAtMs, `${scopePath}.startedAtMs`, startedAtMs, endedAtMs);
      number(scope.endedAtMs, `${scopePath}.endedAtMs`, startedAtMs, endedAtMs);
      return scope;
    },
  );
  const frameCoverage = coverage(data.coverage, `${path}.coverage`);
  if (frameCoverage.status === "not-collected" && scopes.length > 0) {
    invalid(`${path}.scopes`, "An uncollected frame cannot contain scopes");
  }
  return {
    id: integer(data.id, `${path}.id`, 1),
    startedAtMs,
    endedAtMs,
    scopes,
    coverage: frameCoverage,
    cpu: {
      updateMs: nullable(cpu.updateMs, `${path}.cpu.updateMs`, number),
      renderMs: nullable(cpu.renderMs, `${path}.cpu.renderMs`, number),
    },
    overhead: {
      collectionMs: number(overhead.collectionMs, `${path}.overhead.collectionMs`),
      refreshMs: number(overhead.refreshMs, `${path}.overhead.refreshMs`),
    },
  };
}

export function readFrames(value: unknown, channelIds: ReadonlySet<string>): FrameSample[] {
  let lastId = 0;
  let lastEndMs = 0;
  return list(value, "$.frames", recordingLimits.frames, (entry, path) => {
    const frame = readFrame(entry, path, channelIds);
    if (frame.id <= lastId) {
      invalid(`${path}.id`, "Frame IDs must increase");
    }
    if (frame.startedAtMs < lastEndMs) {
      invalid(`${path}.startedAtMs`, "Frames must not overlap or move backwards");
    }
    lastId = frame.id;
    lastEndMs = frame.endedAtMs;
    return frame;
  });
}
