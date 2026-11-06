import { describe, expect, it } from "vite-plus/test";

import { sameSyncOrigin, syncPeerUrl } from "./batonMemorySync";

describe("where a memory-sync credential may go", () => {
  it("keeps a relay's base path, and refuses plain http off this machine and the tailnet", () => {
    expect(syncPeerUrl("https://relay.example/env/abc", "/oauth/token")?.href).toBe(
      "https://relay.example/env/abc/oauth/token",
    );
    expect(syncPeerUrl("http://127.0.0.1:3773", "tessaya/desk/x")?.href).toBe(
      "http://127.0.0.1:3773/tessaya/desk/x",
    );
    expect(syncPeerUrl("http://100.101.2.3:3773", "x")).not.toBeNull();
    expect(syncPeerUrl("http://100.200.2.3:3773", "x")).toBeNull();
    expect(syncPeerUrl("http://192.168.1.4:3773", "x")).toBeNull();
  });

  it("is sent only back to the origin it was issued by", () => {
    const url = syncPeerUrl("https://box.example", "x")!;
    expect(sameSyncOrigin("https://box.example", url)).toBe(true);
    expect(sameSyncOrigin("https://other.example", url)).toBe(false);
  });
});
