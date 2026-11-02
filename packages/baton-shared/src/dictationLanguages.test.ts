import { describe, expect, it } from "vite-plus/test";

import {
  languageOptions,
  languageToSave,
  PARAKEET_V3_LANGUAGES,
  shownLanguage,
} from "./dictationLanguages.ts";

describe("dictation languages", () => {
  it("lists 25 languages and detection for the multilingual model, English only for the fast one", () => {
    expect(PARAKEET_V3_LANGUAGES).toHaveLength(25);
    expect(languageOptions("v3")[0]).toEqual({ value: "auto", label: "Detect the language" });
    expect(languageOptions("v3")).toHaveLength(26);
    expect(languageOptions("fast")).toEqual([{ value: "en", label: "English" }]);
  });
  it("shows and saves only what the model can do", () => {
    expect(shownLanguage("fast", "fr")).toBe("en");
    expect(shownLanguage("v3", null)).toBe("auto");
    expect(shownLanguage("v3", "zh")).toBe("auto");
    expect(languageToSave("v3", "auto")).toBeNull();
    expect(languageToSave("v3", "de")).toBe("de");
    expect(languageToSave("v3", "zh")).toBeUndefined();
    expect(languageToSave("fast", "de")).toBeUndefined();
  });
});
