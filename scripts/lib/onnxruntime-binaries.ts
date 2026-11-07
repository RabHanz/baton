/**
 * onnxruntime-node (memory recall, MEM-13) bundles every OS and arch's binaries, about 290 MB. A staged server keeps only
 * its target's: the CLI archive and the desktop's Windows server sidecar both prune with this.
 */
export const ONNXRUNTIME_BIN_DIR = "node_modules/onnxruntime-node/bin/napi-v6";

export const onnxRuntimeTarget = (platform: "mac" | "linux" | "win", arch: string): string =>
  `${platform === "mac" ? "darwin" : platform === "win" ? "win32" : "linux"}/${arch}`;

/** Of the installed `<os>/<arch>` folders, the ones a build for this target must remove (relative to the stage). */
export const foreignOnnxRuntimeDirs = (
  installed: ReadonlyArray<string>,
  platform: "mac" | "linux" | "win",
  arch: string,
): ReadonlyArray<string> => {
  const target = onnxRuntimeTarget(platform, arch);
  return installed.filter((dir) => dir !== target).map((dir) => `${ONNXRUNTIME_BIN_DIR}/${dir}`);
};
