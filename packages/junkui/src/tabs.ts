export interface Tab {
  readonly id: string;
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
}

export interface TabsOptions {
  readonly tabs: readonly Tab[];
  readonly selectedId: string;
  readonly onSelect?: (id: string) => void;
}

export interface Tabs {
  select(id: string): void;
  /** Removes only listeners installed by this control; caller-owned DOM stays attached. */
  dispose(): void;
}

/** Native buttons with ARIA state and arrow/Home/End keyboard navigation. */
export type CreateTabs = (options: TabsOptions) => Tabs;
