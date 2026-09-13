import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

/** The full-response shape the production code always asks for (`returnFullResponse: true`). */
export interface FakeResponse {
	statusCode: number;
	body?: unknown;
	headers?: IDataObject;
}

/** A route that rejects, modelling a DNS/TLS/connection failure rather than an HTTP status. */
export interface RejectingRoute {
	rejectWith: unknown;
}

/** A route that decides per call — used with a deferred to hold a request open. */
export type RouteHandler = (options: IHttpRequestOptions) => Promise<FakeResponse>;

/**
 * What a route answers with: one response reused for every call, a script
 * consumed one entry per call, a transport-level rejection, or a handler.
 */
export type Route = FakeResponse | FakeResponse[] | RejectingRoute | RouteHandler;

/** Keyed `"<METHOD> <url>"`, e.g. `'POST /Login'` or `'GET /Orders(45)'`. */
export type RouteTable = Record<string, Route>;

export interface HttpFake {
	httpRequest(options: IHttpRequestOptions): Promise<unknown>;
	/** Every call in order, exactly as the production code built it. */
	readonly calls: IHttpRequestOptions[];
	callsFor(key: string): IHttpRequestOptions[];
	countFor(key: string): number;
}

function isRejectingRoute(route: Route): route is RejectingRoute {
	return typeof route !== 'function' && !Array.isArray(route) && 'rejectWith' in route;
}

function routeKey(options: IHttpRequestOptions): string {
	return `${(options.method ?? 'GET').toUpperCase()} ${options.url ?? ''}`;
}

/**
 * An in-process stand-in for `this.helpers.httpRequest`. It answers from a route
 * table and records every request, so tests assert on what the production code
 * actually put on the wire instead of reaching a Service Layer.
 *
 * Unknown and exhausted routes throw at the top level rather than from inside a
 * `catch`, which keeps the `require-node-api-error` lint rule out of play.
 */
export function createHttpFake(routes: RouteTable): HttpFake {
	const calls: IHttpRequestOptions[] = [];
	const scripts = new Map<string, FakeResponse[]>();

	for (const [key, route] of Object.entries(routes)) {
		if (Array.isArray(route)) {
			scripts.set(key, [...route]);
		}
	}

	const httpRequest = async (options: IHttpRequestOptions): Promise<unknown> => {
		// Snapshot before answering: `headers` is rebuilt per call, and a later
		// mutation of the session must not rewrite what we recorded.
		calls.push({ ...options, headers: { ...(options.headers ?? {}) } });

		const key = routeKey(options);
		const route = routes[key];

		if (route === undefined) {
			throw new Error(`unexpected request: ${key}`);
		}

		if (isRejectingRoute(route)) {
			return await Promise.reject(route.rejectWith);
		}

		const response =
			typeof route === 'function'
				? await route(options)
				: Array.isArray(route)
					? scripts.get(key)?.shift()
					: route;

		if (response === undefined) {
			throw new Error(`route exhausted: ${key}`);
		}

		return {
			statusCode: response.statusCode,
			body: response.body,
			headers: response.headers ?? {},
		};
	};

	return {
		httpRequest,
		calls,
		callsFor: (key) => calls.filter((options) => routeKey(options) === key),
		countFor: (key) => calls.filter((options) => routeKey(options) === key).length,
	};
}

export interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
}

/**
 * A promise whose settlement the test controls. This is how concurrency is
 * staged: no timers are used anywhere in the suite, because the shared ESLint
 * config bans `setTimeout` and friends as restricted globals.
 *
 * Combine with a handler route to hold a request open:
 * `{ 'POST /Login': () => deferred.promise }`.
 */
export function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;

	const promise = new Promise<T>((resolveFn, rejectFn) => {
		resolve = resolveFn;
		reject = rejectFn;
	});

	return { promise, resolve, reject };
}
