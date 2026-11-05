export const storageKey = "jank:annotations:v1";

export type Annotation = {
  id: number;
  comment: string;
  label: string;
  path: string[];
  page: string;
  theme: string;
  scenario: string;
  viewport: { width: number; height: number };
  position: { x: number; y: number; width: number; height: number };
};

function selector(element: Element): string {
  const root = element.getRootNode() as Document | ShadowRoot;
  const parts: string[] = [];
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (/^[a-z][\w-]*$/i.test(current.id) && root.querySelectorAll(`#${current.id}`).length === 1) {
      parts.unshift(`#${current.id}`);
      break;
    }
    let index = 1;
    for (
      let sibling = current.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    ) {
      if (sibling.localName === current.localName) index++;
    }
    parts.unshift(`${current.localName}:nth-of-type(${index})`);
  }
  return parts.join(" > ");
}

export function captureTarget(element: Element): Omit<Annotation, "id" | "comment"> {
  const path = [selector(element)];
  for (
    let root = element.getRootNode();
    root instanceof ShadowRoot;
    root = root.host.getRootNode()
  ) {
    path.unshift(selector(root.host));
  }
  const rect = element.getBoundingClientRect();
  return {
    label: (element.getAttribute("aria-label") || element.textContent || element.localName)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120),
    path,
    page: location.href,
    theme: getComputedStyle(element).colorScheme,
    scenario:
      document.querySelector<HTMLSelectElement>("#scenario")?.selectedOptions[0]?.text ?? "",
    viewport: { width: innerWidth, height: innerHeight },
    position: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
  };
}

export function resolveTarget(path: string[]): Element | null {
  let root: Document | ShadowRoot | null = document;
  let element: Element | null = null;
  try {
    for (const part of path) {
      element = root?.querySelector(part) ?? null;
      root = element?.shadowRoot ?? null;
    }
  } catch {
    return null;
  }
  return element;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function dimensions(value: unknown, keys: string[]) {
  return (
    record(value) &&
    keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))
  );
}
function isAnnotation(value: unknown): value is Annotation {
  if (!record(value)) return false;
  const { id, comment, label, page, theme, scenario, path, viewport, position } = value;
  return (
    typeof id === "number" &&
    Number.isSafeInteger(id) &&
    id > 0 &&
    [comment, label, page, theme, scenario].every((part) => typeof part === "string") &&
    Array.isArray(path) &&
    path.length > 0 &&
    path.every((part: unknown) => typeof part === "string" && part.length > 0) &&
    dimensions(viewport, ["width", "height"]) &&
    dimensions(position, ["x", "y", "width", "height"])
  );
}

export function readNotes(): Annotation[] {
  const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
  if (!Array.isArray(value) || !value.every(isAnnotation))
    throw new Error("Saved annotations are invalid");
  if (new Set(value.map((note) => note.id)).size !== value.length)
    throw new Error("Duplicate annotation IDs");
  return value;
}

export function feedback(notes: Annotation[]): string {
  return [
    "# Jank UI feedback",
    ...notes.map((note) =>
      [
        `## ${note.id}. ${note.label}`,
        note.comment,
        `Page: ${note.page}`,
        `Context: ${note.theme || "default theme"}${note.scenario ? ` · ${note.scenario}` : ""}`,
        `Viewport: ${note.viewport.width} × ${note.viewport.height}`,
        `Target: ${note.path.join(" >>> ")} (>>> crosses a shadow root)`,
        `Document bounds: x=${Math.round(note.position.x)}, y=${Math.round(note.position.y)}, width=${Math.round(note.position.width)}, height=${Math.round(note.position.height)}`,
      ].join("\n\n"),
    ),
  ].join("\n\n");
}
