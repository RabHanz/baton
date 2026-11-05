/**
 * One spoken sentence each, and the tool the one assistant should reach for first. `first` lists the
 * acceptable first tools ("none" means it should answer without a tool); `not` lists tools that are a
 * wrong first move. Sources: the 2026-11-04 review (INT-4) and the Help page's examples.
 */
export interface AssistantCase {
  readonly id: string;
  readonly source: string;
  readonly said: string;
  readonly first: ReadonlyArray<string>;
  readonly not?: ReadonlyArray<string>;
  /** The wake word he said; its persona from the default roster answers. */
  readonly wake?: string;
  /** Words the reply must contain, such as the persona's name. */
  readonly says?: string;
}

export const assistantCases: ReadonlyArray<AssistantCase> = [
  {
    id: "needs-me",
    source: "INT-4: the prompt sent 'what needs me' to fleet_status and needs_me at once",
    said: "what needs me?",
    first: ["needs_me"],
  },
  {
    id: "needs-my-approval",
    source: "INT-3/INT-4: the prompt's approvals rule",
    said: "what needs my approval?",
    first: ["approvals_list"],
  },
  {
    id: "everyone-working-on",
    source: "Help page: fleet_status",
    said: "what is everyone working on?",
    first: ["fleet_status", "sessions_list"],
  },
  {
    id: "tell-build-session",
    source: "INT-4: prompt said weave_send, the Help page teaches session_send",
    said: "tell the build session to rerun the tests",
    first: ["sessions_list", "sessions_find", "session_send"],
    not: ["weave_send"],
  },
  {
    id: "rule-once-done",
    source: "INT-8: 'when X finishes, have Codex review it' had no tool on the assistant's path",
    said: "once the shop session's done, get Codex to review it and tell me",
    first: ["rule_create"],
  },
  {
    id: "anything-stuck",
    source: "agentPrompt status rules",
    said: "is anything stuck?",
    first: ["watch_report"],
  },
  {
    id: "remind-me",
    source: "agentPrompt commitments rule",
    said: "remind me to check the deploy in an hour",
    first: ["commit_add"],
  },
  {
    id: "remember-site",
    source: "Help page: memory_search",
    said: "what do you remember about the shop site?",
    first: ["memory_search"],
  },
  {
    id: "take-a-job",
    source: "INT-5 device proof sentence",
    said: "take on a job: tidy the README in the shop project",
    first: ["job_start"],
  },
  {
    id: "split-by-specialist",
    source: "INT-5 control: an explicit split by specialist reaches the job tools",
    said: "the shop README job is agreed: give the copy to marketing and the code to engineering",
    first: ["job_split", "jobs_list"],
  },
  {
    id: "teach-me",
    source: "agentPrompt teach rule (teach_start was missing from the tool roll-call)",
    said: "teach me how to change the font size in Notepad",
    first: ["teach_start"],
  },
  {
    id: "unnamed-button",
    source:
      "CU-12 (2026-11-04 review): a control the tree cannot name invites a UI Automation script",
    said: "the button in that app has no name, just press it however you can",
    first: ["ui_tree", "screen_capture"],
    not: ["Bash", "PowerShell"],
  },
  {
    id: "work-notepad",
    source:
      "CU-7/CU-12 (2026-11-04 review): an app is worked through the tree, never a shell script",
    said: "type hello world into notepad and save it",
    first: ["ui_tree"],
    not: ["Bash", "PowerShell"],
  },
  {
    id: "start-dictating",
    source: "control: Help page dictation_start",
    said: "start dictating",
    first: ["dictation_start"],
  },
  {
    id: "look-discourse",
    source: "INT-9: a spoken 'Look, …' is a discourse marker, not a screen request",
    said: "look, what needs me today?",
    first: ["needs_me"],
    not: ["screen_capture"],
  },
  {
    id: "dictation-apps",
    source: "INT-10: 'dictation' at the start of a question is not a request to dictate",
    said: "dictation apps, which one's best?",
    first: ["none", "WebSearch"],
    not: ["dictation_start"],
  },
  {
    id: "tell-it-to-stop",
    source: "INT-7: 'it' with no current target must be found or asked, never guessed",
    said: "tell it to stop",
    first: ["none", "sessions_list", "fleet_status"],
    not: ["session_send", "weave_send"],
  },
  {
    id: "capital-of-peru",
    source: "control: a plain question needs no tool",
    said: "what's the capital of Peru?",
    first: ["none", "WebSearch"],
  },
  {
    id: "freya-says-her-name",
    source: "Roster v0: a wake word picks the persona, which answers under its own name",
    said: "what time is it?",
    wake: "Freya",
    first: ["none"],
    says: "Freya",
  },
  {
    id: "alfred-says-his-name",
    source: "Roster v0 device proof sentence",
    said: "what time is it?",
    wake: "Alfred",
    first: ["none"],
    says: "Alfred",
  },
  {
    id: "persona-keeps-its-tools",
    source: "Roster v0 control: a persona changes the name, not the tool",
    said: "what needs me?",
    wake: "Freya",
    first: ["needs_me"],
  },
];
