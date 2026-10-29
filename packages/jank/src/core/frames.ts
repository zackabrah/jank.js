export interface ScopeSample {
  readonly channelId: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
}

export type ScopeCoverage =
  | { readonly status: "complete" }
  | { readonly status: "truncated"; readonly omittedScopes: number }
  | { readonly status: "not-collected" };

export interface FrameSample {
  readonly id: number;
  /** Both boundaries are milliseconds since this profiler was created. */
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly cpu: {
    /** null means the host did not supply this measurement. */
    readonly updateMs: number | null;
    readonly renderMs: number | null;
  };
  readonly scopes: readonly ScopeSample[];
  readonly coverage: ScopeCoverage;
  readonly overhead: {
    readonly collectionMs: number;
    readonly refreshMs: number;
  };
}

export interface EventSample {
  readonly atMs: number;
  readonly label: string;
  readonly detail: string | null;
}

export type CounterValue = number | string | boolean | null;

export type CounterSample = {
  readonly atMs: number;
  readonly channelId: string;
} & (
  | { readonly status: "ready"; readonly values: Readonly<Record<string, CounterValue>> }
  | { readonly status: "error"; readonly message: string }
);

export function copyCounterSample(sample: CounterSample): CounterSample {
  return sample.status === "ready" ? { ...sample, values: { ...sample.values } } : { ...sample };
}

export interface ChannelDescription {
  readonly id: string;
  readonly label: string;
}

/** Copy every mutable child at the snapshot/recording boundary. */
export function copyFrame(frame: FrameSample): FrameSample {
  return {
    ...frame,
    cpu: { ...frame.cpu },
    scopes: frame.scopes.map((scope) => ({ ...scope })),
    coverage: { ...frame.coverage },
    overhead: { ...frame.overhead },
  };
}
