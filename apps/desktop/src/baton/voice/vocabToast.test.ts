import { describe, expect, it } from "vite-plus/test";

import { toastDocument, toastText } from "./vocabToast.ts";

describe("the vocabulary toast", () => {
  it("says what was added in one line, however many words", () => {
    expect(toastText(["Kowalczyk"])).toBe("Added “Kowalczyk” to your vocabulary");
    expect(toastText(["A", "B"])).toBe("Added “A”, “B” to your vocabulary");
    expect(toastText(["A", "B", "C", "D"])).toBe("Added 4 words to your vocabulary");
  });
  it("puts a word in the page as text, never as markup", () => {
    expect(toastDocument(["<img src=x onerror=1>"])).not.toContain("<img");
  });
});
