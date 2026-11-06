export interface PanePrompt {
  readonly question: string;
  readonly header: string | null;
  readonly tabs?: ReadonlyArray<{ label: string; answered: boolean; submit: boolean }>;
  readonly context: string;
  readonly options: ReadonlyArray<{
    readonly index: number;
    readonly label: string;
    readonly description: string;
    readonly keys?: ReadonlyArray<string>;
  }>;
  readonly selected: number;
  readonly customIndex: number | null;
  readonly review?: true;
  readonly key: string;
}

export declare const screenTail: (screen: string, lines?: number) => string;
export declare function parseReviewScreen(lines: ReadonlyArray<string>): PanePrompt | null;
export declare function parsePanePrompt(screen: string | null | undefined): PanePrompt | null;
