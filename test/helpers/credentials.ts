import type { ServiceLayerCredentials } from '../../nodes/SapBusinessOneServiceLayer/helpers/types';

export interface TestCredentials {
	credentials: ServiceLayerCredentials;
	credentialId: string;
}

let seed = 0;

/**
 * Hands a test a private slice of both process-wide caches.
 *
 * The session cache keys on the credential ID (`getSessionCacheKey` uses `??`,
 * so the ID alone decides the key) and the metadata cache keys on
 * `sha256(baseUrl|companyDb)`. Deriving all three from one counter means a
 * single call isolates a test from every other, without the production modules
 * needing a reset hook.
 *
 * Values are synthetic and deliberately short. `.invalid` is reserved by
 * RFC 6761, so even a request that escaped the fake could not reach a host.
 */
export function createTestCredentials(
	overrides: Partial<ServiceLayerCredentials> = {},
): TestCredentials {
	seed += 1;

	return {
		credentials: {
			baseUrl: `https://sl-test-${seed}.invalid:50000`,
			username: 'tester',
			password: 'pw-abc',
			companyDb: `SBODEMO_${seed}`,
			skipTlsVerification: false,
			...overrides,
		},
		credentialId: `cred-${seed}`,
	};
}
