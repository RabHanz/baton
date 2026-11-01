import { describe, expect, it } from "vite-plus/test";

import {
  biasTranscript,
  candidateWords,
  correctionsBetween,
  learnCorrection,
  observeWording,
  parseAddToDictionary,
  parseVocabulary,
  promptTerms,
  upsertEntry,
} from "./vocabulary.ts";

const NOW = "2026-11-01T10:00:00.000Z";

describe("vocabulary file", () => {
  it("reads old files and new, and skips junk", () => {
    expect(
      parseVocabulary([
        { phrase: "Kubernetes", replacement: null },
        { phrase: "gee pee tee", replacement: "GPT", source: "learned", count: 4, lastSeen: NOW },
        { phrase: "" },
        "x",
      ]),
    ).toEqual([
      { phrase: "Kubernetes", replacement: null, source: "added", count: 1 },
      { phrase: "gee pee tee", replacement: "GPT", source: "learned", count: 4, lastSeen: NOW },
    ]);
    expect(parseVocabulary({})).toEqual([]);
  });

  it("lists the most used terms first, and keeps 'added' once he says it himself", () => {
    let entries = upsertEntry(
      [],
      { phrase: "Parakeet", replacement: null, source: "learned" },
      NOW,
      5,
    );
    entries = upsertEntry(
      entries,
      { phrase: "Baton", replacement: null, source: "learned" },
      NOW,
      1,
    );
    entries = upsertEntry(entries, { phrase: "baton", replacement: null, source: "added" }, NOW);
    expect(promptTerms(entries)).toEqual(["Parakeet", "Baton"]);
    expect(entries.find((e) => e.phrase === "Baton")).toMatchObject({ source: "added", count: 2 });
  });
});

describe("the voice command", () => {
  it("finds the word to add", () => {
    expect(parseAddToDictionary("Add Kubernetes to my dictionary")).toBe("Kubernetes");
    expect(parseAddToDictionary("Baton, please add “Wispr Flow” to the vocabulary.")).toBe(
      "Wispr Flow",
    );
    expect(parseAddToDictionary("add the milk to the shopping list")).toBeNull();
  });
});

describe("learning from his corrections", () => {
  it("learns a mis-heard word only after he fixes it twice, and ignores rewrites", () => {
    const fix = correctionsBetween(
      "Ask Sam about the Cooper Netties cluster",
      "Ask Sam about the Kubernetes cluster",
    );
    expect(fix).toEqual([]); // two words became one: a rewrite, not a swap
    const swap = correctionsBetween(
      "Deploy it to Cooper Nettie today",
      "Deploy it to Cooper Kubernetes today",
    );
    expect(swap).toEqual([]);
    const one = correctionsBetween("Please call Tomas about it", "Please call Thomas about it");
    expect(one).toEqual([{ heard: "Tomas", meant: "Thomas" }]);
    let state = learnCorrection({}, [], one[0]!, NOW);
    expect(state.entries).toEqual([]);
    state = learnCorrection(state.seen, state.entries, one[0]!, NOW);
    expect(state.entries).toMatchObject([
      { phrase: "Tomas", replacement: "Thomas", source: "learned", count: 2 },
    ]);
  });
});

describe("learning from his wording", () => {
  it("promotes a repeated name or term at the threshold and never a wake word or common word", () => {
    expect(
      candidateWords(
        "We shipped to Lahore. Then Monday we met Zohaib about GitHub2 and the Baton app.",
      ),
    ).toEqual(expect.arrayContaining(["Lahore", "Zohaib", "GitHub2", "Baton"]));
    let state = {
      seen: {} as Record<string, number>,
      entries: [] as ReturnType<typeof parseVocabulary>,
    };
    for (let i = 0; i < 3; i += 1) {
      state = observeWording(
        state.seen,
        state.entries,
        "We spoke to Zohaib and Baton today.",
        NOW,
        ["Baton"],
      );
    }
    expect(state.entries).toMatchObject([
      { phrase: "Zohaib", replacement: null, source: "learned", count: 3 },
    ]);
  });
});

describe("recognition bias", () => {
  it("puts a near-miss of a name right, and leaves ordinary words alone", () => {
    const entries = parseVocabulary([
      { phrase: "Zohaib", replacement: null },
      { phrase: "Kubernetes", replacement: null },
    ]);
    expect(biasTranscript("Ask Zohayb about Kubernetis and colour.", entries)).toBe(
      "Ask Zohaib about Kubernetes and colour.",
    );
  });
});
