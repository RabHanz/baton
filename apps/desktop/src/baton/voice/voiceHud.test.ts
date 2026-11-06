import { describe, expect, it } from "vite-plus/test";

import { hudView, routeFor, trayDotColor, utteranceCaption } from "./voiceHud.ts";
import { VOICE_STATES } from "./voiceTypes.ts";

describe("HUD", () => {
  it("gives every state its own label and colour, and only muted is red", () => {
    const views = VOICE_STATES.map(hudView);
    expect(new Set(views.map((v) => v.label)).size).toBe(VOICE_STATES.length);
    expect(new Set(views.map((v) => v.color)).size).toBe(VOICE_STATES.length);
    expect(VOICE_STATES.filter((s) => hudView(s).color === "#ef4444")).toEqual(["muted"]);
  });

  it("does not pulse while it is not listening for words", () => {
    expect(hudView("sleeping").pulsing).toBe(false);
    expect(hudView("muted").pulsing).toBe(false);
    expect(hudView("direct_session").pulsing).toBe(true);
  });

  it("routes by mode", () => {
    expect(routeFor({ text: "x", mode: "dictation" })).toBe("focused_field");
    expect(routeFor({ text: "x", mode: "direct_session" })).toBe("focused_session");
    expect(routeFor({ text: "x", mode: "conversation" })).toBe("fabric_intent");
  });

  it("shows the last words and where they went, shortened", () => {
    expect(utteranceCaption({ text: "run the tests", mode: "direct_session" })).toBe(
      "“run the tests” to the focused session",
    );
    expect(utteranceCaption({ text: "a".repeat(200), mode: "dictation" }, 10)).toBe(
      "“aaaaaaaaa…” typed into the focused field",
    );
  });
});

describe("the tray's state dot", () => {
  it("rests in the palette's own accent for the taskbar's ground, and keeps the colours that mean something", () => {
    expect(trayDotColor("sleeping", "madder", false)).toBe("#8E1F2F");
    expect(trayDotColor("sleeping", "madder", true)).toBe("#E0707A");
    expect(trayDotColor("sleeping", "woad", true)).toBe("#5FB3B3");
    expect(trayDotColor("muted", "madder", true)).toBe(hudView("muted").color);
    expect(trayDotColor("listening", "damson", false)).toBe(hudView("listening").color);
  });
});
