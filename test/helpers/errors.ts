/**
 * Flattens an unknown thrown value into one searchable string.
 *
 * `JSON.stringify(someError)` returns `{}` — an `Error`'s own properties are
 * non-enumerable — so a leak assertion built on it would pass vacuously. This
 * walks the fields n8n's error classes actually carry instead.
 *
 * Note that this is also why tests capture errors with
 * `.catch((caught: unknown) => caught)` rather than `try`/`catch`: the shared
 * ESLint config's `require-node-api-error` rule rejects any `throw` inside a
 * `catch` block, test file or not.
 */
export function flattenErrorText(error: unknown): string {
	const parts: string[] = [];
	const seen = new WeakSet<object>();

	const walk = (value: unknown): void => {
		if (typeof value === 'string') {
			parts.push(value);
			return;
		}

		if (typeof value !== 'object' || value === null) {
			if (typeof value === 'number' || typeof value === 'boolean') {
				parts.push(String(value));
			}
			return;
		}

		if (seen.has(value)) {
			return;
		}

		seen.add(value);

		if (Array.isArray(value)) {
			for (const entry of value) {
				walk(entry);
			}
			return;
		}

		const record = value as Record<string, unknown>;

		// `message` and `stack` live on the prototype chain for Error instances,
		// so read them explicitly before enumerating own properties.
		walk(record.message);
		walk(record.description);

		for (const entry of Object.values(record)) {
			walk(entry);
		}
	};

	walk(error);

	return parts.join('\n');
}
