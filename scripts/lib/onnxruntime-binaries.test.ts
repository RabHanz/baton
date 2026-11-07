import { describe, expect, it } from "vite-plus/test";

import { foreignOnnxRuntimeDirs, onnxRuntimeTarget } from "./onnxruntime-binaries.ts";

const INSTALLED = ["darwin/arm64", "linux/arm64", "linux/x64", "win32/arm64", "win32/x64"];

describe("onnxruntime-node's binaries in a staged server", () => {
  it.each([
    ["linux", "x64", "linux/x64"],
    ["win", "x64", "win32/x64"],
    ["mac", "arm64", "darwin/arm64"],
  ] as const)("a %s %s build keeps only %s", (platform, arch, kept) => {
    expect(onnxRuntimeTarget(platform, arch)).toBe(kept);
    const removed = foreignOnnxRuntimeDirs(INSTALLED, platform, arch);
    expect(removed).toHaveLength(INSTALLED.length - 1);
    expect(removed.some((dir) => dir.endsWith(`/${kept}`))).toBe(false);
  });
});
