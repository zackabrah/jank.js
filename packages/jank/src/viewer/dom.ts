export function element<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) {
    throw new Error(`Viewer markup is missing ${selector}`);
  }
  return found;
}
export function write(root: ParentNode, name: string, text: string): void {
  element<HTMLElement>(root, `[data-viewer-${name}]`).textContent = text;
}
export function milliseconds(value: number | null | undefined): string {
  return value == null ? "Unknown" : `${value.toFixed(2)} ms`;
}
export function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
/** Read-only evidence tables; all imported values enter through text nodes. */
export function renderTable(
  container: HTMLElement,
  caption: string,
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): void {
  const document = container.ownerDocument;
  const table = document.createElement("table");
  const title = table.createCaption();
  title.textContent = caption;
  const heading = table.createTHead().insertRow();
  for (const name of columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = name;
    heading.append(cell);
  }
  const body = table.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) {
      row.insertCell().textContent = value;
    }
  }
  container.replaceChildren(table);
}
