export interface Tab {
  readonly id: string;
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
}

export interface TabsOptions {
  /** Labelled container for the buttons. Buttons and panels need unique, nonempty DOM IDs. */
  readonly tablist: HTMLElement;
  readonly tabs: readonly Tab[];
  readonly selectedId: string;
  readonly onSelect?: (id: string) => void;
}

export interface Tabs {
  /** Select an enabled tab. Outside focus stays put; focus in hidden content moves to its tab. */
  select(id: string): void;
  /** Removes owned listeners, leaving caller DOM and its last rendered state attached. */
  dispose(): void;
}

/** Native buttons with ARIA state and arrow/Home/End keyboard navigation. */
export type CreateTabs = (options: TabsOptions) => Tabs;

export function createTabs(options: TabsOptions): Tabs {
  const tabs = validateTabs(options);
  const { tablist, onSelect } = options;
  let selectedId = options.selectedId;
  let disposed = false;
  const removeListeners: (() => void)[] = [];

  function render(): void {
    for (const tab of tabs) {
      const selected = tab.id === selectedId;
      tab.button.setAttribute("aria-selected", String(selected));
      tab.button.tabIndex = selected ? 0 : -1;
      tab.panel.hidden = !selected;
    }
  }

  function activate(tab: Tab, moveFocus: boolean): void {
    if (disposed || tab.button.matches(":disabled")) {
      return;
    }
    const changed = selectedId !== tab.id;
    const oldPanel = tabs.find((item) => item.id === selectedId)?.panel;
    const rehomeFocus = changed && oldPanel?.matches(":focus-within");
    selectedId = tab.id;
    render();
    if (moveFocus || rehomeFocus) {
      tab.button.focus();
    }
    if (changed) {
      onSelect?.(tab.id);
    }
  }

  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-orientation", "horizontal");
  for (const tab of tabs) {
    tab.button.type = "button";
    tab.button.setAttribute("role", "tab");
    tab.button.setAttribute("aria-controls", tab.panel.id);
    tab.panel.setAttribute("role", "tabpanel");
    tab.panel.setAttribute("aria-labelledby", tab.button.id);
    // A panel's first meaningful content may be a heading rather than a focusable control.
    tab.panel.tabIndex = 0;
    const click = () => activate(tab, true);
    const focus = () => activate(tab, false);
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      const enabled = tabs.filter((item) => !item.button.matches(":disabled"));
      const next = tabForKey(enabled, tab.id, event.key);
      if (next) {
        event.preventDefault();
        activate(next, true);
      }
    };
    tab.button.addEventListener("click", click);
    tab.button.addEventListener("focus", focus);
    tab.button.addEventListener("keydown", keydown);
    removeListeners.push(() => {
      tab.button.removeEventListener("click", click);
      tab.button.removeEventListener("focus", focus);
      tab.button.removeEventListener("keydown", keydown);
    });
  }
  render();

  return {
    select: (id) => {
      if (disposed) {
        return;
      }
      const tab = tabs.find((item) => item.id === id);
      if (!tab || tab.button.matches(":disabled")) {
        throw new Error(`Cannot select missing or disabled tab: ${id}`);
      }
      activate(tab, tablist.matches(":focus-within"));
    },
    dispose: () => {
      if (!disposed) {
        disposed = true;
        for (const remove of removeListeners) {
          remove();
        }
      }
    },
  };
}

function tabForKey(tabs: readonly Tab[], currentId: string, key: string): Tab | undefined {
  const index = tabs.findIndex((tab) => tab.id === currentId);
  switch (key) {
    case "Home":
      return tabs[0];
    case "End":
      return tabs.at(-1);
    case "ArrowRight":
      return tabs[(index + 1) % tabs.length];
    case "ArrowLeft":
      return tabs[(index - 1 + tabs.length) % tabs.length];
    default:
      return undefined;
  }
}

function validateTabs(options: TabsOptions): Tab[] {
  const { tablist } = options;
  if (
    !tablist.getAttribute("aria-label")?.trim() &&
    !tablist.getAttribute("aria-labelledby")?.trim()
  ) {
    throw new Error("The tablist needs an accessible label");
  }
  const tabs = options.tabs.map((tab) => ({ ...tab }));
  const ids = new Set<string>();
  const elements = new Set<HTMLElement>();
  const domIds = new Set<string>();
  for (const tab of tabs) {
    validateTab(tab, tablist);
    if (ids.has(tab.id)) {
      throw new Error(`Duplicate tab ID: ${tab.id}`);
    }
    ids.add(tab.id);
    for (const element of [tab.button, tab.panel]) {
      if (elements.has(element) || domIds.has(element.id)) {
        throw new Error("Each tab needs its own button, panel and DOM IDs");
      }
      elements.add(element);
      domIds.add(element.id);
    }
  }
  const selected = tabs.find((tab) => tab.id === options.selectedId);
  if (!selected || selected.button.matches(":disabled")) {
    throw new Error("The initial tab must exist and be enabled");
  }
  return tabs;
}

function validateTab(tab: Tab, tablist: HTMLElement): void {
  if (!tab.id.trim() || !tablist.contains(tab.button)) {
    throw new Error("Each tab needs an ID and a button inside its tablist");
  }
  if (!tab.button.id || !tab.panel.id || /\s/u.test(tab.button.id + tab.panel.id)) {
    throw new Error("Tab buttons and panels need nonempty DOM IDs without whitespace");
  }
  if (tab.button.ownerDocument !== tab.panel.ownerDocument || tablist.contains(tab.panel)) {
    throw new Error("Tab panels must be outside the tablist and in the same document");
  }
}
