/** Reasons describe evidence at its scope; absence never implies a measured zero. */
export type MissingMeasurementState =
  | "not-observed"
  | "pending"
  | "unknown"
  | "unsupported"
  | "disabled"
  | "no-gpu-record"
  | "evicted"
  | "not-recorded"
  | "rejected"
  | "error";

export type Measurement =
  | { status: "measured"; value: number }
  | { status: MissingMeasurementState; reason: string };
