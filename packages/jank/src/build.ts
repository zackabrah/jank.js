import manifest from "../package.json" with { type: "json" };

declare const __JANK_BUILD_REVISION__: string;

/** Source/dev imports are explicit; production builds inject the source revision once. */
export const buildVersion = `${manifest.version}+${typeof __JANK_BUILD_REVISION__ === "string" ? __JANK_BUILD_REVISION__ : "source"}`;
