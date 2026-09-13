import { getServiceLayerMetadata } from './metadata';
import type {
	ServiceLayerCredentialContext,
	ServiceLayerCredentials,
	ServiceLayerMetadata,
} from './types';

/** Credential type name, shared by the node's declaration and every lookup. */
export const SERVICE_LAYER_CREDENTIAL_NAME = 'sapBusinessOneServiceLayerApi';

/**
 * Resolves the node's credentials together with the n8n credential ID the
 * session cache is keyed by.
 *
 * `itemIndex` is forwarded to `getCredentials` so credential fields containing
 * expressions resolve against the item being processed; omit it outside
 * `execute()`, where there is no item.
 */
export async function getServiceLayerCredentials(
	this: ServiceLayerCredentialContext,
	itemIndex?: number,
): Promise<{ credentials: ServiceLayerCredentials; credentialId: string | null | undefined }> {
	const credentials = await this.getCredentials<ServiceLayerCredentials>(
		SERVICE_LAYER_CREDENTIAL_NAME,
		itemIndex,
	);

	return {
		credentials,
		credentialId: this.getNode().credentials?.[SERVICE_LAYER_CREDENTIAL_NAME]?.id,
	};
}

/** Resolves the credentials and returns the connected instance's cached metadata. */
export async function loadServiceLayerMetadata(
	this: ServiceLayerCredentialContext,
	itemIndex?: number,
): Promise<ServiceLayerMetadata> {
	const { credentials, credentialId } = await getServiceLayerCredentials.call(this, itemIndex);

	return await getServiceLayerMetadata.call(this, credentials, credentialId);
}
