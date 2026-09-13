import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { loadServiceLayerMetadata } from '../helpers/credentials';

/** Populates the Entity Set dropdown from the connected instance's metadata. */
export async function getEntitySets(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const metadata = await loadServiceLayerMetadata.call(this);

	return [...metadata.entities.keys()]
		.sort((a, b) => a.localeCompare(b))
		.map((name) => ({ name, value: name }));
}
