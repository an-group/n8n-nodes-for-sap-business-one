import type { FunctionsBase, IDataObject, IHttpRequestMethods } from 'n8n-workflow';
import { NodeOperationError, jsonParse } from 'n8n-workflow';

import { getServiceLayerCredentials } from './credentials';
import { serviceLayerApiRequest } from './request';
import type { ServiceLayerCredentialContext } from './types';

type NodeContext = Pick<FunctionsBase, 'getNode'>;

/** The HTTP methods the Custom API Call resource offers. */
export const CUSTOM_API_CALL_METHODS = ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'] as const;

export type CustomApiCallMethod = (typeof CUSTOM_API_CALL_METHODS)[number];

/** Methods that carry the optional JSON body; every other method is sent without one. */
export const CUSTOM_API_CALL_BODY_METHODS: readonly CustomApiCallMethod[] = [
	'PATCH',
	'POST',
	'PUT',
];

/**
 * Any leading URI scheme (`https:`, `mailto:`, ...). Deliberately broader than
 * axios's `isAbsoluteURL`, which only matches `<scheme>://` — whatever axios
 * treats as absolute bypasses `baseURL` and would carry the B1SESSION cookie to
 * that host.
 */
const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;

/**
 * Session handling is owned by the node. A custom `/Login` would return a
 * `SessionId` in its body, and `/Logout` would end the session every execution
 * using this credential shares.
 */
const SESSION_ENDPOINTS = new Set(['login', 'logout']);

/**
 * Synthetic origin the endpoint is resolved against as a final containment
 * check. Mirrors how axios joins `baseURL` and `url`; the `.invalid` TLD is
 * never contacted.
 */
const CONTAINMENT_PROBE_BASE = 'https://service-layer.invalid/b1s/v2';

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);

		if (code < 0x20 || code === 0x7f) {
			return true;
		}
	}

	return false;
}

/**
 * Decodes `%xx` escapes for inspection only. Unlike `decodeURIComponent` it
 * never throws on a malformed escape, which is left as-is.
 */
function decodePercentEscapes(value: string): string {
	return value.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) =>
		String.fromCharCode(parseInt(hex, 16)),
	);
}

/**
 * Path segments before the query string, decoded. Backslashes count as
 * separators because URL parsing treats them as `/` for http(s).
 */
function getPathSegments(endpoint: string): string[] {
	const path = endpoint.split(/[?#]/, 1)[0];

	return decodePercentEscapes(path)
		.split(/[/\\]/)
		.filter((segment) => segment !== '');
}

function rejectEndpoint(context: NodeContext, message: string, description: string): never {
	throw new NodeOperationError(context.getNode(), message, { description });
}

/**
 * Validates a user-supplied Custom API Call endpoint and returns it with a
 * leading slash. Anything that could leave the Service Layer API path — an
 * absolute or protocol-relative URL, a `..` segment — is rejected before any
 * request (or login) happens, as are the session endpoints.
 */
export function normalizeCustomEndpoint(context: NodeContext, endpoint: unknown): string {
	const trimmed = typeof endpoint === 'string' ? endpoint.trim() : '';

	if (trimmed === '') {
		rejectEndpoint(
			context,
			'The endpoint is empty',
			'Enter a Service Layer path relative to the API root, for example /Orders(45).',
		);
	}

	if (hasControlCharacter(trimmed)) {
		rejectEndpoint(
			context,
			'The endpoint contains control characters',
			'Remove line breaks, tabs, and other control characters from the endpoint.',
		);
	}

	if (URI_SCHEME_PATTERN.test(trimmed) || /^[/\\]{2}/.test(trimmed) || trimmed.startsWith('\\')) {
		rejectEndpoint(
			context,
			'Only relative Service Layer endpoints are allowed',
			'Enter the path relative to the Base URL of the credential, for example /Orders(45). Absolute URLs are rejected so the session is never sent to another server.',
		);
	}

	const segments = getPathSegments(trimmed);

	if (segments.some((segment) => segment === '..')) {
		rejectEndpoint(
			context,
			'The endpoint must not contain ".." path segments',
			'Custom API calls are limited to the Service Layer API path of the credential.',
		);
	}

	if (segments.length > 0 && SESSION_ENDPOINTS.has(segments[0].toLowerCase())) {
		rejectEndpoint(
			context,
			'The Login and Logout endpoints cannot be called directly',
			'The node manages Service Layer sessions itself: it logs in when needed and reuses the session across requests.',
		);
	}

	const normalized = `/${trimmed.replace(/^\/+/, '')}`;
	const resolved = new URL(`${CONTAINMENT_PROBE_BASE}${normalized}`);
	const probe = new URL(CONTAINMENT_PROBE_BASE);

	if (resolved.origin !== probe.origin || !resolved.pathname.startsWith(`${probe.pathname}/`)) {
		rejectEndpoint(
			context,
			'The endpoint resolves outside the Service Layer API path',
			'Enter a path relative to the Service Layer API root, for example /Orders(45).',
		);
	}

	return normalized;
}

/** Sentinel returned by `jsonParse` on failure, so no catch-and-rethrow is needed. */
const INVALID_JSON = Object.freeze({});

/**
 * Resolves the optional JSON body. An empty value means no body; an object or
 * array (from an expression) is used as-is; a string must parse to an object
 * or array.
 */
export function parseJsonBody(
	context: NodeContext,
	raw: unknown,
): IDataObject | IDataObject[] | undefined {
	if (raw === undefined || raw === null) {
		return undefined;
	}

	if (typeof raw === 'object') {
		return raw as IDataObject | IDataObject[];
	}

	if (typeof raw !== 'string') {
		throw new NodeOperationError(context.getNode(), 'The JSON body must be a JSON object or array');
	}

	if (raw.trim() === '') {
		return undefined;
	}

	const parsed = jsonParse<unknown>(raw, { fallbackValue: INVALID_JSON });

	if (parsed === INVALID_JSON) {
		throw new NodeOperationError(context.getNode(), 'The JSON body is not valid JSON', {
			description:
				'Check the JSON body for syntax errors such as missing quotes or trailing commas.',
		});
	}

	if (typeof parsed !== 'object' || parsed === null) {
		throw new NodeOperationError(context.getNode(), 'The JSON body must be a JSON object or array');
	}

	return parsed as IDataObject | IDataObject[];
}

/** An HTTP header field name (RFC 9110 `token`). */
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/i;

/**
 * Headers the node sets itself. `Cookie` carries the `B1SESSION`/`ROUTEID`
 * session; the request layer would silently drop a caller's value, so it is
 * rejected up front instead.
 */
const MANAGED_HEADERS = new Set(['cookie']);

/**
 * Resolves the Custom API Call `Headers` option (a `fixedCollection` value,
 * `{ header: [{ name, value }] }`) into request headers. Rows without a name
 * are skipped; an invalid or managed name, a value with line breaks, and a
 * name given twice (in any letter case) are rejected before any request.
 */
export function resolveCustomHeaders(context: NodeContext, raw: unknown): IDataObject | undefined {
	const rows = (raw as { header?: Array<{ name?: unknown; value?: unknown }> } | undefined)?.header;
	const headers: IDataObject = {};
	const seen = new Set<string>();

	for (const row of rows ?? []) {
		const name = typeof row.name === 'string' ? row.name.trim() : '';

		if (name === '') {
			continue;
		}

		if (!HEADER_NAME_PATTERN.test(name)) {
			throw new NodeOperationError(context.getNode(), `"${name}" is not a valid header name`, {
				description: 'Header names may contain letters, digits, and - but no spaces or colons.',
			});
		}

		const key = name.toLowerCase();

		if (MANAGED_HEADERS.has(key)) {
			throw new NodeOperationError(context.getNode(), `The ${name} header is managed by the node`, {
				description: 'The node sends the Service Layer session cookie itself. Remove this header.',
			});
		}

		if (seen.has(key)) {
			throw new NodeOperationError(context.getNode(), `The header "${name}" is set twice`, {
				description: 'Header names are case-insensitive. Keep one entry per header.',
			});
		}

		const value = row.value === undefined || row.value === null ? '' : String(row.value);

		if (/[\r\n\0]/.test(value)) {
			throw new NodeOperationError(
				context.getNode(),
				`The value of header "${name}" contains a line break`,
				{ description: 'Header values must be a single line.' },
			);
		}

		seen.add(key);
		headers[name] = value;
	}

	return seen.size === 0 ? undefined : headers;
}

/** Turns a Service Layer response body into a single output item's JSON. */
export function toCustomApiCallOutput(body: unknown, statusCode: number): IDataObject {
	if (body === undefined || body === null || body === '') {
		return { success: true, statusCode };
	}

	if (typeof body === 'object' && !Array.isArray(body)) {
		return body as IDataObject;
	}

	return { data: body as IDataObject['data'] };
}

export interface CustomApiCallParameters {
	method: string;
	endpoint: unknown;
	jsonBody: unknown;
	/** The `Headers` option's raw `fixedCollection` value. */
	headers: unknown;
}

/**
 * Validates the parameters, then sends the call through the shared
 * authenticated request layer. Validation runs first so a rejected endpoint,
 * body, or header never triggers a login.
 */
export async function executeCustomApiCall(
	this: ServiceLayerCredentialContext,
	parameters: CustomApiCallParameters,
	itemIndex: number,
): Promise<IDataObject> {
	const method = parameters.method.toUpperCase() as CustomApiCallMethod;

	if (!CUSTOM_API_CALL_METHODS.includes(method)) {
		throw new NodeOperationError(this.getNode(), `Unsupported HTTP method "${parameters.method}"`);
	}

	const url = normalizeCustomEndpoint(this, parameters.endpoint);
	const body = CUSTOM_API_CALL_BODY_METHODS.includes(method)
		? parseJsonBody(this, parameters.jsonBody)
		: undefined;
	const headers = resolveCustomHeaders(this, parameters.headers);

	const { credentials, credentialId } = await getServiceLayerCredentials.call(this, itemIndex);
	const response = await serviceLayerApiRequest.call(this, credentials, credentialId, {
		url,
		method: method as IHttpRequestMethods,
		...(body === undefined ? {} : { body }),
		...(headers === undefined ? {} : { headers }),
	});

	return toCustomApiCallOutput(response.body, response.statusCode);
}
