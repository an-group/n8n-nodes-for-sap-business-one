import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { getServiceLayerMetadata } from '../helpers/metadata';
import type { ServiceLayerCredentials } from '../helpers/types';

/** Populates the Entity Set dropdown from the connected instance's metadata. */
export async function getEntitySets(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const credentials = (await this.getCredentials(
		'sapBusinessOneServiceLayerApi',
	)) as ServiceLayerCredentials;
	const credentialId = this.getNode().credentials?.sapBusinessOneServiceLayerApi?.id;

	const metadata = await getServiceLayerMetadata.call(this, credentials, credentialId);

	return [...metadata.entities.keys()]
		.sort((a, b) => a.localeCompare(b))
		.map((name) => ({ name, value: name }));
}
