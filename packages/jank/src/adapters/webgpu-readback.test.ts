import { expect, it } from "vitest";
import { webGpuDeviceFixture } from "../../../../tests/fixtures/webgpu-device.ts";
import { createTimestampSlot } from "./webgpu-readback.ts";

it("rejects overlapping reads and ignores a map that completes after disposal", async () => {
  const host = webGpuDeviceFixture();
  const slot = createTimestampSlot(host.device, 2);
  const reading = slot.read(1, 1000);
  const cancelled = expect(reading).rejects.toThrow("cancelled");
  await expect(slot.read(1, 1000)).rejects.toThrow("unavailable");
  slot.dispose();
  // Even a transport that resolves despite cancellation cannot expose the stale buffer.
  await host.resolve();
  await cancelled;
  await expect(slot.read(1, 1000)).rejects.toThrow("unavailable");
  slot.dispose();
  expect(host.resources()).toMatchObject({ buffers: 0, queries: 0 });
});
