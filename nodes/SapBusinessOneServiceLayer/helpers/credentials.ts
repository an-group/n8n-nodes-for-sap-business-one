import { getEntitySetLabels, getPropertyLabels, type LabelMap } from './labels';
import { getServiceLayerMetadataForEditor } from './metadata';
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

/**
 * Resolves the credentials and returns the connected instance's cached
 * metadata for the editor's lists, checked in the background for changes
 * (see getServiceLayerMetadataForEditor). Running a workflow reads the
 * metadata through getServiceLayerMetadata instead.
 */
export async function loadServiceLayerMetadata(
	this: ServiceLayerCredentialContext,
): Promise<ServiceLayerMetadata> {
	const { credentials, credentialId } = await getServiceLayerCredentials.call(this);

	return await getServiceLayerMetadataForEditor.call(this, credentials, credentialId);
}

/**
 * Resolves the credentials and returns the cached entity set labels. Only the
 * editor's lists call this; `execute()` never needs a label. Never rejects for
 * a failed label request (see helpers/labels.ts).
 */
export async function loadEntitySetLabels(this: ServiceLayerCredentialContext): Promise<LabelMap> {
	const { credentials, credentialId } = await getServiceLayerCredentials.call(this);

	return await getEntitySetLabels.call(this, credentials, credentialId);
}

/**
 * Resolves the credentials and returns the cached property labels of one
 * entity set, for the editor's field lists and resource mapper.
 */
export async function loadPropertyLabels(
	this: ServiceLayerCredentialContext,
	entitySetName: string,
): Promise<LabelMap> {
	const { credentials, credentialId } = await getServiceLayerCredentials.call(this);

	return await getPropertyLabels.call(this, credentials, credentialId, entitySetName);
}
