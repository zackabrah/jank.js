/** Fixed computation counts, never a timer-based busy wait. State is retained between frames. */
export function createCpuProbe() {
  const values = Float64Array.from({ length: 4096 }, (_, index) => (index + 1) / 4097);
  return (batches: number): void => {
    for (let batch = 0; batch < batches; batch += 1) {
      for (let index = 0; index < values.length; index += 1) {
        const value = values[index] ?? 0;
        values[index] = Math.sin(value * 3.1 + index * 0.001) * 0.5 + 0.5;
      }
    }
  };
}
