import type { IDataObject, IHttpRequestOptions, IN8nHttpFullResponse } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import {
	buildServiceLayerBaseUrl,
	ensureSession,
	extractSapErrorCode,
	getSetCookieHeader,
	getTransportErrorDescription,
	parseSetCookieValue,
	sanitizeServiceLayerError,
	sanitizeTransportError,
} from './session';
import {
	getCredentialFingerprint,
	getSessionCacheKey,
	invalidateSession,
	touchSession,
} from './sessionStore';
import type {
	ServiceLayerCredentials,
	ServiceLayerRequestContext,
	ServiceLayerResponse,
	ServiceLayerSession,
} from './types';

/**
 * Request options a caller may supply. Transport and authentication concerns are
 * owned here, so the credential TLS setting and the error handling cannot be
 * bypassed from the outside.
 */
export type ServiceLayerRequestOptions = Omit<
	IHttpRequestOptions,
	'baseURL' | 'skipSslCertificateValidation' | 'returnFullResponse' | 'ignoreHttpStatusErrors'
>;

/**
 * SAP error codes that mean the session is gone. Kept as a list so further codes
 * can be added once observed against a real Service Layer.
 */
const SESSION_INVALID_ERROR_CODES = [301];

/**
 * A 401 counts as an expired session when it carries the known invalid-session
 * code, or no parseable SAP code at all. A 401 carrying a different, known code
 * is a real authorisation failure and must not trigger a redundant login.
 */
export function isSessionExpiredResponse(statusCode: number, body: unknown): boolean {
	if (statusCode !== 401) {
		return false;
	}

	const code = extractSapErrorCode(body);

	return code === undefined || SESSION_INVALID_ERROR_CODES.includes(code);
}

/**
 * Caller headers never reach the wire under a cookie key. Outbound header names
 * are not normalised by the transport, so a caller-supplied lowercase cookie
 * would add a second Cookie header rather than replace ours.
 */
export function buildAuthenticatedHeaders(
	callerHeaders: IDataObject | undefined,
	session: ServiceLayerSession,
): IDataObject {
	const headers: IDataObject = {};

	for (const [name, value] of Object.entries(callerHeaders ?? {})) {
		if (name.toLowerCase() === 'cookie') {
			continue;
		}

		headers[name] = value;
	}

	const cookies = [`B1SESSION=${session.sessionId}`];

	if (session.routeId !== undefined) {
		cookies.push(`ROUTEID=${session.routeId}`);
	}

	headers.Cookie = cookies.join('; ');

	return headers;
}

async function sendWithSession(
	this: ServiceLayerRequestContext,
	credentials: ServiceLayerCredentials,
	session: ServiceLayerSession,
	options: ServiceLayerRequestOptions,
): Promise<IN8nHttpFullResponse> {
	try {
		return (await this.helpers.httpRequest({
			...options,
			baseURL: buildServiceLayerBaseUrl(credentials.baseUrl),
			headers: buildAuthenticatedHeaders(options.headers, session),
			skipSslCertificateValidation: credentials.ignoreSslIssues,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		})) as IN8nHttpFullResponse;
	} catch (error) {
		throw new NodeApiError(
			this.getNode(),
			sanitizeTransportError(error, 'calling the Service Layer'),
			{
				message: 'Could not connect to the SAP Business One Service Layer',
				description: getTransportErrorDescription(error, credentials),
			},
		);
	}
}

/**
 * Sends an authenticated Service Layer request, reusing the cached session and
 * recovering from an expired one with a single re-login and retry.
 *
 * The credential ID comes from this.getNode().credentials?.<type>?.id and keeps
 * the cache keyed to the credential rather than to its current values.
 */
export async function serviceLayerApiRequest<T = unknown>(
	this: ServiceLayerRequestContext,
	credentials: ServiceLayerCredentials,
	credentialId: string | null | undefined,
	options: ServiceLayerRequestOptions,
): Promise<ServiceLayerResponse<T>> {
	const fingerprint = getCredentialFingerprint(credentials);
	const key = getSessionCacheKey(credentialId, fingerprint);

	let session = await ensureSession.call(this, key, fingerprint, credentials);
	let response = await sendWithSession.call(this, credentials, session, options);

	if (isSessionExpiredResponse(response.statusCode, response.body)) {
		invalidateSession(key, session);
		session = await ensureSession.call(this, key, fingerprint, credentials);
		response = await sendWithSession.call(this, credentials, session, options);

		// The replacement session was rejected as well. Drop it instead of handing
		// a session the server refuses to the next request.
		if (isSessionExpiredResponse(response.statusCode, response.body)) {
			invalidateSession(key, session);
		}
	}

	if (response.statusCode >= 400) {
		throw new NodeApiError(
			this.getNode(),
			sanitizeServiceLayerError(response.statusCode, response.body),
			{
				message: 'The SAP Business One Service Layer returned an error',
				httpCode: String(response.statusCode),
			},
		);
	}

	const routeId = parseSetCookieValue(getSetCookieHeader(response.headers), 'ROUTEID');

	if (routeId !== undefined) {
		session.routeId = routeId;
	}

	touchSession(session, Date.now());

	return { body: response.body as T, statusCode: response.statusCode };
}
