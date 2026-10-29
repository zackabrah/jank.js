/**
 *
 */

export interface BuildInfo {
  readonly version: string;
  readonly commit: string | null;
  readonly dirty: boolean;
}

declare const JANK_BUILD_INFO: BuildInfo;

const shortCommitLength = 8;

/** Identity of this built library, not the consuming application's checkout. */
export const buildInfo: BuildInfo = Object.freeze(
  typeof JANK_BUILD_INFO === "undefined"
    ? { version: "development", commit: null, dirty: false }
    : JANK_BUILD_INFO,
);

export const buildLabel = `v${buildInfo.version} · ${buildInfo.commit?.slice(0, shortCommitLength) ?? "unknown commit"}${buildInfo.dirty ? " · local changes" : ""}`;
