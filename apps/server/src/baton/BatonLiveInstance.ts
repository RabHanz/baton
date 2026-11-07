/** The provider instance live threads run on: the ACP bridge to a Claude Code session already running in a terminal. */
export const BATON_LIVE_INSTANCE = "baton-live";

/** That session holds its own context, so a turn there never carries or injects a T3 context handoff. */
export const takesNoContextHandoff = (providerInstanceId: string): boolean =>
  providerInstanceId === BATON_LIVE_INSTANCE;
