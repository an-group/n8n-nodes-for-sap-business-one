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
 * Chain-verification failures whose OpenSSL code names neither CERT, SSL nor
 * TLS, so the pattern above cannot reach them.
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE is by far the common one: the Service Layer
 * presents a leaf certificate whose issuer is not in the trust store and sends
 * no intermediate chain, which is what an openssl-generated certificate does
 * unless the chain is installed alongside it. Every code here is resolved the
 * same way, by trusting the certificate, so they share the one hint.
 */
const TLS_ERROR_CODES = new Set([
	'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
	'INVALID_CA',
	'PATH_LENGTH_EXCEEDED',
	'INVALID_PURPOSE',
]);

/**
 * What actually went wrong, per code, so the hint names the cause rather than
 * describing every certificate failure identically. A code that is recognised
 * as TLS-related but is not listed here falls back to GENERIC_TLS_CAUSE.
 */
const TLS_CAUSE_BY_CODE = new Map<string, string>([
	['CERT_HAS_EXPIRED', 'The TLS certificate of the Service Layer has expired.'],
	[
		'CERT_NOT_YET_VALID',
		'The TLS certificate of the Service Layer is not valid yet, which usually means the clock on one of the two machines is wrong.',
	],
	['CERT_REVOKED', 'The TLS certificate of the Service Layer has been revoked.'],
	['DEPTH_ZERO_SELF_SIGNED_CERT', 'The Service Layer uses a self-signed TLS certificate.'],
	[
		'SELF_SIGNED_CERT_IN_CHAIN',
		'The TLS certificate of the Service Layer is signed by a self-signed authority that this machine does not trust.',
	],
	[
		'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
		'The Service Layer did not send a complete certificate chain, so the issuer of its TLS certificate could not be verified.',
	],
	[
		'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
		'The issuer of the Service Layer TLS certificate is not in this machine trust store.',
	],
	[
		'ERR_TLS_CERT_ALTNAME_INVALID',
		"The TLS certificate of the Service Layer does not cover the host name used in 'Base URL'.",
	],
]);

const GENERIC_TLS_CAUSE = 'The TLS certificate of the Service Layer could not be verified.';

const ALLOW_UNAUTHORIZED_ADVICE =
	"Enable 'Allow Unauthorized Certificates' in the credential to connect anyway — intended for development environments; production should use a certificate this machine trusts.";

/**
 * TLS failures the credential toggle cannot fix, paired with the advice that
 * does apply. ERR_SSL_WRONG_VERSION_NUMBER is the one that matters in practice:
 * the port answered without TLS at all, so skipping certificate validation
 * changes nothing. This advice is shown even when the toggle is already on,
 * because that user is the one still staring at a failure.
 */
const TLS_ADVICE_BY_CODE = new Map<string, string>([
	[
		'ERR_SSL_WRONG_VERSION_NUMBER',
		"The port did not answer with TLS. Check that 'Base URL' uses https and the Service Layer port, commonly 50000. 'Allow Unauthorized Certificates' does not help here.",
	],
]);

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
/**
 * Reads the transport failure code, unwrapping the shapes n8n hands us.
 * `helpers.httpRequest` surfaces the OpenSSL code at the top level, while the
 * legacy `helpers.request` used by credential tests nests the original failure
 * under `cause` or `error`, so a couple of levels are followed.
 */
function getTransportErrorCode(error: unknown): string | undefined {
	let current: unknown = error;

	for (let depth = 0; depth < 3; depth++) {
		if (current === null || typeof current !== 'object') {
			return undefined;
		}

		const candidate = current as { code?: unknown; cause?: unknown; error?: unknown };

		if (typeof candidate.code === 'string') {
			return candidate.code;
		}

		current = candidate.cause ?? candidate.error;
	}

	return undefined;
}

/**
 * The transport code, but only when it is short and token-shaped. Anything
 * else is dropped rather than shown: Node reports some failures as a whole
 * sentence (`connect ECONNREFUSED 10.0.0.5:50000`), which would put the host
 * in front of the user.
 */
function getSafeTransportErrorCode(error: unknown): string | undefined {
	const code = getTransportErrorCode(error);

	return code !== undefined && TRANSPORT_ERROR_CODE_PATTERN.test(code) ? code : undefined;
}

export function sanitizeTransportError(error: unknown, action: string): JsonObject {
	const transportErrorCode = getSafeTransportErrorCode(error);
	const reason = `Could not reach the SAP Business One Service Layer while ${action}`;
	const sanitized: JsonObject = {
		message: transportErrorCode === undefined ? reason : `${reason} (${transportErrorCode})`,
	};

	if (transportErrorCode !== undefined) {
		sanitized.transportErrorCode = transportErrorCode;
	}

	return sanitized;
}

/**
 * True for a certificate-verification failure. The substring pattern carries
 * most of the load — it also covers whatever ERR_TLS_* / ERR_SSL_* codes Node
 * adds later — and the set fills in the codes it cannot match.
 */
function isTlsErrorCode(code: string): boolean {
	return TLS_ERROR_CODE_PATTERN.test(code) || TLS_ERROR_CODES.has(code.toUpperCase());
}

/**
 * Explains a TLS failure: what went wrong, then what to do about it. Never
 * includes a credential value — Base URL is named as a field, not quoted.
 */
function describeTlsFailure(code: string, skipTlsVerification: boolean): string | undefined {
	const specificAdvice = TLS_ADVICE_BY_CODE.get(code);

	if (specificAdvice !== undefined) {
		return specificAdvice;
	}

	if (skipTlsVerification) {
		// The toggle is already on, so the only advice available is spent.
		return undefined;
	}

	return `${TLS_CAUSE_BY_CODE.get(code) ?? GENERIC_TLS_CAUSE} ${ALLOW_UNAUTHORIZED_ADVICE}`;
}

/** Explains a transport failure when a TLS problem is the likely cause. */
export function getTransportErrorDescription(
	error: unknown,
	credentials: ServiceLayerCredentials,
): string | undefined {
	const code = getTransportErrorCode(error);

	if (code === undefined || !isTlsErrorCode(code)) {
		return undefined;
	}

	return describeTlsFailure(code.toUpperCase(), credentials.skipTlsVerification);
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
			skipSslCertificateValidation: credentials.skipTlsVerification,
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
				message: 'The SAP Business One Service Layer rejected the sign-in',
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
