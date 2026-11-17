// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import {
  captureTarget,
  feedback,
  readNotes,
  resolveTarget,
  storageKey,
} from "./annotation-model.ts";
import { Annotations } from "./annotations.tsx";

let cleanup: () => void = () => undefined;
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function fixture() {
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  const panel = document.createElement("div");
  app.append(panel);
  const shadow = panel.attachShadow({ mode: "open" });
  const target = document.createElement("button");
  target.id = "collapse";
  target.textContent = "Graph and details";
  shadow.append(target);
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 150, 240, 32));
  const host = document.createElement("div");
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  await act(() => render(<Annotations host={host} />, root));
  cleanup = () => render(null, root);
  function button(name: string) {
    const result = [...root.querySelectorAll("button")].find(
      (element) => element.textContent === name || element.getAttribute("aria-label") === name,
    );
    if (!result) throw new Error(`Missing button ${name}`);
    return result;
  }
  async function click(name: string) {
    await act(() => button(name).click());
  }
  async function type(value: string) {
    const field = root.querySelector<HTMLTextAreaElement>("textarea:not([readonly])");
    if (!field) throw new Error("Missing note editor");
    await act(() => {
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  return { root, host, target, click, type, button };
}

test("picks inside Shadow DOM without activating the app, persists, restores, edits and deletes notes", async () => {
  const { root, host, target, click, type } = await fixture();
  const action = vi.fn();
  target.addEventListener("click", action);
  await click("Annotate");
  await act(() => {
    target.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, composed: true }));
  });
  expect(root.querySelector<HTMLElement>(".annotation-highlight")?.style.width).toBe("240px");
  await act(() => target.click());
  expect(action).not.toHaveBeenCalled();
  expect(root.activeElement).toBe(root.querySelector("textarea"));
  await type("Reduce this padding <script>example</script>");
  await click("Save note");
  const notes = readNotes();
  expect(notes).toHaveLength(1);
  expect(notes[0]?.path).toEqual(["#app > div:nth-of-type(1)", "#collapse"]);
  expect(notes[0]?.position).toEqual({ x: 100, y: 150, width: 240, height: 32 });
  expect(root.querySelector("script")).toBeNull();
  expect(root.querySelector(".annotation-pin")?.textContent).toBe("1");
  expect(root.querySelector<HTMLElement>(".annotation-pin")?.style.left).toBe("328px");
  expect(root.querySelector<HTMLElement>(".annotation-pin")?.style.top).toBe("138px");
  await act(() => render(null, root));
  target.click();
  expect(action).toHaveBeenCalledOnce();
  await act(() => render(<Annotations host={host} />, root));
  await click("Notes (1)");
  expect(root.textContent).toContain("Reduce this padding");
  await click("Edit note 1");
  await type("Increase spacing instead");
  await click("Save note");
  expect(readNotes()[0]?.comment).toBe("Increase spacing instead");
  await click("Delete note 1");
  expect(readNotes()).toEqual([]);
  expect(root.querySelector(".annotation-pin")).toBeNull();
});

test("supports keyboard picking, Escape, unsaved-draft protection, and clipboard failure fallback", async () => {
  const { root, target, click, type } = await fixture();
  const action = vi.fn();
  target.addEventListener("click", action);
  await click("Annotate");
  await act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  target.click();
  expect(action).toHaveBeenCalledOnce();
  expect(root.querySelector("textarea")).toBeNull();
  await click("Annotate");
  await act(() => {
    target.focus();
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
  });
  await type("Make the header taller");
  await click("Annotate");
  expect(root.textContent).toContain("Save or cancel the current note first");
  expect(root.querySelector("textarea")?.value).toBe("Make the header taller");
  await click("Save note");
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await click("Copy all feedback");
  const fallback = root.querySelector<HTMLTextAreaElement>("textarea[readonly]");
  expect(fallback?.value).toContain("Make the header taller");
  expect(fallback?.value).toContain("#app > div:nth-of-type(1) >>> #collapse");
  expect(root.activeElement).toBe(fallback);
  writeText.mockResolvedValue(undefined);
  await click("Copy all feedback");
  expect(writeText).toHaveBeenLastCalledWith(feedback(readNotes()));
  expect(root.querySelector("textarea[readonly]")).toBeNull();
});

test("retains corrupt stored data and reports failed storage writes without losing in-memory notes", async () => {
  localStorage.setItem(storageKey, "broken JSON");
  const { root, target, click, type } = await fixture();
  await click("Annotate");
  await act(() => target.click());
  await type("Keep this note");
  await click("Save note");
  expect(root.textContent).toContain("left untouched");
  expect(localStorage.getItem(storageKey)).toBe("broken JSON");
  expect(root.textContent).toContain("Keep this note");
  cleanup();
  document.body.replaceChildren();
  localStorage.clear();
  const fresh = await fixture();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  await fresh.click("Annotate");
  await act(() => fresh.target.click());
  await fresh.type("Still copyable");
  await fresh.click("Save note");
  expect(fresh.root.textContent).toContain("in memory only");
  expect(fresh.root.textContent).toContain("Still copyable");
});

test("resolves nested shadow paths and treats malformed or removed targets as missing", () => {
  const host = document.createElement("div");
  host.id = "outer";
  document.body.append(host);
  const nested = document.createElement("div");
  nested.id = "inner";
  host.attachShadow({ mode: "open" }).append(nested);
  const target = document.createElement("span");
  target.textContent = "Value";
  nested.attachShadow({ mode: "open" }).append(target);
  const captured = captureTarget(target);
  expect(captured.path).toEqual(["#outer", "#inner", "span:nth-of-type(1)"]);
  expect(resolveTarget(captured.path)).toBe(target);
  expect(resolveTarget(["["])).toBeNull();
  nested.remove();
  expect(resolveTarget(captured.path)).toBeNull();
  localStorage.setItem(
    storageKey,
    JSON.stringify([{ id: 1, ...captured, comment: "Fix it", position: null }]),
  );
  expect(readNotes).toThrow("Saved annotations are invalid");
});

test("picks up saved notes from another preview tab before adding a new note", async () => {
  const { target, click, type } = await fixture();
  const other = {
    ...captureTarget(target),
    page: "http://localhost/checks/components.html",
    id: 4,
    comment: "From the other preview",
  };
  localStorage.setItem(storageKey, JSON.stringify([other]));
  await act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
  });
  await click("Notes (1)");
  await click("Annotate");
  await act(() => target.click());
  await type("From this preview");
  await click("Save note");
  expect(readNotes().map((note) => note.comment)).toEqual([
    "From the other preview",
    "From this preview",
  ]);
});
