import type { ScopeSample } from "../core/frames.ts";
import type { Recording } from "../recordings/recording.ts";

export interface FrameSummary {
  readonly frameId: number;
  readonly intervalMs: number;
  readonly budgetMs: number;
  readonly overBudget: boolean;
  /** Union of observed scope intervals; nested scopes are never added twice. */
  readonly attributedMs: number | null;
  readonly unattributedMs: number | null;
  readonly scopes: readonly ScopeSample[];
  readonly likelyCause: { readonly channelId: string; readonly aboveMedianMs: number } | null;
}

/** A deterministic calculation: no DOM, clock reads, mutable caches or formatting. */
export type InspectFrame = (recording: Recording, frameId: number) => FrameSummary | null;
