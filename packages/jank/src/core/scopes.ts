import type { ScopeToken } from "./channels.ts";
import type { ScopeCoverage, ScopeSample } from "./frames.ts";

export const inactiveScope = -1 as ScopeToken;

interface TrackedScope {
  readonly channelId: string;
  readonly startedAtMs: number;
  endedAtMs: number | null;
}

/** Bounded open/completed intervals, retained until their final frame boundary. */
export class ScopeRecorder {
  private readonly scopes = new Map<ScopeToken, TrackedScope>();
  private readonly capacity: number;
  private nextToken = 0;
  private omittedScopes = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  begin(channelId: string, atMs: number): ScopeToken {
    if (this.scopes.size >= this.capacity) {
      this.omittedScopes += 1;
      return inactiveScope;
    }
    this.nextToken += 1;
    const token = this.nextToken as ScopeToken;
    this.scopes.set(token, { channelId, startedAtMs: atMs, endedAtMs: null });
    return token;
  }

  end(channelId: string, token: ScopeToken, atMs: number): void {
    const scope = this.scopes.get(token);
    if (!scope || scope.channelId !== channelId || scope.endedAtMs !== null) {
      return;
    }
    scope.endedAtMs = atMs;
  }

  seal(
    startedAtMs: number,
    endedAtMs: number,
    enabled: boolean,
  ): { scopes: ScopeSample[]; coverage: ScopeCoverage } {
    const samples: ScopeSample[] = [];
    for (const [token, scope] of this.scopes) {
      const start = Math.max(startedAtMs, scope.startedAtMs);
      const end = Math.min(endedAtMs, scope.endedAtMs ?? endedAtMs);
      if (enabled && end > start) {
        samples.push({ channelId: scope.channelId, startedAtMs: start, endedAtMs: end });
      }
      if (scope.endedAtMs !== null && scope.endedAtMs <= endedAtMs) {
        this.scopes.delete(token);
      }
    }
    const coverage = this.coverage(enabled);
    this.omittedScopes = 0;
    return { scopes: samples, coverage };
  }

  private coverage(enabled: boolean): ScopeCoverage {
    if (!enabled) {
      return { status: "not-collected" };
    }
    if (this.omittedScopes > 0) {
      return { status: "truncated", omittedScopes: this.omittedScopes };
    }
    return { status: "complete" };
  }

  removeChannel(channelId: string): void {
    for (const [token, scope] of this.scopes) {
      if (scope.channelId === channelId && scope.endedAtMs === null) {
        this.scopes.delete(token);
        this.omittedScopes += 1;
      }
    }
  }

  clear(): void {
    this.scopes.clear();
    this.omittedScopes = 0;
  }
}
