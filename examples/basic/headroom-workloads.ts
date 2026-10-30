import * as THREE from "three";

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

/** An offscreen full-resolution arithmetic probe, inside the host's existing GPU timer. */
export function createGpuProbe(renderer: THREE.WebGLRenderer) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { depthBuffer: false });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const iterations = { value: 1 };
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { iterations },
    vertexShader: `varying vec2 probeUv;
      void main() { probeUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `varying vec2 probeUv;
      uniform int iterations;
      void main() {
        vec3 value = vec3(probeUv, 0.7);
        for (int i = 0; i < 512; i++) {
          if (i >= iterations) break;
          value = fract(sin(value.yzx * 1.73 + vec3(0.31, 0.47, 0.83)) * 13.37);
        }
        gl_FragColor = vec4(value, 1.0);
      }`,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);
  const camera = new THREE.Camera();
  return {
    render(count: number): void {
      iterations.value = count;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(previous);
      }
    },
    dispose(): void {
      target.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
