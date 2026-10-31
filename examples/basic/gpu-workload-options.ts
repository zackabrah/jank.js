/** Work units and caps belong to each synthetic workload, not to the profiler. */
export const gpuWorkloads = {
  arithmetic: {
    label: "Shader arithmetic",
    units: "shader iterations/pixel",
    cap: 512,
    description:
      "Dependent trigonometric arithmetic across the drawing resolution. Up to 512 iterations per pixel.",
  },
  texture: {
    label: "Texture sampling",
    units: "texture samples/pixel",
    cap: 512,
    description:
      "Dependent filtered reads from a generated noise texture. Exercises texture sampling and caches; up to 512 samples per pixel.",
  },
  raymarch: {
    label: "Volumetric raymarch",
    units: "ray steps/pixel",
    cap: 256,
    description:
      "Integrates a procedural density field along each ray. Exercises arithmetic like a volume effect; up to 256 steps per pixel.",
  },
  diffusion: {
    label: "Diffusion simulation",
    units: "simulation steps/frame",
    cap: 32,
    description:
      "Five-tap diffusion simulation alternating between two full-resolution targets. Exercises texture reads, writes and repeated passes; up to 32 steps per frame.",
  },
} as const;
export type GpuWorkload = keyof typeof gpuWorkloads;
