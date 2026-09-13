import type { IDataObject, IN8nHttpFullResponse, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { getSession, storeSession, withSingleFlightLogin } from './sessionStore';
import type {
	ServiceLayerCredentials,
	ServiceLayerRequestContext,
	ServiceLayerSession,
} from './types';

const MILLISECONDS_PER_MINUTE = 60_000;
const TRANSPORT_ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;
const TLS_ERROR_CODE_PATTERN = /CERT|SSL|TLS/i;

/**
 * Only the Service Layer v2 API is supported (see helpers/metadata.ts's version
 * guard) — v1 predates Actions/Functions entirely, which this package's
 * metadata-driven design depends on.
 */
const SERVICE_LAYER_API_PATH = '/b1s/v2';

/**
 * The credential only asks for the Service Layer host and port; the v2 API
 * path is added here so it never needs to be typed (or mistyped) by the user.
 */
export function buildServiceLayerBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, '') + SERVICE_LAYER_API_PATH;
}

/**
 * Response header keys arrive lowercased, but both casings are accepted so this
 * does not depend on the transport normalising them.
 */
export function getSetCookieHeader(headers: IDataObject): unknown {
	return headers['set-cookie'] ?? headers['Set-Cookie'];
}

/** Reads a single cookie value out of a Set-Cookie header, which may be an array. */
export function parseSetCookieValue(setCookie: unknown, name: string): string | undefined {
	const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
	const prefix = `${name}=`;

	for (const cookie of cookies) {
		if (typeof cookie !== 'string') {
			continue;
		}

		for (const part of cookie.split(';')) {
			const trimmed = part.trim();

			if (trimmed.startsWith(prefix)) {
				const value = trimmed.slice(prefix.length);
				return value.length > 0 ? value : undefined;
			}
		}
	}

	return undefined;
}

/** SessionTimeout is reported in minutes. Returns undefined when absent or unusable. */
function parseSessionTimeout(raw: unknown): number | undefined {
	const minutes = typeof raw === 'string' ? Number(raw) : raw;

	if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
		return undefined;
	}

	return minutes;
}

export function extractSapErrorCode(body: unknown): number | undefined {
	const raw = (body as { error?: { code?: unknown } } | null | undefined)?.error?.code;
	const code = typeof raw === 'string' ? Number(raw) : raw;

	if (typeof code !== 'number' || !Number.isFinite(code)) {
		return undefined;
	}

	return code;
}

function extractSapErrorMessage(body: unknown): string | undefined {
	const message = (body as { error?: { message?: unknown } } | null | undefined)?.error?.message;

	if (typeof message === 'string' && message.length > 0) {
		return message;
	}

	const value = (message as { value?: unknown } | null | undefined)?.value;

	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Builds the only object that may be handed to NodeApiError for an HTTP error
 * response. n8n keeps whatever it is given and walks it recursively, so raw
 * responses, request options, and headers must never reach it.
 *
 * The SAP code goes in sapErrorCode on purpose: NodeApiError treats the keys
 * code, status, statusCode, errorCode and error_code as HTTP status candidates,
 * so code: 301 would be reported as a bogus HTTP status.
 */
export function sanitizeServiceLayerError(statusCode: number, body: unknown): JsonObject {
	const sanitized: JsonObject = { statusCode };
	const message = extractSapErrorMessage(body);
	const sapErrorCode = extractSapErrorCode(body);

	if (message !== undefined) {
		sanitized.message = message;
	}

	if (sapErrorCode !== undefined) {
		sanitized.sapErrorCode = sapErrorCode;
	}

	return sanitized;
}

/**
 * ignoreHttpStatusErrors only governs HTTP status handling; DNS, TLS, timeout
 * and connection failures still reject. The thrown error carries the request
 * config, which for /Login includes the password and for other calls includes
 * the session cookie, so only a short transport code is allowed through.
 */
export function sanitizeTransportError(error: unknown, action: string): JsonObject {
	const code = (error as { code?: unknown } | null | undefined)?.code;
	const transportErrorCode =
		typeof code === 'string' && TRANSPORT_ERROR_CODE_PATTERN.test(code) ? code : undefined;
	const reason = `Could not reach the SAP Business One Service Layer while ${action}`;
	const sanitized: JsonObject = {
		message: transportErrorCode === undefined ? reason : `${reason} (${transportErrorCode})`,
	};

	if (transportErrorCode !== undefined) {
		sanitized.transportErrorCode = transportErrorCode;
	}

	return sanitized;
}

/** Points at the credential toggle when a TLS failure is the likely cause. */
export function getTransportErrorDescription(
	error: unknown,
	credentials: ServiceLayerCredentials,
): string | undefined {
	const code = (error as { code?: unknown } | null | undefined)?.code;

	if (
		credentials.ignoreSslIssues ||
		typeof code !== 'string' ||
		!TLS_ERROR_CODE_PATTERN.test(code)
	) {
		return undefined;
	}

	return 'The TLS certificate could not be verified. If the Service Layer uses a self-signed certificate, enable Allow Unauthorized Certificates in the credential.';
}

/**
 * Opens a Service Layer session. Every login consumes a licensed session, so
 * callers should go through ensureSession rather than calling this directly.
 */
async function loginToServiceLayer(
	this: ServiceLayerRequestContext,
	credentials: ServiceLayerCredentials,
): Promise<ServiceLayerSession> {
	let response: IN8nHttpFullResponse;

	try {
		response = (await this.helpers.httpRequest({
			baseURL: buildServiceLayerBaseUrl(credentials.baseUrl),
			url: '/Login',
			method: 'POST',
			body: {
				CompanyDB: credentials.companyDb,
				UserName: credentials.username,
				Password: credentials.password,
			},
			json: true,
			skipSslCertificateValidation: credentials.ignoreSslIssues,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		})) as IN8nHttpFullResponse;
	} catch (error) {
		throw new NodeApiError(this.getNode(), sanitizeTransportError(error, 'signing in'), {
			message: 'Could not connect to the SAP Business One Service Layer',
			description: getTransportErrorDescription(error, credentials),
		});
	}

	if (response.statusCode >= 400) {
		throw new NodeApiError(
			this.getNode(),
			sanitizeServiceLayerError(response.statusCode, response.body),
			{
				message: 'SAP Business One Service Layer authentication failed',
				httpCode: String(response.statusCode),
			},
		);
	}

	const body = response.body as IDataObject | null;
	const setCookie = getSetCookieHeader(response.headers);
	const sessionIdFromBody = body?.SessionId;
	const sessionId =
		typeof sessionIdFromBody === 'string' && sessionIdFromBody.length > 0
			? sessionIdFromBody
			: parseSetCookieValue(setCookie, 'B1SESSION');

	if (sessionId === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			'The SAP Business One Service Layer did not return a session',
			{
				description:
					'The /Login response contained neither a SessionId field nor a B1SESSION cookie.',
			},
		);
	}

	const timeoutMinutes = parseSessionTimeout(body?.SessionTimeout);

	return {
		sessionId,
		routeId: parseSetCookieValue(setCookie, 'ROUTEID'),
		timeoutMs: timeoutMinutes === undefined ? undefined : timeoutMinutes * MILLISECONDS_PER_MINUTE,
		lastUsedAt: Date.now(),
	};
}

/** Reuses a cached session when one is valid, otherwise logs in exactly once. */
export async function ensureSession(
	this: ServiceLayerRequestContext,
	key: string,
	fingerprint: string,
	credentials: ServiceLayerCredentials,
): Promise<ServiceLayerSession> {
	const cached = getSession(key, fingerprint, Date.now());

	if (cached !== undefined) {
		return cached;
	}

	return await withSingleFlightLogin(key, fingerprint, async () => {
		const session = await loginToServiceLayer.call(this, credentials);
		storeSession(key, fingerprint, session);
		return session;
	});
}
