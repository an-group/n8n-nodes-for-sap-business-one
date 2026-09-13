import type { FunctionsBase } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { encodeODataLiteral } from './odataLiteral';
import type { EntityDefinition } from './types';

/** True when a key value is genuinely unset — `0` and `false` are legitimate values, not missing. */
function isUnset(value: unknown): boolean {
	return value === undefined || value === null || value === '';
}

/**
 * Builds the OData key segment for an entity (`Orders(45)`,
 * `SalesTaxAuthorities(Type=-3,Code='AK')`) from the `Key Fields` resource
 * mapper's resolved values, validating them against the entity's
 * metadata-resolved key list first so a mismatch is reported before any
 * request is sent, not as a raw Service Layer error.
 *
 * A field declared `type: 'number'` in the resource mapper is stored as a
 * real JS number rather than a string; `String(value)` here is a plain
 * stringify, not a re-classification — the literal's quoting is already
 * decided independently by each key's `literalKind`.
 */
export function buildEntityKeySegment(
	context: Pick<FunctionsBase, 'getNode'>,
	entity: EntityDefinition,
	keyValues: Record<string, unknown>,
): string {
	const missingKeys = entity.keys.filter((key) => isUnset(keyValues[key.name]));

	if (missingKeys.length > 0) {
		const missingNames = missingKeys.map((key) => key.name).join(', ');

		throw new NodeOperationError(
			context.getNode(),
			`Key ${missingKeys.length === 1 ? 'field' : 'fields'} ${missingNames} ${
				missingKeys.length === 1 ? 'has' : 'have'
			} no value`,
			{
				description: `"${entity.entitySetName}" is identified by ${entity.keys
					.map((key) => key.name)
					.join(', ')}. Every key field needs a value.`,
			},
		);
	}

	const encodedSegment = entity.keys
		.map((key) => {
			const encodedValue = encodeODataLiteral(String(keyValues[key.name]), key.literalKind);

			return entity.keys.length === 1 ? encodedValue : `${key.name}=${encodedValue}`;
		})
		.join(',');

	return `${entity.entitySetName}(${encodedSegment})`;
}
