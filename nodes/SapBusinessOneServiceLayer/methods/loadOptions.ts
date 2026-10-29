import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { loadServiceLayerMetadata } from '../helpers/credentials';

/** Populates the Entity Set dropdown from the connected instance's metadata. */
export async function getEntitySets(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const metadata = await loadServiceLayerMetadata.call(this);

	return [...metadata.entities.keys()]
		.sort((a, b) => a.localeCompare(b))
		.map((name) => ({ name, value: name }));
}

/**
 * Populates the Service Operation dropdown with the unbound Actions and
 * Functions from the connected instance's metadata. The kind is part of the
 * label, so there is no separate Action/Function selector; the value is the
 * bare import name the request is sent to.
 */
export async function getServiceOperations(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const metadata = await loadServiceLayerMetadata.call(this);

	return [...metadata.unboundOperations]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((operation) => ({
			name: `${operation.name} (${operation.kind === 'action' ? 'Action' : 'Function'})`,
			value: operation.name,
		}));
}
