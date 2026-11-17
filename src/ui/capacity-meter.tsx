export function CapacityMeter({
  label,
  used,
  total,
  unit = "frames",
}: {
  label: string;
  used: number;
  total: number | null;
  unit?: string;
}) {
  return (
    <div class="space-y-1 text-label-12">
      <div class="flex flex-wrap justify-between gap-x-2 gap-y-1">
        <span>{label}</span>
        <span class="font-mono text-jank-text-secondary">
          {used.toLocaleString()}
          {total !== null && ` / ${total.toLocaleString()}`} {unit}
        </span>
      </div>
      {total !== null && total > 0 && (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={used}
          class="h-1.5 overflow-hidden rounded-full bg-jank-track"
        >
          <div class="h-full bg-jank-text" style={{ width: `${(used * 100) / total}%` }} />
        </div>
      )}
      <p class="text-jank-text-secondary">
        {total === null ? "Capacity unavailable" : `${(total - used).toLocaleString()} free`}
      </p>
    </div>
  );
}
