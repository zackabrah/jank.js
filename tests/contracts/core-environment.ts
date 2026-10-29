// These must remain errors even as the core's import graph grows.
// @ts-expect-error Browser globals must not leak into the measurement layers.
document.createElement("div");

// @ts-expect-error Node globals must not leak into the measurement layers.
process.cwd();

export {};
