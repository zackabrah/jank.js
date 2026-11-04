import { CapacityMeter } from "../ui/capacity-meter.tsx";
import { DisclosureSection } from "../ui/disclosure-section.tsx";
import { GpuCoverageBar } from "../ui/gpu-coverage.tsx";
import { Notice } from "../ui/notice.tsx";
import type { GpuPool, readBuffers } from "./buffers.ts";

export function GpuPoolCapacity({ pool }: { pool: GpuPool | null }) {
  return pool?.total !== undefined ? (
    <CapacityMeter
      label="GPU detail pool"
      used={pool.total - pool.free}
      total={pool.total}
      unit={pool.unit}
    />
  ) : (
    <p class="flex flex-wrap justify-between gap-1 text-label-12">
      <span>GPU detail pool</span>
      <span class="font-mono text-jank-text-secondary">
        {pool ? `${pool.free.toLocaleString()} ${pool.unit} free` : "Unavailable"}
      </span>
    </p>
  );
}

export function BufferCoverage({ buffers }: { buffers: ReturnType<typeof readBuffers> }) {
  const { recent, capacity, recentGpu, pool, error } = buffers;
  return (
    <DisclosureSection title="Buffer & coverage" summary={`${recent} recent frames`} defaultOpen>
      <div class="space-y-3 pb-3">
        <CapacityMeter label="Recent buffer" used={recent} total={capacity} />
        <GpuPoolCapacity pool={pool} />
        {recentGpu ? (
          <GpuCoverageBar coverage={recentGpu} label="Recent GPU coverage" />
        ) : (
          <p class="text-label-12 text-jank-text-secondary">
            Recent GPU coverage unavailable; the host has not supplied coverage for this window.
          </p>
        )}
        {error && <Notice tone="warning">Buffer details unavailable: {error}</Notice>}
        <p class="text-label-12 text-jank-text-secondary">
          When full, the oldest recent frames drop first. GPU coverage is never inferred from CPU
          timing.
        </p>
      </div>
    </DisclosureSection>
  );
}
