import { afterEach, expect, it, vi } from "vitest";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { createViewerHandoff, handoffMessage, receiveViewerHandoff } from "./viewer-handoff.ts";

const protocol = "jank.js-viewer-v1";
const token = "11111111-1111-4111-8111-111111111111";
function browser(url = "https://host.test/viewer/", hasOpener = true) {
  const events = new EventTarget();
  const postMessage = vi.fn();
  const peer = { postMessage } as unknown as Window;
  const open = vi.fn((): Window | null => peer);
  const host = Object.assign(events, {
    location: new URL(url),
    opener: hasOpener ? peer : null,
    open,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  }) as unknown as Window;
  const dispatch = (data: unknown, origin = host.location.origin, source: Window | null = peer) => {
    events.dispatchEvent(Object.assign(new Event("message"), { data, origin, source }));
  };
  return { host, peer, open, postMessage, dispatch };
}
function sender(viewerUrl = "/viewer/") {
  vi.useFakeTimers();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(token);
  const fixture = browser();
  const save = vi.fn();
  const changed = vi.fn();
  const handoff = createViewerHandoff({ window: fixture.host, viewerUrl, save, changed });
  return { ...fixture, save, changed, handoff };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("waits for both readiness and evidence, validates acknowledgements, and cleans up after success", () => {
  const test = sender();
  const destination = test.handoff.open();
  expect(test.handoff.open()).toBeNull();
  const data = { protocol, token, kind: "ready" };
  for (const value of [
    null,
    {},
    { ...data, protocol: "wrong" },
    { ...data, token: "wrong" },
    { ...data, kind: 1 },
  ]) {
    test.dispatch(value);
  }
  test.dispatch(data, "https://wrong.test");
  test.dispatch(data, undefined, test.host);
  test.dispatch({ ...data, kind: "accepted" });
  expect(test.postMessage).not.toHaveBeenCalled();
  test.dispatch(data);
  expect(test.postMessage).not.toHaveBeenCalled();
  destination?.save(recordingFixture());
  test.dispatch(data);
  expect(test.postMessage).toHaveBeenCalledTimes(1);
  expect(JSON.parse(test.postMessage.mock.calls[0]?.[0].json)).toEqual(recordingFixture());
  test.dispatch({ ...data, kind: "accepted" });
  expect(test.handoff.state()).toMatchObject({ busy: false, message: "Opened in viewer." });
  destination?.cancel();
  vi.runAllTimers();
  expect(test.save).not.toHaveBeenCalled();
});

it("sends once when evidence precedes readiness and falls back on rejection or posting failure", () => {
  const test = sender();
  test.handoff.open()?.save(recordingFixture());
  test.dispatch({ protocol, token, kind: "ready" });
  test.dispatch({ protocol, token, kind: "rejected" });
  expect(test.save).toHaveBeenCalledWith(recordingFixture());
  expect(test.handoff.state().message).toContain("rejected");
  test.postMessage.mockImplementation(() => {
    throw new Error("Closed");
  });
  test.handoff.open()?.save(recordingFixture());
  test.dispatch({ protocol, token, kind: "ready" });
  expect(test.handoff.state().message).toContain("transfer failed");
});

it.each([
  "file:///tmp/viewer.html",
  "https://other.test/viewer",
  "https://name:pass@host.test/viewer",
  "http://[",
])("does not navigate unsupported URL %s", (url) => {
  const test = sender(url);
  test.handoff.open()?.save(recordingFixture());
  expect(test.open).not.toHaveBeenCalled();
  expect(test.save).toHaveBeenCalledTimes(1);
  expect(test.handoff.state().busy).toBe(false);
});
it("handles popup blocking, opener errors and missing browsing context", () => {
  const test = sender();
  test.open.mockReturnValue(null);
  test.handoff.open()?.save(recordingFixture());
  expect(test.handoff.state().message).toContain("Popup blocked");
  test.open.mockImplementation(() => {
    throw new Error("Unavailable");
  });
  test.handoff.open()?.save(recordingFixture());
  expect(test.handoff.state().message).toContain("could not be opened");
  const isolated = createViewerHandoff({
    window: null,
    viewerUrl: undefined,
    save: test.save,
    changed: test.changed,
  });
  isolated.open()?.save(recordingFixture());
  expect(isolated.state().busy).toBe(false);
});
it("bounds the acknowledgement wait, including readiness timeout before finalization", () => {
  const test = sender();
  const destination = test.handoff.open();
  vi.advanceTimersByTime(10000);
  expect(test.save).not.toHaveBeenCalled();
  destination?.save(recordingFixture());
  expect(test.save).toHaveBeenCalledTimes(1);
  expect(test.handoff.state().message).toContain("10 seconds");
  test.handoff.open()?.save(recordingFixture());
  vi.advanceTimersByTime(10000);
  expect(test.save).toHaveBeenCalledTimes(2);
});
it("retains one exact failed download for retry, then releases it on success or clear", () => {
  const test = sender();
  test.open.mockReturnValue(null);
  test.save.mockImplementationOnce(() => {
    throw new Error("Denied");
  });
  test.handoff.open()?.save(recordingFixture());
  expect(test.handoff.state().canRetry).toBe(true);
  test.handoff.retry();
  expect(test.save).toHaveBeenLastCalledWith(recordingFixture());
  expect(test.handoff.state().canRetry).toBe(false);
  test.handoff.retry();
  expect(test.save).toHaveBeenCalledTimes(2);
  test.handoff.clear();
  expect(test.handoff.state().message).toBe("");
});
it("old cancellation cannot affect a newer transfer, and dispose suppresses late work", () => {
  const test = sender();
  const old = test.handoff.open();
  old?.cancel();
  const current = test.handoff.open();
  old?.cancel();
  old?.save(recordingFixture());
  expect(test.handoff.state().busy).toBe(true);
  test.handoff.dispose();
  current?.save(recordingFixture());
  test.handoff.retry();
  vi.runAllTimers();
  expect(test.handoff.open()).toBeNull();
  expect(test.save).not.toHaveBeenCalled();
});

it("receiver authenticates its opener, validates JSON through its importer and accepts once", () => {
  const test = browser(`https://host.test/viewer/?jank-handoff=${token}`);
  const importJson = vi.fn(() => ({ ok: true }));
  const dispose = receiveViewerHandoff({ window: test.host, importJson, unchanged: () => true });
  expect(test.postMessage).toHaveBeenCalledWith(
    { protocol, token, kind: "ready" },
    "https://host.test",
  );
  const data = { protocol, token, kind: "recording", json: "recording-json" };
  test.dispatch(data, undefined, test.host);
  test.dispatch(data, "https://wrong.test");
  test.dispatch({ ...data, token: "wrong" });
  test.dispatch({ ...data, kind: "ready" });
  test.dispatch({ ...data, json: null });
  expect(importJson).not.toHaveBeenCalled();
  test.dispatch(data);
  test.dispatch(data);
  expect(importJson).toHaveBeenCalledExactlyOnceWith("recording-json");
  expect(test.postMessage).toHaveBeenLastCalledWith(
    { protocol, token, kind: "accepted" },
    "https://host.test",
  );
  dispose();
});
it.each([false, true])(
  "receiver rejects invalid or superseded data (superseded=%s)",
  (superseded) => {
    const test = browser(`https://host.test/viewer/?jank-handoff=${token}`);
    const importJson = vi.fn(() => ({ ok: false }));
    receiveViewerHandoff({ window: test.host, importJson, unchanged: () => !superseded });
    test.dispatch({ protocol, token, kind: "recording", json: "{}" });
    expect(importJson).toHaveBeenCalledTimes(superseded ? 0 : 1);
    expect(test.postMessage).toHaveBeenLastCalledWith(
      { protocol, token, kind: "rejected" },
      "https://host.test",
    );
  },
);
it("ordinary tabs, file URLs, missing openers and disposed receivers never import messages", () => {
  const importJson = vi.fn(() => ({ ok: true }));
  const fixtures = [
    browser(),
    browser("https://host.test/?jank-handoff=bad"),
    browser(`file:///viewer.html?jank-handoff=${token}`),
    browser(`https://host.test/?jank-handoff=${token}`, false),
  ];
  for (const test of fixtures) {
    receiveViewerHandoff({ window: test.host, importJson, unchanged: () => true })();
    test.dispatch({ protocol, token, kind: "recording", json: "{}" });
    expect(test.postMessage).not.toHaveBeenCalled();
  }
  receiveViewerHandoff({ window: null, importJson, unchanged: () => true })();
  const live = browser(`https://host.test/?jank-handoff=${token}`);
  receiveViewerHandoff({ window: live.host, importJson, unchanged: () => true })();
  live.dispatch({ protocol, token, kind: "recording", json: "{}" });
  expect(importJson).not.toHaveBeenCalled();
  expect(handoffMessage("bad", token)).toBe(false);
});
