import type {
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
} from 'n8n-workflow';

import { loadServiceLayerMetadata } from '../helpers/credentials';
import { getSelectedEntitySetName } from '../helpers/locator';

/**
 * Fills the `From list` mode of the Entity Set locator from the connected
 * instance's metadata. The metadata is cached per credential, so a search
 * filters the cached list and sends no request of its own.
 */
export async function searchEntitySets(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const metadata = await loadServiceLayerMetadata.call(this);

	const results = [...metadata.entities.keys()]
		.sort((a, b) => a.localeCompare(b))
		.map((name) => ({ name, value: name }));

	return { results: filterResults(results, filter) };
}

/**
 * Fills the `From list` mode of the Service Operation locator with the
 * unbound Actions and Functions from the connected instance's metadata. The
 * kind is part of the label, so there is no separate Action/Function
 * selector; the value is the bare import name the request is sent to.
 */
export async function searchServiceOperations(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const metadata = await loadServiceLayerMetadata.call(this);

	return { results: filterResults(toOperationResults(metadata.unboundOperations), filter) };
}

/**
 * Fills the `From list` mode of the Action or Function locator with the
 * operations bound to the selected entity set's entity type. Names such as
 * `Close` are shared by many types; resolving through the entity set keeps
 * only the selected type's own.
 */
export async function searchBoundOperations(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const entitySetName = getSelectedEntitySetName(this);

	if (!entitySetName) {
		return { results: [] };
	}

	const metadata = await loadServiceLayerMetadata.call(this);
	const entity = metadata.entities.get(entitySetName);

	if (entity === undefined) {
		return { results: [] };
	}

	return {
		results: filterResults(
			toOperationResults([...entity.boundActions, ...entity.boundFunctions]),
			filter,
		),
	};
}

/** Keeps the entries whose label contains the search text, ignoring case. */
function filterResults(results: INodeListSearchItems[], filter?: string): INodeListSearchItems[] {
	const needle = filter?.trim().toLowerCase();

	if (!needle) {
		return results;
	}

	return results.filter((result) => result.name.toLowerCase().includes(needle));
}

function toOperationResults(
	operations: Array<{ name: string; kind: 'action' | 'function' }>,
): INodeListSearchItems[] {
	return [...operations]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((operation) => ({
			name: `${operation.name} (${operation.kind === 'action' ? 'Action' : 'Function'})`,
			value: operation.name,
		}));
}
