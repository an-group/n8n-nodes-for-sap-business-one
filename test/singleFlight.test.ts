import { describe, expect, it, vi } from 'vitest';

import { withSingleFlight } from '../nodes/SapBusinessOneServiceLayer/helpers/singleFlight';
import { createDeferred } from './helpers/http';

describe('withSingleFlight', () => {
	it('collapses concurrent calls for one key onto a single factory invocation', async () => {
		const deferred = createDeferred<string>();
		const factory = vi.fn(async () => await deferred.promise);
		const pending = new Map<string, Promise<string>>();

		const flights = [1, 2, 3, 4, 5].map(() => withSingleFlight(pending, 'k', factory));

		// Asserted while the factory is still in flight: once it settles, a passing
		// count would no longer prove anything about deduplication.
		expect(factory).toHaveBeenCalledTimes(1);

		deferred.resolve('value');

		expect(await Promise.all(flights)).toEqual(['value', 'value', 'value', 'value', 'value']);
	});

	it('hands every concurrent caller the same promise', () => {
		const deferred = createDeferred<string>();
		const pending = new Map<string, Promise<string>>();
		const factory = async () => await deferred.promise;

		const first = withSingleFlight(pending, 'k', factory);
		const second = withSingleFlight(pending, 'k', factory);

		expect(second).toBe(first);
		deferred.resolve('value');
	});

	it('registers the flight synchronously, before the first await', () => {
		const deferred = createDeferred<string>();
		const pending = new Map<string, Promise<string>>();

		void withSingleFlight(pending, 'k', async () => await deferred.promise);

		expect(pending.has('k')).toBe(true);
		deferred.resolve('value');
	});

	it('keeps different keys independent', async () => {
		const factory = vi.fn(async () => 'value');
		const pending = new Map<string, Promise<string>>();

		await Promise.all([
			withSingleFlight(pending, 'a', factory),
			withSingleFlight(pending, 'b', factory),
		]);

		expect(factory).toHaveBeenCalledTimes(2);
	});

	it('clears the entry after resolution, so a later call runs the factory again', async () => {
		const factory = vi.fn(async () => 'value');
		const pending = new Map<string, Promise<string>>();

		await withSingleFlight(pending, 'k', factory);

		expect(pending.size).toBe(0);

		await withSingleFlight(pending, 'k', factory);

		expect(factory).toHaveBeenCalledTimes(2);
	});

	it('clears the entry after rejection too, so a failure is not cached', async () => {
		const pending = new Map<string, Promise<string>>();
		const failing = async (): Promise<string> => await Promise.reject(new Error('nope'));

		await expect(withSingleFlight(pending, 'k', failing)).rejects.toThrow('nope');

		expect(pending.size).toBe(0);

		await expect(withSingleFlight(pending, 'k', async () => 'value')).resolves.toBe('value');
	});

	it('rejects every concurrent caller when the factory fails', async () => {
		const deferred = createDeferred<string>();
		const factory = vi.fn(async () => await deferred.promise);
		const pending = new Map<string, Promise<string>>();

		const flights = [1, 2, 3].map(() =>
			withSingleFlight(pending, 'k', factory).catch((caught: unknown) => caught),
		);

		deferred.reject(new Error('login failed'));

		const results = await Promise.all(flights);

		expect(factory).toHaveBeenCalledTimes(1);
		expect(results.every((result) => result instanceof Error)).toBe(true);
	});
});
