import { describe, expect, it } from "vite-plus/test";

import {
  canImportConversation,
  conversationUnavailableReason,
  formatConversationSize,
  workspaceRootTitle,
} from "./ImportConversationsDialog.logic";

describe("formatConversationSize", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KB"],
    [40_745, "40 KB"],
    // The two sessions this feature exists for.
    [180_968_090, "173 MB"],
    [440_275_995, "420 MB"],
  ])("renders %i as %s", (bytes, expected) => {
    expect(formatConversationSize(bytes)).toBe(expected);
  });
});

describe("workspaceRootTitle", () => {
  it.each([
    ["/home/onnyx/VentureOS", "VentureOS"],
    ["/home/onnyx/VentureOS/", "VentureOS"],
    ["C:\\Users\\rabee\\code\\fabric", "fabric"],
    ["/", "/"],
  ])("names %s after its last segment: %s", (root, expected) => {
    expect(workspaceRootTitle(root)).toBe(expected);
  });
});

describe("conversationUnavailableReason", () => {
  it("offers a conversation that is here and quiet", () => {
    const thread = { alreadyImported: false, stillWriting: false };
    expect(conversationUnavailableReason(thread)).toBeNull();
    expect(canImportConversation(thread)).toBe(true);
  });

  it("does not offer one that is already imported", () => {
    expect(conversationUnavailableReason({ alreadyImported: true, stillWriting: false })).toBe(
      "already-here",
    );
  });

  // Resuming a session that is still writing puts a second writer on the one
  // file that holds the conversation.
  it("does not offer one whose session is still writing", () => {
    expect(conversationUnavailableReason({ alreadyImported: false, stillWriting: true })).toBe(
      "still-running",
    );
    expect(canImportConversation({ alreadyImported: false, stillWriting: true })).toBe(false);
  });

  it("calls an imported one already here even while its session runs", () => {
    expect(conversationUnavailableReason({ alreadyImported: true, stillWriting: true })).toBe(
      "already-here",
    );
  });
});
