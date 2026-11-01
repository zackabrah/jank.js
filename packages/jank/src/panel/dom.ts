/** Static markup is controlled here; measurements and host strings always use textContent. */
export function element<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) {
    throw new Error(`Panel markup is missing ${selector}`);
  }
  return found;
}

export function write(root: ParentNode, name: string, value: string): void {
  updateText(element(root, `[data-value="${name}"]`), value);
}

/** WebKit can cancel a click if its text node is replaced between pointer down and up. */
export function updateText(target: Element, value: string): void {
  if (target.textContent !== value) {
    target.textContent = value;
  }
}

export function milliseconds(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "–" : value.toFixed(digits);
}

/** Reuse unchanged content and leave interactive controls out of these read-only lists. */
export function rows(root: HTMLElement, values: readonly (readonly [string, string])[]): void {
  const document = root.ownerDocument;
  while (root.children.length > values.length) {
    root.lastElementChild?.remove();
  }
  values.forEach(([label, value], index) => {
    let row = root.children[index];
    if (!row) {
      row = document.createElement("div");
      row.className = "jank-row";
      row.append(document.createElement("span"), document.createElement("span"));
      root.append(row);
    }
    const first = row.children[0];
    const last = row.children[1];
    if (first && first.textContent !== label) {
      first.textContent = label;
    }
    if (last && last.textContent !== value) {
      last.textContent = value;
    }
  });
}
