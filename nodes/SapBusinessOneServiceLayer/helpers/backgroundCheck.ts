import { createHash } from 'node:crypto';

/**
 * How long a cached document is trusted by the editor before a list call checks
 * it again in the background. While the editor is used, this is at most one
 * check per company and document every two minutes; without editor activity
 * there is none, because only a list call starts one.
 */
export const BACKGROUND_CHECK_INTERVAL_MS = 2 * 60 * 1000;

/**
 * The Service Layer sends no `ETag` or `Last-Modified` on `/$metadata` and
 * answers `If-None-Match` with the full document, so a changed document is
 * told from an unchanged one by its hash. The document is byte-stable between
 * downloads, so an unchanged document always hashes alike.
 */
export function hashDocument(document: string): string {
	return createHash('sha256').update(document).digest('hex');
}

/** Whether the last check of a cached document is older than the interval. */
export function isDueForCheck(checkedAt: number): boolean {
	return Date.now() - checkedAt > BACKGROUND_CHECK_INTERVAL_MS;
}

/** Background checks still running, so tests can wait for them. */
const runningChecks = new Set<Promise<unknown>>();

/**
 * Lets a check run after the editor's list has answered. Its result lands in
 * the cache; a failure is dropped, so the cached state stays and no rejection
 * goes unhandled.
 */
export function startBackgroundCheck(check: Promise<unknown>): void {
	const tracked = check
		.catch(() => undefined)
		.finally(() => {
			runningChecks.delete(tracked);
		});

	runningChecks.add(tracked);
}

/**
 * Resolves once every background check started so far has finished. Used by
 * the tests, which may not wait with timers; the node itself never waits for a
 * check.
 */
export async function settleBackgroundChecks(): Promise<void> {
	await Promise.all([...runningChecks]);
}
