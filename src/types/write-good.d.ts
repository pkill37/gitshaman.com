declare module 'write-good' {
  export interface WriteGoodSuggestion {
    index: number;
    offset: number;
    reason: string;
  }

  export interface WriteGoodOptions {
    passive?: boolean;
    illusion?: boolean;
    so?: boolean;
    thereIs?: boolean;
    weasel?: boolean;
    adverb?: boolean;
    tooWordy?: boolean;
    cliches?: boolean;
    eprime?: boolean;
  }

  export default function writeGood(
    text: string,
    options?: WriteGoodOptions
  ): WriteGoodSuggestion[];
}
