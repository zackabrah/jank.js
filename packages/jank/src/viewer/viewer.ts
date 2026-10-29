import type { Recording } from "../recordings/recording.ts";

export type ViewerState =
  | { readonly status: "empty" }
  | {
      readonly status: "loaded";
      readonly recording: Recording;
      readonly selectedFrameId: number | null;
      readonly firstVisibleIndex: number;
      readonly visibleFrameCount: number;
    };

export interface Viewer {
  /** Accepts validated data; failed file parsing happens before this call. */
  load(recording: Recording): void;
  selectFrame(frameId: number): void;
  snapshot(): ViewerState;
  dispose(): void;
}

export type CreateViewer = (options: { readonly container: HTMLElement }) => Viewer;
