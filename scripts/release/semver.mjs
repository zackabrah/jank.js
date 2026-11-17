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

/** Promotes an RC to its stable target; otherwise applies the requested bump. */
export function bumpVersion(version, kind) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/.exec(version);

  if (!match)
    throw new Error(`Expected stable or RC semantic version, got ${version}`);

  if (!Object.values(bump).includes(kind)) throw new Error(`Unknown bump: ${kind}`);

  if (match[4] !== undefined) return `${match[1]}.${match[2]}.${match[3]}`;

  const [major, minor, patch] = version.split(".").map(Number);

  if (kind === bump.major) return `${major + 1}.0.0`;

  if (kind === bump.minor) return `${major}.${minor + 1}.0`;

  return `${major}.${minor}.${patch + 1}`;
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
