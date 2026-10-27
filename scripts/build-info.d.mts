export function readBuildInfo(): {
  version: string;
  commit: string | null;
  dirty: boolean;
};
