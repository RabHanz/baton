/**
 * Dictation languages. The multilingual speech model (Parakeet v3) recognises these 25 European
 * languages and can tell which one is being spoken; the fast English model recognises English only.
 * Anything else is not supported by either, and the window says so rather than pretending.
 */
export const PARAKEET_V3_LANGUAGES: ReadonlyArray<readonly [code: string, name: string]> = [
  ["bg", "Bulgarian"],
  ["hr", "Croatian"],
  ["cs", "Czech"],
  ["da", "Danish"],
  ["nl", "Dutch"],
  ["en", "English"],
  ["et", "Estonian"],
  ["fi", "Finnish"],
  ["fr", "French"],
  ["de", "German"],
  ["el", "Greek"],
  ["hu", "Hungarian"],
  ["it", "Italian"],
  ["lv", "Latvian"],
  ["lt", "Lithuanian"],
  ["mt", "Maltese"],
  ["pl", "Polish"],
  ["pt", "Portuguese"],
  ["ro", "Romanian"],
  ["ru", "Russian"],
  ["sk", "Slovak"],
  ["sl", "Slovenian"],
  ["es", "Spanish"],
  ["sv", "Swedish"],
  ["uk", "Ukrainian"],
];

export type SpeechModelChoice = "v3" | "fast";

export const languageOptions = (
  model: SpeechModelChoice,
): ReadonlyArray<{ readonly value: string; readonly label: string }> =>
  model === "fast"
    ? [{ value: "en", label: "English" }]
    : [
        { value: "auto", label: "Detect the language" },
        ...PARAKEET_V3_LANGUAGES.map(([value, label]) => ({ value, label })),
      ];

/** What the control shows for the saved language on this model: a language the model lacks shows the nearest honest choice. */
export const shownLanguage = (model: SpeechModelChoice, saved: string | null): string => {
  if (model === "fast") return "en";
  if (saved === null) return "auto";
  return PARAKEET_V3_LANGUAGES.some(([c]) => c === saved) ? saved : "auto";
};

/** The value to save for a choice; null lets the model detect. A choice the model does not offer is refused. */
export const languageToSave = (
  model: SpeechModelChoice,
  choice: string,
): string | null | undefined => {
  if (!languageOptions(model).some((o) => o.value === choice)) return undefined;
  return choice === "auto" ? null : choice;
};

export const LANGUAGE_HINT =
  "The multilingual model recognises 25 European languages (Bulgarian to Ukrainian, listed below) and can detect which you speak. It does not recognise Chinese, Japanese, Korean, Arabic, Hindi or other languages, and it has no regional spellings such as British English. The fast model is English only.";
