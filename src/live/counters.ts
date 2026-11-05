import type { DiagnosticValues } from "../recording/types.ts";

const integers = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const decimals = new Intl.NumberFormat("en", { maximumSignificantDigits: 4 });
const byteUnits = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];

/** Only explicit key suffixes declare units; raw recording keys/values stay unchanged. */
export function formatCounter(name: string, value: DiagnosticValues[string]) {
  const suffix = /(?:Bytes|Ms|Px)$/.exec(name)?.[0];
  const words = (suffix ? name.slice(0, -suffix.length) : name)
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  if (value === null || (typeof value === "number" && !Number.isFinite(value)))
    return { label, text: "Unavailable" };
  if (typeof value === "boolean") return { label, text: value ? "Yes" : "No" };
  if (typeof value === "string") return { label, text: value };
  if (typeof value !== "number") throw new TypeError("Counter values must be scalar");
  let unit = suffix === "Ms" ? "ms" : suffix === "Px" ? "px" : "";
  if (suffix === "Bytes") {
    let index = 0;
    while (Math.abs(value) >= 1024 && index < byteUnits.length - 1) {
      value /= 1024;
      index++;
    }
    unit = byteUnits[index] ?? "B";
  }
  const text = (Number.isInteger(value) ? integers : decimals).format(value);
  return { label, text: unit ? `${text} ${unit}` : text };
}
