import { collectionLimits } from "../core/limits.ts";
import type { RecordingProblem } from "./recording.ts";

export class RecordingError extends Error {
  readonly problem: RecordingProblem;

  constructor(problem: RecordingProblem) {
    super(`${problem.path}: ${problem.message}`);
    this.name = "RecordingError";
    this.problem = problem;
  }
}

export function invalid(path: string, message: string): never {
  throw new RecordingError({ code: "invalid-data", path, message });
}

export function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "Expected an object");
  }
  // Own properties only; inherited values must not satisfy required file fields.
  return Object.fromEntries(Object.entries(value));
}

export function list<T>(
  value: unknown,
  path: string,
  limit: number,
  read: (item: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value) || value.length > limit) {
    return invalid(path, `Expected an array with at most ${limit} entries`);
  }
  return value.map((item: unknown, index) => read(item, `${path}[${index}]`));
}

export function number(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_VALUE,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    return invalid(path, `Expected a finite number from ${minimum} to ${maximum}`);
  }
  return value;
}

export function integer(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const result = number(value, path, minimum, maximum);
  if (!Number.isSafeInteger(result)) {
    return invalid(path, "Expected a safe integer");
  }
  return result;
}

export function text(
  value: unknown,
  path: string,
  maximum: number = collectionLimits.labelLength,
): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    return invalid(path, `Expected nonempty text up to ${maximum} characters`);
  }
  return value;
}

export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    return invalid(path, "Expected a boolean");
  }
  return value;
}

export function choice<const T extends string>(
  value: unknown,
  path: string,
  choices: readonly T[],
): T {
  for (const candidate of choices) {
    if (value === candidate) {
      return candidate;
    }
  }
  return invalid(path, `Expected ${choices.join(" or ")}`);
}

export function nullable<T>(
  value: unknown,
  path: string,
  read: (value: unknown, path: string) => T,
): T | null {
  return value === null ? null : read(value, path);
}

export function reference(value: unknown, path: string, ids: ReadonlySet<string>): string {
  const id = text(value, path);
  if (!ids.has(id)) {
    return invalid(path, "Unknown channel ID");
  }
  return id;
}
