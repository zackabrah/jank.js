export async function nativeTimestampControl(device: GPUDevice) {
  const query = device.createQuerySet({ type: "timestamp", count: 2 });
  const resolved = device.createBuffer({ size: 16, usage: 0x0204 });
  const mapped = device.createBuffer({ size: 16, usage: 9 });
  const texture = device.createTexture({ size: [16, 16], format: "rgba8unorm", usage: 16 });
  const module = device.createShaderModule({
    code: `@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{var p=array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));return vec4f(p[i],0.,1.);}@fragment fn fragment()->@location(0) vec4f{return vec4f(1.);}`,
  });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vertex" },
    fragment: { module, entryPoint: "fragment", targets: [{ format: "rgba8unorm" }] },
  });
  const result = [];
  for (const draw of [true, false, false, true]) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: texture.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] },
      ],
      timestampWrites: { querySet: query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
    });
    if (draw) {
      pass.setPipeline(pipeline);
      pass.draw(3);
    }
    pass.end();
    encoder.resolveQuerySet(query, 0, 2, resolved, 0);
    encoder.copyBufferToBuffer(resolved, 0, mapped, 0, 16);
    device.queue.submit([encoder.finish()]);
    await mapped.mapAsync(1);
    const t = new BigUint64Array(mapped.getMappedRange());
    result.push({ draw, startNs: String(t[0]), endNs: String(t[1]) });
    mapped.unmap();
  }
  query.destroy();
  resolved.destroy();
  mapped.destroy();
  texture.destroy();
  return result;
}
