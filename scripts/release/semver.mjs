export const mainBranch = "main";

const bump = { major: "major", minor: "minor", patch: "patch" };

/** One bump per merged PR; the strongest signal in its title/body/commits wins. */
export function bumpKind(messages) {
  const text = messages.join("\n");

  if (
    /^[a-z]+(?:\([^\n)]+\))?!:\s/m.test(text) ||
    /^BREAKING[ -]CHANGE:\s/m.test(text)
  )
    return bump.major;

  if (/^feat(?:\([^\n)]+\))?:\s/m.test(text)) return bump.minor;

  return bump.patch;
}

/** Applies one major, minor or patch bump to a stable x.y.z version. */
export function bumpVersion(version, kind) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error(`Expected stable semantic version, got ${version}`);

  const [major, minor, patch] = version.split(".").map(Number);

  if (kind === bump.major) return `${major + 1}.0.0`;

  if (kind === bump.minor) return `${major}.${minor + 1}.0`;

  if (kind === bump.patch) return `${major}.${minor}.${patch + 1}`;

  throw new Error(`Unknown bump: ${kind}`);
}

/** Applies one bump per PR merged into main, in order, skipping repeats; returns the final version and each step. */
export function planVersions(version, pullRequests) {
  const seen = new Set();

  const entries = [];

  for (const pr of pullRequests) {
    if (!pr.merged_at || pr.base?.ref !== mainBranch || seen.has(pr.number))
      continue;

    seen.add(pr.number);

    const kind = bumpKind([
      pr.title ?? "",
      pr.body ?? "",
      ...(pr.messages ?? []),
    ]);

    version = bumpVersion(version, kind);

    entries.push({ number: pr.number, title: pr.title, kind, version });
  }

  return { version, entries };
}
