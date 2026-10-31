import * as THREE from "three";
import { type GpuWorkload, gpuWorkloads } from "./gpu-workload-options.ts";

const fragments: Record<GpuWorkload, string> = {
  arithmetic: `
    void main() {
      vec3 value = vec3(probeUv, 0.7);
      for (int i = 0; i < 512; i++) {
        if (i >= iterations) break;
        value = fract(sin(value.yzx * 1.73 + vec3(0.31, 0.47, 0.83)) * 13.37);
      }
      gl_FragColor = vec4(value, 1.0);
    }`,
  texture: `
    void main() {
      vec2 point = probeUv;
      vec3 total = vec3(0.0);
      for (int i = 0; i < 512; i++) {
        if (i >= iterations) break;
        vec3 sampleValue = texture2D(inputTexture, point).rgb;
        total += sampleValue;
        point = fract(point + sampleValue.rg * 0.13 + vec2(0.017, 0.031));
      }
      gl_FragColor = vec4(total / float(iterations), 1.0);
    }`,
  raymarch: `
    void main() {
      vec3 origin = vec3((probeUv - 0.5) * 2.0, -2.0);
      vec3 direction = normalize(vec3((probeUv - 0.5) * 0.4, 1.0));
      vec3 light = vec3(0.0);
      float transmission = 1.0;
      for (int i = 0; i < 256; i++) {
        if (i >= iterations) break;
        vec3 point = origin + direction * (float(i) * 0.025);
        float density = (0.5 + 0.5 * sin(point.x * 11.0) * sin(point.y * 13.0) * sin(point.z * 17.0))
          * exp(-dot(point, point) * 0.4);
        float absorption = 1.0 - exp(-density * 0.04);
        light += transmission * absorption * (0.5 + 0.5 * sin(point + vec3(0.0, 1.0, 2.0)));
        transmission *= 1.0 - absorption;
      }
      gl_FragColor = vec4(light, 1.0);
    }`,
  diffusion: `
    void main() {
      vec3 value = texture2D(inputTexture, probeUv).rgb;
      value += texture2D(inputTexture, probeUv + vec2(texel.x, 0.0)).rgb;
      value += texture2D(inputTexture, probeUv - vec2(texel.x, 0.0)).rgb;
      value += texture2D(inputTexture, probeUv + vec2(0.0, texel.y)).rgb;
      value += texture2D(inputTexture, probeUv - vec2(0.0, texel.y)).rgb;
      gl_FragColor = vec4(value * 0.2, 1.0);
    }`,
};

function noiseTexture(): THREE.DataTexture {
  const values = new Uint8Array(512 * 512 * 4);
  let seed = 17;
  for (let index = 0; index < values.length; index += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    values[index] = seed & 255;
    values[index + 1] = (seed >>> 8) & 255;
    values[index + 2] = (seed >>> 16) & 255;
    values[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(values, 512, 512);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Real offscreen GPU computation in WebGL2 fragment shaders; owns only its probe resources. */
export function createGpuProbe(renderer: THREE.WebGLRenderer, mode: GpuWorkload = "arithmetic") {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const firstTarget = new THREE.WebGLRenderTarget(size.x, size.y, { depthBuffer: false });
  const secondTarget =
    mode === "diffusion"
      ? new THREE.WebGLRenderTarget(size.x, size.y, { depthBuffer: false })
      : null;
  const seed = mode === "texture" || mode === "diffusion" ? noiseTexture() : null;
  const geometry = new THREE.PlaneGeometry(2, 2);
  const uniforms = {
    iterations: { value: 1 },
    inputTexture: { value: seed as THREE.Texture | null },
    texel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
  };
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms,
    vertexShader: `varying vec2 probeUv;
      void main() { probeUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `varying vec2 probeUv;
      uniform int iterations;
      uniform sampler2D inputTexture;
      uniform vec2 texel;
      ${fragments[mode]}`,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);
  const camera = new THREE.Camera();
  let target = firstTarget;
  let alternate = secondTarget ?? firstTarget;
  let disposed = false;
  return {
    render(count: number): void {
      if (!Number.isInteger(count) || count < 1 || count > gpuWorkloads[mode].cap) {
        throw new RangeError(
          `GPU ${mode} load must be an integer from 1 to ${gpuWorkloads[mode].cap}`,
        );
      }
      if (disposed) {
        return;
      }
      uniforms.iterations.value = count;
      const previous = renderer.getRenderTarget();
      const face = renderer.getActiveCubeFace();
      const mip = renderer.getActiveMipmapLevel();
      try {
        const passes = mode === "diffusion" ? count : 1;
        for (let pass = 0; pass < passes; pass += 1) {
          renderer.setRenderTarget(target);
          renderer.render(scene, camera);
          if (secondTarget) {
            uniforms.inputTexture.value = target.texture;
            const previousTarget = target;
            target = alternate;
            alternate = previousTarget;
          }
        }
      } finally {
        renderer.setRenderTarget(previous, face, mip);
      }
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      firstTarget.dispose();
      secondTarget?.dispose();
      seed?.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
