import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { detachedWindowUrl } from "./batonWindows";

const target = {
  kind: "server" as const,
  threadRef: scopeThreadRef(EnvironmentId.make("box"), ThreadId.make("a/b")),
};

describe("detachedWindowUrl", () => {
  const location = { protocol: "http:", host: "localhost:3773", pathname: "/" };

  it("uses the path on the web and the hash on the desktop app", () => {
    expect(detachedWindowUrl(target, "w1", location, false)).toBe(
      "http://localhost:3773/box/a%2Fb?batonWindow=w1",
    );
    expect(detachedWindowUrl(target, "w1", location, true)).toBe(
      "http://localhost:3773/?batonWindow=w1#/box/a%2Fb",
    );
  });
});
