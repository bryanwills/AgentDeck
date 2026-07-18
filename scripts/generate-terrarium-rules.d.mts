// Type surface of generate-terrarium-rules.mjs for the vitest sync test.
import type { TerrariumRules } from '../shared/src/terrarium-rules.js';

export declare function emitSwift(rules: TerrariumRules): string;
export declare function emitKotlin(rules: TerrariumRules): string;
export declare function emitCpp(rules: TerrariumRules): string;
export declare const OUTPUTS: ReadonlyArray<
  readonly [string, (rules: TerrariumRules) => string]
>;
