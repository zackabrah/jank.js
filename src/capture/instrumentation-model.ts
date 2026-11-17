/** Host controls for Capture → Instrumentation; kept free of the panel's component code. */
export interface InstrumentationControl {
  enabled: boolean;
  unavailableReason?: string | undefined;
  /** Synchronous host action. The next read must report the applied state. */
  setEnabled?: ((enabled: boolean) => void) | undefined;
}

/** Read current settings, independently of frozen measurements. Missing means unavailable. */
export type ReadInstrumentation = () => {
  gpuTiming?: InstrumentationControl;
  traceEvents?: InstrumentationControl;
};
