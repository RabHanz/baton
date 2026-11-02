/**
 * Every piece of user-facing text the window draws, in one table per language. English is the only
 * one today; a second language is a second object with the same keys, and any key it leaves out falls
 * back to English. Text with a gap in it uses {name}, filled by `text`. New pages put their words here:
 * `strings.test.ts` fails when a page file that has been moved over grows a literal of its own.
 */
export type Locale = "en";

export const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
  en: {
    "intro.scratchpad.title": "Scratchpad",
    "intro.scratchpad.text": "Quick notes you speak or type, kept on this computer and searchable.",
    "intro.insights.title": "Insights",
    "intro.insights.text":
      "How much you dictate, how fast, what Tessaya fixed and where. Worked out on this computer from your History; compared only with your own past.",
    "intro.style.title": "Style",
    "intro.style.text":
      "How formal Tessaya writes for each kind of app, and how much it tidies what you say.",
    "intro.transforms.title": "Transforms",
    "intro.transforms.text":
      "Rewrite selected text with a named prompt: Polish, Prompt engineer, Shorten, Translate, or your own. By shortcut or by voice, with an undo.",
    "intro.snippets.title": "Snippets",
    "intro.snippets.text":
      "Say a short cue and the full text lands in the field: an email address, a link, a prompt you reuse.",
    "intro.now.title": "Now",
    "intro.now.text":
      "What needs you, what Tessaya is keeping track of and doing, what it learned today, and what it held back and why.",
    "intro.sessions.title": "Sessions",
    "intro.sessions.text":
      "Every live session on every connected machine. Open one, or type to it.",
    "intro.approvals.title": "Approvals",
    "intro.approvals.text":
      "Everything waiting for your yes, with what it would do and what it would use. High-risk actions still ask you aloud when they happen.",
    "intro.jobs.title": "Jobs",
    "intro.jobs.text":
      "Long work Tessaya handed to a worker. It plans first and starts only when you approve.",
    "intro.dictation.title": "Dictation",
    "intro.dictation.text": "Talk into any app. Your words stay on this computer.",
    "intro.tools.title": "Skills and tools",
    "intro.tools.text":
      "The plugins, skills and servers that Claude Code and Codex already have. Tessaya adds none of its own. A plugin switch changes Claude Code\u2019s own setting and applies to its next session.",
    "intro.memory.title": "Memory",
    "intro.memory.text":
      "What Tessaya remembers about you and your work, and what it learned. Search it, correct it, pin what must never fade, or forget it. Forgetting a memory never touches Tessaya itself.",
    "intro.vault.title": "Vault",
    "intro.vault.text":
      "Passwords, keys and private notes, encrypted on this computer. Tessaya can use a secret for you without ever seeing it, and every use is logged here. Banking passwords you always type yourself.",
    "intro.history.title": "History",
    "intro.history.text":
      "Everything you said and what it became. Kept on this computer, forever, until you delete it.",
    "intro.assistant.title": "Assistant",
    "intro.assistant.text":
      "What Tessaya works through, whose subscription it uses, and what it may do without asking.",
    "intro.voice.title": "Voice",
    "intro.voice.text": "How Tessaya hears you and how it sounds back.",
    "intro.screen.title": "Screen",
    "intro.screen.text": "When Tessaya may look at your screen, and how to stop it.",
    "intro.usage.title": "Usage",
    "intro.usage.text": "How much of each account is left.",
    "intro.trust.title": "Trust",
    "intro.trust.text":
      "Everything Tessaya may do on your behalf, when it last did it, and a button to take each back. Below, a record of what it did.",
    "intro.help.title": "Help",
    "intro.help.text":
      "What you can say, the keys, and what to try when a check fails. Press Ctrl+K anywhere to search everything.",
    "intro.checks.title": "Checks",
    "intro.checks.text": "See what is wrong without reading a log.",
    "tab.home": "Home",
    "tab.now": "Now",
    "tab.snippets": "Snippets",
    "tab.insights": "Insights",
    "tab.scratchpad": "Scratchpad",
    "tab.style": "Style",
    "tab.transforms": "Transforms",
    "tab.sessions": "Sessions",
    "tab.approvals": "Approvals",
    "tab.jobs": "Jobs",
    "tab.dictation": "Dictation",
    "tab.history": "History",
    "tab.memory": "Memory",
    "tab.vault": "Vault",
    "tab.tools": "Skills",
    "tab.assistant": "Assistant",
    "tab.voice": "Voice",
    "tab.screen": "Screen",
    "tab.usage": "Usage",
    "tab.trust": "Trust",
    "tab.checks": "Checks",
    "tab.help": "Help",
    "modal.general": "General",
    "modal.system": "System",
    "modal.keys": "Keyboard and mouse",
    "modal.account": "Account",
    "modal.updates": "Updates",
    "modal.about": "About",
    "wizard.back": "Back",
    "wizard.skip": "Skip the rest",
    "wizard.close": "Close",
    "wizard.next": "Next",
    "wizard.finish": "Finish",
    "wizard.rerun": "Run the setup guide again",
    "wizard.step": "Step {n} of {total}",
    "backup.section": "Back up and move to another computer",
    "backup.preview": "Restore preview",
    "backup.export.label": "Export all my Tessaya data",
    "backup.export.hint":
      "One zip of your settings, vocabulary, snippets, notes, transforms, style, commitments, pack and memory notes. Never the vault, sign-ins or recordings; the Vault tab has its own encrypted export.",
    "backup.export.button": "Export",
    "backup.restore.label": "Restore from a zip",
    "backup.restore.hint":
      "Choose a zip made by Export. Nothing changes until you have seen what it would do.",
    "backup.restore.button": "Choose a zip",
    "backup.apply.label": "Restore {n} file(s) from {file}",
    "backup.apply.button": "Restore now",
    "backup.apply.cancel": "Cancel",
    "backup.new": "will be added",
    "backup.replaces": "will replace yours (yours is kept as .bak)",
    "backup.same": "is already the same",
    "backup.refused": "is not something Tessaya restores",
    "setup.section": "Setup",
    "setup.hold.label": "Hold to dictate",
    "setup.hold.own": "{key} (your own)",
    "setup.assistant.title": "Choose your assistant",
    "setup.assistant.text":
      "Tessaya works through a coding assistant you already pay for and are signed in to. Pick one that says Ready. Listening and speaking stay on this computer.",
    "setup.mic.title": "Check your microphone",
    "setup.mic.text":
      "Turn listening on, then say something. The bar should move. If it stays flat, pick another microphone.",
    "setup.wake.title": "Pick the words that wake it",
    "setup.wake.text":
      "Say one of these and Tessaya starts listening. Keep the ones you like; switch off the rest.",
    "setup.key.title": "Choose your dictation key",
    "setup.key.text":
      "Hold this key and speak: the words are typed into whatever app you are in. You can add more keys, or a mouse button, later under Settings, Keyboard and mouse.",
    "setup.try.title": "Say one sentence",
    "setup.try.text": "Click the box, hold your dictation key, say a sentence, and let go.",
    "setup.pill.title": "Where should the pill sit?",
    "setup.pill.text":
      "The pill is the small bar that shows when Tessaya is listening. It stays out of the way when it has nothing to say.",
    "setup.privacy.title": "Your privacy choices",
    "setup.privacy.text":
      "Both are off until you turn them on. Recording keeps your voice on this computer only. Awareness lets the assistant know which window you are in, and nothing more.",
  },
};

export const DEFAULT_LOCALE: Locale = "en";

/** A locale's table with English behind it, so a missing key is English, never blank. */
export const tableFor = (locale: string): Readonly<Record<string, string>> => ({
  ...STRINGS[DEFAULT_LOCALE],
  ...(STRINGS as Readonly<Record<string, Readonly<Record<string, string>>>>)[locale],
});

export const fill = (
  template: string,
  vars: Readonly<Record<string, string | number>> = {},
): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );

/** The words for a key; the key itself when it is unknown, so a gap is visible rather than empty. */
export const text = (
  key: string,
  vars?: Readonly<Record<string, string | number>>,
  locale: string = DEFAULT_LOCALE,
): string => fill(tableFor(locale)[key] ?? key, vars);
