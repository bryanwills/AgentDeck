/**
 * Plugin debug logger — gated by build-time constant.
 *
 * Dev build  (pnpm build):           __SDC_DEBUG__ = true  → logs to streamDeck.logger
 * Prod build (SDC_PROD=1 pnpm build): __SDC_DEBUG__ = false → dlog() is a no-op
 *
 * Usage:
 *   import { dlog } from '../log.js';
 *   dlog('Tag', 'message', value);
 */
import streamDeck from '@elgato/streamdeck';

declare const __SDC_DEBUG__: boolean;

const DEBUG: boolean =
  typeof __SDC_DEBUG__ !== 'undefined' ? __SDC_DEBUG__ : true;

export function dlog(tag: string, ...args: unknown[]): void {
  if (!DEBUG) return;
  streamDeck.logger.debug(`[${tag}] ${args.map(String).join(' ')}`);
}

export function dwarn(tag: string, ...args: unknown[]): void {
  // Warnings always log regardless of DEBUG flag
  streamDeck.logger.warn(`[${tag}] ${args.map(String).join(' ')}`);
}

export function derr(tag: string, ...args: unknown[]): void {
  // Errors always log regardless of DEBUG flag
  streamDeck.logger.error(`[${tag}] ${args.map(String).join(' ')}`);
}
