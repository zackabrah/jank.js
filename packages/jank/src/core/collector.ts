import type { Channel, ScopeToken } from "./channels.ts";
import type { ChannelDescription, FrameSample, ScopeSample } from "./frames.ts";
import { FrameHistory, summarizeCost } from "./history.ts";
import { collectionLimits } from "./limits.ts";
import { inactiveScope, ScopeRecorder } from "./scopes.ts";
import type { FrameSnapshot } from "./snapshot.ts";

interface CollectorOptions {
  readonly now: () => number;
  readonly costNow?: () => number;
  readonly targetFps?: number;
  readonly maxScopesPerFrame?: number;
}

interface PendingFrame {
  readonly id: number;
  readonly startedAtMs: number;
  readonly collectScopes: boolean;
  updateMs: number | null;
  renderMs: number | null;
  collectionMs: number;
  refreshMs: number;
}

interface RegisteredChannel {
  readonly description: ChannelDescription;
  active: boolean;
}

/** Internal measurement owner. The public profiler composes it with capture and sources. */
export function createFrameCollector(options: CollectorOptions): FrameCollector {
  return new FrameCollector(options);
}

class FrameCollector {
  private readonly now: () => number;
  private readonly costNow: () => number;
  private readonly originMs: number;
  private lastClockMs: number;
  private readonly history = new FrameHistory();
  private readonly channels = new Map<string, RegisteredChannel>();
  private readonly scopes: ScopeRecorder;
  private pending: PendingFrame | null = null;
  private sealed: FrameSample | null = null;
  private firstValidFrameId = 1;
  private scopeObserver: ((scope: ScopeSample) => void) | null = null;
  private nextFrameId = 0;
  private lastBoundaryMs = 0;
  private scopeRequests = 0;
  private disposed = false;
  private targetFps: number;
  private totalCollectionMs = 0;
  private refreshDepth = 0;
  private epoch = 0;

  constructor(options: CollectorOptions) {
    const capacity = options.maxScopesPerFrame ?? 128;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > collectionLimits.scopesPerFrame) {
      throw new RangeError("Scope capacity must be an integer from 1 to 1024");
    }
    const targetFps = options.targetFps ?? 60;
    validateTargetFps(targetFps);
    const originMs = options.now();
    if (!Number.isFinite(originMs)) {
      throw new RangeError("Clock origin must be finite");
    }
    this.now = options.now;
    this.costNow = options.costNow ?? options.now;
    this.originMs = originMs;
    this.lastClockMs = originMs;
    this.scopes = new ScopeRecorder(capacity);
    this.targetFps = targetFps;
  }

  beginFrame(atMs: number): number {
    if (this.disposed) {
      return -1;
    }
    const relativeMs = atMs - this.originMs;
    if (!Number.isFinite(relativeMs)) {
      throw new RangeError("Frame boundaries must be finite");
    }
    // Mounting inside an animation callback can expose a boundary from before creation.
    if (relativeMs < 0 && this.nextFrameId === 0) {
      return -1;
    }
    if (relativeMs < this.lastBoundaryMs) {
      throw new RangeError("Frame boundaries must not move backwards");
    }
    const costStart = this.costNow();
    this.readClock();
    if (this.pending?.startedAtMs === relativeMs) {
      this.collectCost(costStart);
      return this.pending.id;
    }
    if (this.pending) {
      this.sealFrame(this.pending, relativeMs);
    }
    this.nextFrameId += 1;
    this.lastBoundaryMs = relativeMs;
    this.pending = {
      id: this.nextFrameId,
      startedAtMs: relativeMs,
      collectScopes: this.scopeRequests > 0,
      updateMs: null,
      renderMs: null,
      collectionMs: 0,
      refreshMs: 0,
    };
    this.collectCost(costStart);
    return this.pending.id;
  }

  private sealFrame(frame: PendingFrame, endedAtMs: number): void {
    const { scopes, coverage } = this.scopes.seal(
      frame.startedAtMs,
      endedAtMs,
      frame.collectScopes,
    );
    const sample: FrameSample = {
      id: frame.id,
      startedAtMs: frame.startedAtMs,
      endedAtMs,
      cpu: { updateMs: frame.updateMs, renderMs: frame.renderMs },
      scopes,
      coverage,
      overhead: { collectionMs: frame.collectionMs, refreshMs: frame.refreshMs },
    };
    this.history.append(sample);
    this.sealed = sample;
  }

  endFrame(cpu: { readonly updateMs: number; readonly renderMs: number }): void {
    if (this.disposed || !this.pending) {
      return;
    }
    const updateMs = (this.pending.updateMs ?? 0) + cpu.updateMs;
    const renderMs = (this.pending.renderMs ?? 0) + cpu.renderMs;
    if (
      !validDuration(cpu.updateMs) ||
      !validDuration(cpu.renderMs) ||
      !validDuration(updateMs) ||
      !validDuration(renderMs)
    ) {
      throw new RangeError(
        "CPU durations and their accumulated totals must be finite and nonnegative",
      );
    }
    const costStart = this.costNow();
    this.pending.updateMs = updateMs;
    this.pending.renderMs = renderMs;
    this.collectCost(costStart);
  }

  createChannel(description: ChannelDescription): Channel {
    if (this.disposed) {
      throw new Error("Cannot create a channel on a disposed collector");
    }
    validateChannelText(description.id);
    validateChannelText(description.label);
    const previous = this.channels.get(description.id);
    if (previous && (previous.active || previous.description.label !== description.label)) {
      throw new Error("A channel ID must be inactive and keep its historical label before reuse");
    }
    if (!previous && this.channels.size >= collectionLimits.channels) {
      throw new RangeError(
        "At most 64 channel identities may be retained; clear removes disposed identities",
      );
    }
    const id = description.id;
    const channel = { description: { id, label: description.label }, active: true };
    this.channels.set(id, channel);
    return {
      begin: () => (channel.active ? this.beginScope(id) : inactiveScope),
      end: (token) => {
        if (channel.active && !this.disposed && token !== inactiveScope) {
          const costStart = this.costNow();
          this.scopes.end(id, token, this.readClock(), this.scopeObserver);
          this.collectCost(costStart);
        }
      },
      dispose: () => {
        if (channel.active) {
          channel.active = false;
          this.scopes.removeChannel(id);
        }
      },
    };
  }

  private beginScope(channelId: string): ScopeToken {
    if (this.disposed || !this.pending?.collectScopes) {
      return inactiveScope;
    }
    const costStart = this.costNow();
    const atMs = this.readClock();
    const token = this.scopes.begin(channelId, atMs);
    this.collectCost(costStart);
    return token;
  }

  requestScopes(): () => void {
    if (this.disposed) {
      return () => {};
    }
    this.scopeRequests += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.scopeRequests -= 1;
      }
    };
  }

  frameBudgetMs(): number {
    return 1000 / this.targetFps;
  }

  setTargetFps(targetFps: number): void {
    if (!this.disposed) {
      validateTargetFps(targetFps);
      this.targetFps = targetFps;
    }
  }

  measureRefresh<T>(render: () => T): T {
    if (this.disposed || !this.pending || this.refreshDepth > 0) {
      return render();
    }
    const frame = this.pending;
    const costStart = this.costNow();
    const collectedBefore = this.totalCollectionMs;
    this.refreshDepth += 1;
    try {
      return render();
    } finally {
      this.refreshDepth -= 1;
      if (this.pending === frame) {
        const collectionMs = this.totalCollectionMs - collectedBefore;
        frame.refreshMs += Math.max(0, this.costNow() - costStart - collectionMs);
      }
    }
  }

  /** Charge orchestration work while subtracting already measured nested collection calls. */
  measureCollection<T>(work: () => T): T {
    if (this.disposed) {
      return work();
    }
    const startedAtMs = this.costNow();
    const collectedBefore = this.totalCollectionMs;
    const epoch = this.epoch;
    try {
      return work();
    } finally {
      if (this.pending && epoch === this.epoch) {
        const durationMs = Math.max(
          0,
          this.costNow() - startedAtMs - (this.totalCollectionMs - collectedBefore),
        );
        if (validDuration(durationMs)) {
          this.pending.collectionMs += durationMs;
          this.totalCollectionMs += durationMs;
        }
      }
    }
  }

  snapshot(): FrameSnapshot {
    const costStart = this.costNow();
    const frames = this.history.snapshot();
    const snapshot = {
      scopesRequested: !this.disposed && this.scopeRequests > 0,
      targetFps: this.targetFps,
      frames,
      channels: [...this.channels.values()].map((channel) => ({ ...channel.description })),
      overhead: {
        collection: summarizeCost(frames, "collectionMs"),
        refresh: summarizeCost(frames, "refreshMs"),
      },
    };
    this.collectCost(costStart);
    return snapshot;
  }

  /** One handoff per boundary, consumed by the profiler's capture owner. */
  takeSealedFrame(): FrameSample | null {
    const frame = this.sealed;
    this.sealed = null;
    return frame;
  }

  recentFrames(): readonly FrameSample[] {
    return this.history.read();
  }
  time(): number {
    return this.readClock();
  }
  knowsFrame(id: number): boolean {
    return id >= this.firstValidFrameId && id <= this.nextFrameId;
  }
  observeScopes(observer: ((scope: ScopeSample) => void) | null): void {
    this.scopeObserver = observer;
  }

  private collectCost(startedAtMs: number): void {
    const durationMs = this.costNow() - startedAtMs;
    if (this.pending && validDuration(durationMs)) {
      this.pending.collectionMs += durationMs;
      this.totalCollectionMs += durationMs;
    }
  }

  private readClock(): number {
    const atMs = this.now();
    const relativeMs = atMs - this.originMs;
    if (!Number.isFinite(relativeMs) || atMs < this.lastClockMs) {
      throw new RangeError("Scope clock must be finite and must not move backwards");
    }
    this.lastClockMs = atMs;
    return relativeMs;
  }

  clear(): void {
    this.epoch += 1;
    this.pending = null;
    this.sealed = null;
    this.firstValidFrameId = this.nextFrameId + 1;
    this.scopes.clear();
    this.history.clear();
    this.totalCollectionMs = 0;
    for (const [id, channel] of this.channels) {
      if (!channel.active) {
        this.channels.delete(id);
      }
    }
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.clear();
      this.channels.clear();
      this.scopeObserver = null;
    }
  }
}

function validDuration(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validateChannelText(value: string): void {
  if (value.trim() === "" || value.length > collectionLimits.labelLength) {
    throw new Error("A channel ID and label must each contain 1–240 characters");
  }
}

function validateTargetFps(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("Target FPS must be finite and positive");
  }
}
