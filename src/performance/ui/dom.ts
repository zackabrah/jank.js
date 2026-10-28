/** Saves text as a JSON file through a temporary object URL. */
export function download(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );

  const a = document.createElement("a");

  a.href = url;
  a.download = name;
  a.click();

  URL.revokeObjectURL(url);
}

/** Looks up a required element of the given type; throws when the markup lacks it. */
export function findIn<T extends Element>(
  from: ParentNode,
  selector: string,
  type: { new (): T },
): T {
  const value = from.querySelector(selector);

  if (!(value instanceof type))
    throw new Error(`Missing performance element ${selector}`);

  return value;
}
