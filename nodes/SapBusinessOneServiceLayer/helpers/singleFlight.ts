/**
 * Collapses concurrent calls for the same key onto a single in-flight promise,
 * registered synchronously before the first `await` so a batch of concurrent
 * callers shares one factory invocation instead of one each.
 */
export function withSingleFlight<T>(
	pending: Map<string, Promise<T>>,
	key: string,
	factory: () => Promise<T>,
): Promise<T> {
	const existing = pending.get(key);

	if (existing !== undefined) {
		return existing;
	}

	const flight = factory().finally(() => {
		pending.delete(key);
	});

	pending.set(key, flight);

	return flight;
}
