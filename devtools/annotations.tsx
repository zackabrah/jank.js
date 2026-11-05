import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button, IconButton } from "../src/ui/button.tsx";
import { Notice } from "../src/ui/notice.tsx";
import {
  type Annotation,
  captureTarget,
  feedback,
  readNotes,
  resolveTarget,
  storageKey,
} from "./annotation-model.ts";

type Draft = Omit<Annotation, "id"> & { id?: number };

export function Annotations({ host }: { host: HTMLElement }) {
  const [initial] = useState(() => {
    try {
      return { notes: readNotes(), error: "" };
    } catch {
      return {
        notes: [],
        error:
          "Saved notes could not be read. They have been left untouched. New notes stay in memory; copy your feedback before leaving.",
      };
    }
  });
  const [notes, setNotes] = useState<Annotation[]>(initial.notes);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [storageError, setStorageError] = useState(initial.error);
  const [copyText, setCopyText] = useState("");
  const [hover, setHover] = useState<Element | null>(null);
  const [highlight, setHighlight] = useState<DOMRect | null>(null);
  const [pins, setPins] = useState<{ note: Annotation; rect: DOMRect }[]>([]);
  const editor = useRef<HTMLTextAreaElement>(null);
  const copyField = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;
  const writable = useRef(!initial.error);

  function save(next: Annotation[]) {
    setNotes(next);
    setCopyText("");
    if (!writable.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError("");
    } catch {
      setStorageError(
        "Browser storage is unavailable or full. Notes are in memory only; copy your feedback before leaving.",
      );
    }
  }

  function edit(note: Annotation) {
    setOpen(true);
    if (draft) {
      setMessage("Save or cancel the current note first.");
      return;
    }
    setPicking(false);
    setHover(null);
    setDraft(note);
    setMessage("");
  }

  useLayoutEffect(() => {
    if (editing && open) editor.current?.focus();
  }, [editing, open]);
  useLayoutEffect(() => {
    if (copyText) {
      copyField.current?.focus();
      copyField.current?.select();
    }
  }, [copyText]);

  useLayoutEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key !== storageKey && event.key !== null) return;
      try {
        setNotes(readNotes());
        writable.current = true;
        setStorageError("");
      } catch {
        writable.current = false;
        setStorageError(
          "Saved notes changed but could not be read. Copy your feedback before leaving; stored data will not be overwritten.",
        );
      }
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  useLayoutEffect(() => {
    if (!picking) return;
    function target(event: Event) {
      const path = event.composedPath();
      if (path.includes(host)) return null;
      const element = path.find((item): item is Element => item instanceof Element);
      return element && element !== document.body && element !== document.documentElement
        ? element
        : null;
    }
    function choose(element: Element) {
      setDraft({ ...captureTarget(element), comment: "" });
      setPicking(false);
      setHover(null);
      setOpen(true);
    }
    function move(event: Event) {
      setHover(target(event));
    }
    function stop(event: Event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function down(event: Event) {
      if (target(event)) stop(event);
    }
    function click(event: Event) {
      const element = target(event);
      if (element) {
        stop(event);
        choose(element);
      }
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        stop(event);
        setPicking(false);
        setHover(null);
      } else if (event.key === "Enter" || event.key === " ") {
        const element = target(event);
        if (element) {
          stop(event);
          choose(element);
        }
      }
    }
    document.addEventListener("pointermove", move, true);
    document.addEventListener("focusin", move, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("focusin", move, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [picking, host]);

  useLayoutEffect(() => {
    if (notes.length === 0 && !hover) {
      setHighlight(null);
      setPins([]);
      return;
    }
    function measure() {
      setHighlight(hover?.isConnected ? hover.getBoundingClientRect() : null);
      setPins(
        notes.flatMap((note) => {
          if (note.page !== location.href) return [];
          const element = resolveTarget(note.path);
          const rect = element?.getBoundingClientRect();
          return rect && rect.width > 0 && rect.height > 0 ? [{ note, rect }] : [];
        }),
      );
    }
    measure();
    // shortcut: structural locators can drift after markup changes; re-pick affected notes.
    const observer = new MutationObserver(measure);
    observer.observe(document.getElementById("app") ?? document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    for (const element of document.querySelectorAll("*")) {
      if (element !== host && element.shadowRoot)
        observer.observe(element.shadowRoot, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
    }
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [notes, hover, host]);

  async function copy() {
    const text = feedback(notes);
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Feedback copied. Paste it into the chat.");
      setCopyText("");
    } catch {
      setCopyText(text);
      setMessage("Clipboard unavailable. Copy the selected feedback below with ⌘C / Ctrl+C.");
    }
  }

  return (
    <div class="font-sans text-copy-13 text-jank-text">
      {highlight && picking && (
        <div
          class="annotation-highlight"
          style={{
            left: `${highlight.left}px`,
            top: `${highlight.top}px`,
            width: `${highlight.width}px`,
            height: `${highlight.height}px`,
          }}
        />
      )}
      {!picking &&
        pins.map(({ note, rect }) => (
          <button
            type="button"
            key={note.id}
            class="annotation-pin focus-ring"
            style={{
              left: `${Math.min(innerWidth - 28, Math.max(4, rect.right - 12))}px`,
              top: `${rect.top - 12}px`,
              display:
                rect.bottom < 0 ||
                rect.top > innerHeight ||
                rect.right < 0 ||
                rect.left > innerWidth
                  ? "none"
                  : undefined,
            }}
            aria-label={`Edit note ${note.id}: ${note.label}`}
            title={note.comment}
            onClick={() => edit(note)}
          >
            {note.id}
          </button>
        ))}
      <fieldset
        class="annotation-toolbar material-menu flex items-center gap-2 p-2"
        aria-label="Review tools"
      >
        <Button
          variant="primary"
          pressed={picking}
          onPress={() => {
            if (draft) {
              setOpen(true);
              setMessage("Save or cancel the current note first.");
              return;
            }
            setPicking(!picking);
            setHover(null);
            setOpen(false);
            setMessage("");
          }}
        >
          {picking ? "Stop picking (Esc)" : "Annotate"}
        </Button>
        <Button
          pressed={open}
          onPress={() => {
            setOpen(!open);
            setPicking(false);
            setHover(null);
          }}
        >
          Notes ({notes.length})
        </Button>
      </fieldset>
      {picking && (
        <div class="annotation-sidebar">
          <Notice>Click an element, or Tab to it and press Enter. Escape cancels.</Notice>
        </div>
      )}
      {open && (
        <aside class="annotation-sidebar material-menu space-y-3 p-4" aria-label="Annotation notes">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-heading-16">Review notes</h2>
            <IconButton label="Close notes" onPress={() => setOpen(false)}>
              ×
            </IconButton>
          </div>
          <p class="text-jank-text-secondary">Saved in this browser. Copy feedback to share it.</p>
          {storageError && <Notice tone="warning">{storageError}</Notice>}
          {message && <Notice>{message}</Notice>}
          {draft ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!draft.comment.trim()) {
                  setMessage("Write a note before saving.");
                  editor.current?.focus();
                  return;
                }
                const note: Annotation = {
                  ...draft,
                  comment: draft.comment.trim(),
                  id: draft.id ?? Math.max(0, ...notes.map((item) => item.id)) + 1,
                };
                save(
                  draft.id
                    ? notes.map((item) => (item.id === draft.id ? note : item))
                    : [...notes, note],
                );
                setDraft(null);
                setMessage("Note saved.");
              }}
            >
              <p class="mb-2 wrap-break-word font-medium">
                {draft.id ? `Note ${draft.id}` : "New note"}: {draft.label}
              </p>
              <label class="block">
                What needs fixing?
                <textarea
                  ref={editor}
                  class="annotation-field focus-ring"
                  maxLength={2000}
                  required
                  value={draft.comment}
                  onInput={(event) => setDraft({ ...draft, comment: event.currentTarget.value })}
                />
              </label>
              <div class="flex gap-2">
                <button
                  type="submit"
                  class="focus-ring h-8 rounded-md bg-jank-text px-3 font-medium text-jank-surface"
                >
                  Save note
                </button>
                <Button
                  onPress={() => {
                    setDraft(null);
                    setMessage("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : notes.length === 0 ? (
            <p>No notes yet. Choose Annotate, then select something to fix.</p>
          ) : (
            <>
              <Button
                onPress={() => {
                  void copy();
                }}
              >
                Copy all feedback
              </Button>
              <ol class="space-y-3">
                {notes.map((note) => (
                  <li key={note.id} class="rounded-md border border-jank-divider p-3">
                    <p class="wrap-break-word font-medium">
                      {note.id}. {note.label}
                    </p>
                    <p class="my-2 whitespace-pre-wrap wrap-break-word">{note.comment}</p>
                    <p class="mb-2 wrap-break-word text-label-12 text-jank-text-secondary">
                      {note.page === location.href
                        ? pins.some((pin) => pin.note.id === note.id)
                          ? "On this page"
                          : "Target hidden or missing — delete and re-pick if needed"
                        : note.page}
                    </p>
                    <div class="flex gap-2">
                      <Button onPress={() => edit(note)}>Edit note {note.id}</Button>
                      <Button
                        onPress={() => {
                          save(notes.filter((item) => item.id !== note.id));
                          setMessage(`Note ${note.id} deleted.`);
                        }}
                      >
                        Delete note {note.id}
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
          {copyText && (
            <label class="block">
              Feedback to copy
              <textarea
                ref={copyField}
                class="annotation-field focus-ring"
                readOnly
                value={copyText}
              />
            </label>
          )}
        </aside>
      )}
    </div>
  );
}
