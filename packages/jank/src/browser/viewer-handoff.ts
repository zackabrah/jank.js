import { serializeRecording } from "../recordings/codec.ts";
import type { Recording } from "../recordings/recording.ts";

export const handoffParameter = "jank-handoff";
const protocol = "jank.js-viewer-v1";

export function handoffMessage(
  value: unknown,
  token: string,
): value is {
  protocol: string;
  token: string;
  kind: string;
  json?: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "protocol" in value &&
    value.protocol === protocol &&
    "token" in value &&
    value.token === token &&
    "kind" in value &&
    typeof value.kind === "string"
  );
}

/** One bounded transfer, authenticated by exact window, origin and per-opening token. */
export function createViewerHandoff(options: {
  window: Window | null;
  viewerUrl: string | undefined;
  save: (recording: Recording) => void;
  changed: () => void;
}) {
  let cancel: (() => void) | null = null;
  let message = "";
  let disposed = false;
  let retryRecording: Recording | null = null;
  function clear(): void {
    cancel?.();
    cancel = null;
    message = "";
    retryRecording = null;
  }
  function saveFallback(recording: Recording, reason: string): void {
    try {
      options.save(recording);
      retryRecording = null;
      message = `${reason} Download requested; open the JSON in the offline viewer.`;
    } catch {
      retryRecording = recording;
      message = `${reason} Download failed. Retry viewer download retains this exact recording.`;
    }
    options.changed();
  }
  function open() {
    if (disposed || cancel) {
      return null;
    }
    retryRecording = null;
    const host = options.window;
    let viewer: Window | null = null;
    let recording: Recording | null = null;
    let ready = false;
    let sent = false;
    let failure = "";
    let active = true;
    let timer: number | undefined;
    const token = crypto.randomUUID();
    function stop(): void {
      active = false;
      host?.removeEventListener("message", receive);
      host?.clearTimeout(timer);
      recording = null;
      cancel = null;
    }
    function fallback(reason: string): void {
      failure = reason;
      if (!recording || !active) {
        return;
      }
      const captured = recording;
      stop();
      saveFallback(captured, reason);
    }
    function send(): void {
      if (!active || !recording || !ready || sent || !host) {
        return;
      }
      try {
        viewer?.postMessage(
          { protocol, token, kind: "recording", json: serializeRecording(recording) },
          host.location.origin,
        );
        sent = true;
      } catch {
        fallback("Viewer transfer failed.");
      }
    }
    function receive(event: MessageEvent<unknown>): void {
      if (
        !host ||
        event.source !== viewer ||
        event.origin !== host.location.origin ||
        !handoffMessage(event.data, token)
      ) {
        return;
      }
      if (event.data.kind === "ready") {
        ready = true;
        send();
      } else if (sent && event.data.kind === "accepted") {
        stop();
        message = "Opened in viewer.";
        options.changed();
      } else if (sent && event.data.kind === "rejected") {
        fallback("Viewer rejected the transfer.");
      }
    }
    cancel = stop;
    message = "Opening viewer…";
    host?.addEventListener("message", receive);
    try {
      const url = new URL(options.viewerUrl ?? "", host?.location.href);
      if (
        !host ||
        !options.viewerUrl ||
        !["http:", "https:"].includes(url.protocol) ||
        url.origin !== host.location.origin ||
        url.username ||
        url.password
      ) {
        failure = "Direct transfer needs a same-origin HTTP(S) viewer.";
      } else {
        url.searchParams.set(handoffParameter, token);
        // Keep the opener only for this explicitly configured same-origin handshake.
        viewer = host.open(url.href, "_blank");
        if (!viewer) {
          failure = "Popup blocked.";
        }
      }
    } catch {
      failure = "Viewer could not be opened.";
    }
    if (host) {
      timer = host.setTimeout(
        () => fallback("Viewer did not acknowledge within 10 seconds."),
        10000,
      );
    }
    options.changed();
    return {
      description: "Viewer transfer prepared.",
      cancel: (): void => {
        if (active) {
          stop();
          message = "";
          options.changed();
        }
      },
      save: (captured: Recording): void => {
        if (!active) {
          return;
        }
        recording = captured;
        if (failure) {
          fallback(failure);
        } else {
          send();
        }
      },
    };
  }
  return {
    open,
    state: () => ({ busy: cancel !== null, message, canRetry: retryRecording !== null }),
    retry: () => {
      if (!disposed && retryRecording) {
        saveFallback(retryRecording, "Viewer transfer fallback.");
      }
    },
    clear,
    dispose: () => {
      disposed = true;
      clear();
    },
  };
}

/** Opt-in receiver. File URLs and unrelated tabs never participate. */
export function receiveViewerHandoff(options: {
  window: Window | null;
  importJson: (json: string) => { ok: boolean };
  unchanged: () => boolean;
}): () => void {
  const host = options.window;
  const token = host ? new URL(host.location.href).searchParams.get(handoffParameter) : null;
  const opener: Window | null = host?.opener ?? null;
  if (
    !host ||
    !opener ||
    !token ||
    !/^[a-f\d-]{36}$/.test(token) ||
    !["http:", "https:"].includes(host.location.protocol)
  ) {
    return () => {};
  }
  const origin = host.location.origin;
  function dispose(): void {
    host?.removeEventListener("message", receive);
  }
  function receive(event: MessageEvent<unknown>): void {
    if (
      event.source !== opener ||
      event.origin !== origin ||
      !handoffMessage(event.data, token ?? "") ||
      event.data.kind !== "recording" ||
      typeof event.data.json !== "string"
    ) {
      return;
    }
    dispose();
    const accepted = options.unchanged() && options.importJson(event.data.json).ok;
    opener?.postMessage({ protocol, token, kind: accepted ? "accepted" : "rejected" }, origin);
  }
  host.addEventListener("message", receive);
  opener.postMessage({ protocol, token, kind: "ready" }, origin);
  return dispose;
}
