/**
 * Re-read a reply that was not there yet.
 *
 * Claude Code runs its Stop hook while it is still writing the turn's final
 * assistant record to the transcript: measured 2026-09-03, a turn's Stop
 * landed at 21:20:22Z and the record holding its 1,638-character reply
 * carries 21:20:22.395Z — the daemon's read at the hook found nothing, and
 * the same read minutes later found all of it. One third of a week's
 * Claude stop-turns (113 of 344) archived no reply that way, and every one
 * of those tasks then read as "no reply captured" on the Work board.
 *
 * So an empty read at the Stop is not an answer; it is retried on a short,
 * bounded schedule and applied through the collector's last-closed-turn path,
 * which refuses to overwrite a reply that arrived by other means. Pure so the
 * schedule is testable: the reader, the sink and the timer are injected.
 */

export const DEFERRED_REPLY_DELAYS_MS: readonly number[] = [1_500, 6_000];

export function scheduleDeferredReplyRead(
  read: () => string,
  apply: (text: string) => void,
  opts: {
    delays?: readonly number[];
    setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
  } = {},
): void {
  const delays = opts.delays ?? DEFERRED_REPLY_DELAYS_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const attempt = (i: number): void => {
    if (i >= delays.length) return;
    const t = setTimer(() => {
      let text = '';
      try { text = read(); } catch { text = ''; }
      if (text) { apply(text); return; }
      attempt(i + 1);
    }, delays[i]!);
    t.unref?.();
  };
  attempt(0);
}
