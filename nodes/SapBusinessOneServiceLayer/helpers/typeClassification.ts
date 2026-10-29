import { stripNamespace } from './metadata';
import type { ServiceLayerMetadata, ServiceLayerTypeInfo } from './types';

type TypeRegistry = Pick<ServiceLayerMetadata, 'complexTypes' | 'enumTypeNames' | 'entityTypeNames'>;

const COLLECTION_PATTERN = /^Collection\((.*)\)$/;

/**
 * Classifies a property or parameter type reference against the parsed
 * metadata. Unlike `classifyEdmType` (helpers/odataLiteral.ts), which only
 * answers how a value is quoted in a URL, this tells primitive, enum, complex
 * and entity types apart.
 *
 * Non-`Edm.*` names are looked up without their namespace, the same way the
 * parser stores them; the Service Layer declares a single `SAPB1` schema. A
 * name the metadata does not declare is `unknown` rather than an error.
 */
export function classifyServiceLayerType(
	edmType: string,
	metadata: TypeRegistry,
): ServiceLayerTypeInfo {
	const collectionElement = COLLECTION_PATTERN.exec(edmType)?.[1];
	const isCollection = collectionElement !== undefined;
	const elementType = collectionElement ?? edmType;

	if (elementType.startsWith('Edm.')) {
		return { category: 'primitive', isCollection, typeName: elementType };
	}

	const typeName = stripNamespace(elementType);

	// A leftover parenthesis is a malformed wrapper such as `Collection(X`;
	// stripping the namespace alone would resolve it to `X`.
	if (/[()]/.test(elementType)) {
		return { category: 'unknown', isCollection, typeName };
	}

	if (metadata.enumTypeNames.has(typeName)) {
		return { category: 'enum', isCollection, typeName };
	}

	if (metadata.complexTypes.has(typeName)) {
		return { category: 'complex', isCollection, typeName };
	}

	if (metadata.entityTypeNames.has(typeName)) {
		return { category: 'entity', isCollection, typeName };
	}

	return { category: 'unknown', isCollection, typeName };
}
