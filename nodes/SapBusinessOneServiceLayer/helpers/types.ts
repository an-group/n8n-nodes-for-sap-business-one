/**
 * Decrypted shape of the `sapBusinessOneServiceLayerApi` credential.
 */
export interface ServiceLayerCredentials {
	baseUrl: string;
	username: string;
	password: string;
	companyDb: string;
	ignoreSslIssues: boolean;
}

/**
 * A Service Layer session held in memory for the lifetime of the n8n process.
 *
 * Never serialise this into node output, logs, or errors: `sessionId` and
 * `routeId` are authentication material.
 */
export interface ServiceLayerSession {
	/** `B1SESSION` value. */
	sessionId: string;
	/** `ROUTEID` value, only set when the Service Layer returns one. */
	routeId?: string;
	/**
	 * Idle timeout in milliseconds, derived from the server's `SessionTimeout`.
	 * Undefined when the server did not report one, in which case the session is
	 * never expired proactively and is only dropped once SAP rejects it.
	 */
	timeoutMs?: number;
	/** Epoch ms of the last successful use. Refreshed after every successful request. */
	lastUsedAt: number;
}

/**
 * Cache entry pairing a session with a fingerprint of the credential values it
 * was created from, so an edited credential replaces its session instead of
 * silently reusing a session that belongs to different values.
 */
export interface SessionCacheEntry {
	fingerprint: string;
	session: ServiceLayerSession;
}

/**
 * Narrowed Service Layer response. Response headers are deliberately not
 * exposed: they carry `set-cookie`, and at runtime they are an `AxiosHeaders`
 * instance rather than a plain object.
 */
export interface ServiceLayerResponse<T = unknown> {
	body: T;
	statusCode: number;
}
