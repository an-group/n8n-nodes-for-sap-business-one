import { createHash } from 'node:crypto';

import { NodeOperationError } from 'n8n-workflow';

import { hashDocument, isDueForCheck, startBackgroundCheck } from './backgroundCheck';
import { classifyEdmType } from './odataLiteral';
import { serviceLayerApiRequest } from './request';
import { withSingleFlight } from './singleFlight';
import type {
	BoundOperationDefinition,
	ComplexTypeDefinition,
	EntityDefinition,
	EntityKeyProperty,
	EntityPropertyDefinition,
	EnumMemberDefinition,
	EnumTypeDefinition,
	OperationParameter,
	ServiceLayerCredentials,
	ServiceLayerMetadata,
	ServiceLayerRequestContext,
	UnboundOperationDefinition,
} from './types';

/**
 * Metadata is company-wide, not user-specific, so credentials that differ only
 * by user/password share a cache entry.
 */
function getMetadataCacheKey(credentials: ServiceLayerCredentials): string {
	return createHash('sha256').update(`${credentials.baseUrl}|${credentials.companyDb}`).digest('hex');
}

const METADATA_CACHE_TTL_MS = 60 * 60 * 1000;

interface MetadataCacheEntry {
	metadata: ServiceLayerMetadata;
	/** SHA-256 of the raw document, to tell a changed document from an unchanged one. */
	hash: string;
	/** When the Service Layer last confirmed this document; the one-hour expiry counts from here. */
	fetchedAt: number;
	/** When the editor last started a check, so a failing one is not retried on every call. */
	checkedAt: number;
}

/**
 * Cached per n8n process, same limitation as the session cache
 * (helpers/sessionStore.ts): every worker in queue mode fetches its own copy.
 */
const metadataCache = new Map<string, MetadataCacheEntry>();

/**
 * In-flight metadata fetches, so concurrent requests share a single
 * `/$metadata` call: a workflow run, an editor list waiting for its first load
 * and a background check all join the same one.
 */
const pendingMetadataLoads = new Map<string, Promise<MetadataCacheEntry>>();

/**
 * Only the OData V4 metadata the Service Layer v2 API returns is supported.
 * The older v1 API returns OData V1 metadata with no Action/Function concept
 * at all — entities happen to parse the same way, but every bound/unbound
 * operation would silently come back empty rather than fail loudly.
 */
const SUPPORTED_EDMX_VERSION = '4.0';

/** Reads the `edmx:Edmx` root element's `Version` attribute. */
function getEdmxVersion(xml: string): string | undefined {
	const rootAttributes = /<edmx:Edmx\s+([^>]*?)>/.exec(xml)?.[1];
	return rootAttributes === undefined ? undefined : getAttribute(rootAttributes, 'Version');
}

export function stripNamespace(qualifiedName: string): string {
	const separatorIndex = qualifiedName.lastIndexOf('.');
	return separatorIndex === -1 ? qualifiedName : qualifiedName.slice(separatorIndex + 1);
}

function getAttribute(attributeText: string, name: string): string | undefined {
	return new RegExp(`\\b${name}="([^"]*)"`).exec(attributeText)?.[1];
}

function isNullable(attributeText: string): boolean {
	return getAttribute(attributeText, 'Nullable') !== 'false';
}

interface RawPropertyDefinition {
	name: string;
	edmType: string;
	nullable: boolean;
}

function parseProperties(blockXml: string): RawPropertyDefinition[] {
	const properties: RawPropertyDefinition[] = [];
	const pattern = /<Property\s+([^>]*?)\/>/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(blockXml)) !== null) {
		const attributeText = match[1];
		const name = getAttribute(attributeText, 'Name');
		const edmType = getAttribute(attributeText, 'Type');

		if (name === undefined || edmType === undefined) {
			continue;
		}

		properties.push({
			name,
			edmType,
			nullable: isNullable(attributeText),
		});
	}

	return properties;
}

function parseKeyPropertyNames(blockXml: string): string[] {
	const keyBlock = /<Key>([\s\S]*?)<\/Key>/.exec(blockXml)?.[1];

	if (keyBlock === undefined) {
		return [];
	}

	const names: string[] = [];
	const pattern = /<PropertyRef\s+([^>]*?)\/>/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(keyBlock)) !== null) {
		const name = getAttribute(match[1], 'Name');

		if (name !== undefined) {
			names.push(name);
		}
	}

	return names;
}

function parseParameters(blockXml: string): OperationParameter[] {
	const parameters: OperationParameter[] = [];
	const pattern = /<Parameter\s+([^>]*?)\/>/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(blockXml)) !== null) {
		const attributeText = match[1];
		const name = getAttribute(attributeText, 'Name');
		const edmType = getAttribute(attributeText, 'Type');

		if (name === undefined || edmType === undefined) {
			continue;
		}

		parameters.push({
			name,
			edmType,
			literalKind: classifyEdmType(edmType),
			nullable: isNullable(attributeText),
		});
	}

	return parameters;
}

interface RawOperationDefinition {
	name: string;
	isBound: boolean;
	bindingEntityType?: string;
	parameters: OperationParameter[];
}

/**
 * Parses every bare `<Function>`/`<Action>` definition. Excludes the
 * `*Import` forms (`FunctionImport`/`ActionImport`, parsed separately from the
 * `EntityContainer`) via a negative lookahead on the shared tag-name prefix.
 */
function parseOperationDefinitions(
	xml: string,
	tagName: 'Function' | 'Action',
): RawOperationDefinition[] {
	const definitions: RawOperationDefinition[] = [];
	const pattern = new RegExp(
		`<${tagName}(?!Import)\\s+([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tagName}>)`,
		'g',
	);
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(xml)) !== null) {
		const attributeText = match[1];
		const innerXml = match[2] ?? '';
		const name = getAttribute(attributeText, 'Name');

		if (name === undefined) {
			continue;
		}

		const allParameters = parseParameters(innerXml);
		const isBound = getAttribute(attributeText, 'IsBound') === 'true';
		// The first parameter of a bound operation is the binding parameter
		// (the entity instance itself), not a user-supplied value.
		const bindingEntityType =
			isBound && allParameters.length > 0 ? stripNamespace(allParameters[0].edmType) : undefined;

		definitions.push({
			name,
			isBound,
			bindingEntityType,
			parameters: isBound ? allParameters.slice(1) : allParameters,
		});
	}

	return definitions;
}

/**
 * Parses every `ComplexType`, self-closing or not. A name declared twice keeps
 * its first definition: real Service Layer metadata declares `Event` twice,
 * with identical bodies, so a duplicate is not a structural failure.
 */
function parseComplexTypes(xml: string): Map<string, ComplexTypeDefinition> {
	const complexTypes = new Map<string, ComplexTypeDefinition>();
	const pattern = /<ComplexType\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/ComplexType>)/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(xml)) !== null) {
		const name = getAttribute(match[1], 'Name');

		if (name === undefined || complexTypes.has(name)) {
			continue;
		}

		complexTypes.set(name, { name, properties: parseProperties(match[2] ?? '') });
	}

	return complexTypes;
}

function parseEnumMembers(blockXml: string): EnumMemberDefinition[] {
	const members: EnumMemberDefinition[] = [];
	const pattern = /<Member\s+([^>]*?)\/>/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(blockXml)) !== null) {
		const name = getAttribute(match[1], 'Name');

		if (name !== undefined) {
			members.push({ name, value: getAttribute(match[1], 'Value') ?? '' });
		}
	}

	return members;
}

/**
 * Parses every `EnumType` with its members in declaration order. A name
 * declared twice keeps its first definition, as for `ComplexType`.
 */
function parseEnumTypes(xml: string): Map<string, EnumTypeDefinition> {
	const enumTypes = new Map<string, EnumTypeDefinition>();
	const pattern = /<EnumType\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/EnumType>)/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(xml)) !== null) {
		const name = getAttribute(match[1], 'Name');

		if (name === undefined || enumTypes.has(name)) {
			continue;
		}

		enumTypes.set(name, {
			name,
			isFlags: getAttribute(match[1], 'IsFlags') === 'true',
			members: parseEnumMembers(match[2] ?? ''),
		});
	}

	return enumTypes;
}

interface RawImportDefinition {
	name: string;
	/** Unqualified name of the `Function`/`Action` it imports. */
	targetName: string;
}

function parseImportDefinitions(
	containerXml: string,
	tagName: 'FunctionImport' | 'ActionImport',
	targetAttribute: 'Function' | 'Action',
): RawImportDefinition[] {
	const imports: RawImportDefinition[] = [];
	const pattern = new RegExp(`<${tagName}\\s+([^>]*?)\\/?>`, 'g');
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(containerXml)) !== null) {
		const attributeText = match[1];
		const name = getAttribute(attributeText, 'Name');
		const target = getAttribute(attributeText, targetAttribute);

		if (name === undefined || target === undefined) {
			continue;
		}

		imports.push({ name, targetName: stripNamespace(target) });
	}

	return imports;
}

/**
 * Regex-based EDMX parser — no XML library, keeping the package
 * dependency-free and eligible for n8n Cloud. Deliberately has no `this`
 * context: it never needs to construct a node-aware error, so it stays a pure
 * function callers can also exercise offline against a captured `/$metadata`
 * response. Throws a plain `Error` on structural failure; `getServiceLayerMetadata`
 * (below) is the boundary that turns that into a `NodeOperationError`.
 */
export function parseMetadataXml(xml: string): ServiceLayerMetadata {
	const containerXml = /<EntityContainer\b[^>]*>([\s\S]*?)<\/EntityContainer>/.exec(xml)?.[1] ?? '';

	const entityTypesByName = new Map<
		string,
		{ keys: EntityKeyProperty[]; properties: EntityPropertyDefinition[] }
	>();
	const entityTypePattern = /<EntityType\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/EntityType>)/g;
	let entityTypeMatch: RegExpExecArray | null;

	while ((entityTypeMatch = entityTypePattern.exec(xml)) !== null) {
		const typeName = getAttribute(entityTypeMatch[1], 'Name');

		if (typeName === undefined) {
			continue;
		}

		const blockXml = entityTypeMatch[2] ?? '';
		const rawProperties = parseProperties(blockXml);
		const propertiesByName = new Map(rawProperties.map((property) => [property.name, property]));
		const keys: EntityKeyProperty[] = parseKeyPropertyNames(blockXml)
			.map((keyName) => propertiesByName.get(keyName))
			.filter((property): property is RawPropertyDefinition => property !== undefined)
			.map((property) => ({
				name: property.name,
				edmType: property.edmType,
				literalKind: classifyEdmType(property.edmType),
			}));

		entityTypesByName.set(typeName, { keys, properties: rawProperties });
	}

	const boundFunctionsByType = new Map<string, BoundOperationDefinition[]>();
	const boundActionsByType = new Map<string, BoundOperationDefinition[]>();
	const unboundFunctionParamsByName = new Map<string, OperationParameter[]>();
	const unboundActionParamsByName = new Map<string, OperationParameter[]>();

	const operationSources: Array<
		[
			'Function' | 'Action',
			'function' | 'action',
			Map<string, BoundOperationDefinition[]>,
			Map<string, OperationParameter[]>,
		]
	> = [
		['Function', 'function', boundFunctionsByType, unboundFunctionParamsByName],
		['Action', 'action', boundActionsByType, unboundActionParamsByName],
	];

	for (const [tagName, kind, boundMap, unboundMap] of operationSources) {
		for (const definition of parseOperationDefinitions(xml, tagName)) {
			if (definition.isBound && definition.bindingEntityType !== undefined) {
				const list = boundMap.get(definition.bindingEntityType) ?? [];
				list.push({
					name: definition.name,
					kind,
					bindingEntityType: definition.bindingEntityType,
					parameters: definition.parameters,
				});
				boundMap.set(definition.bindingEntityType, list);
			} else if (!definition.isBound) {
				unboundMap.set(definition.name, definition.parameters);
			}
		}
	}

	const entities = new Map<string, EntityDefinition>();
	const entitySetPattern = /<EntitySet\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/EntitySet>)/g;
	let entitySetMatch: RegExpExecArray | null;

	while ((entitySetMatch = entitySetPattern.exec(containerXml)) !== null) {
		const attributeText = entitySetMatch[1];
		const entitySetName = getAttribute(attributeText, 'Name');
		const qualifiedEntityType = getAttribute(attributeText, 'EntityType');

		if (entitySetName === undefined || qualifiedEntityType === undefined) {
			continue;
		}

		const entityTypeName = stripNamespace(qualifiedEntityType);
		const entityType = entityTypesByName.get(entityTypeName);

		if (entityType === undefined) {
			throw new Error(
				`Entity set "${entitySetName}" references an entity type that was not found in the metadata`,
			);
		}

		entities.set(entitySetName, {
			entitySetName,
			entityTypeName,
			keys: entityType.keys,
			properties: entityType.properties,
			boundActions: boundActionsByType.get(entityTypeName) ?? [],
			boundFunctions: boundFunctionsByType.get(entityTypeName) ?? [],
		});
	}

	const unboundOperations: UnboundOperationDefinition[] = [
		...parseImportDefinitions(containerXml, 'FunctionImport', 'Function').map((imp) => ({
			name: imp.name,
			kind: 'function' as const,
			parameters: unboundFunctionParamsByName.get(imp.targetName) ?? [],
		})),
		...parseImportDefinitions(containerXml, 'ActionImport', 'Action').map((imp) => ({
			name: imp.name,
			kind: 'action' as const,
			parameters: unboundActionParamsByName.get(imp.targetName) ?? [],
		})),
	];

	return {
		entities,
		unboundOperations,
		complexTypes: parseComplexTypes(xml),
		enumTypes: parseEnumTypes(xml),
		entityTypes: new Map(
			[...entityTypesByName].map(([name, { properties }]) => [name, { name, properties }]),
		),
	};
}

/**
 * Fetches `/$metadata` through the existing authenticated request layer — no
 * separate authentication, retry, or session logic. Session reuse and
 * expiry-retry are already handled by `serviceLayerApiRequest`.
 */
async function fetchMetadataXml(
	this: ServiceLayerRequestContext,
	credentials: ServiceLayerCredentials,
	credentialId: string | null | undefined,
): Promise<string> {
	const { body } = await serviceLayerApiRequest.call(this, credentials, credentialId, {
		url: '/$metadata',
		method: 'GET',
		json: false,
	});

	return body as string;
}

/**
 * Validates and parses a freshly downloaded document. Throws a
 * `NodeOperationError` that never echoes the document.
 */
function parseMetadataDocument(this: ServiceLayerRequestContext, xml: string): ServiceLayerMetadata {
	const edmxVersion = getEdmxVersion(xml);

	if (edmxVersion !== SUPPORTED_EDMX_VERSION) {
		throw new NodeOperationError(this.getNode(), 'Unsupported Service Layer metadata version', {
			description:
				'Only the Service Layer v2 API (OData V4 metadata) is supported. ' +
				`Detected metadata version "${edmxVersion ?? 'unknown'}" — check that the ` +
				'connected instance exposes the v2 API.',
		});
	}

	try {
		return parseMetadataXml(xml);
	} catch {
		// Never surface the raw XML (customer-specific schema, and 1.6 MB+ in
		// practice) or the underlying parse error's message.
		throw new NodeOperationError(this.getNode(), 'Could not parse Service Layer metadata', {
			description:
				"The /$metadata response is not a readable OData metadata document. Check that the credential's 'Base URL' points to the Service Layer itself, not to a proxy or web server in front of it, then run the node again.",
		});
	}
}

/**
 * Downloads `/$metadata` once per key and stores it. A document whose hash
 * matches the cached one is not parsed again: only its timestamps are renewed.
 */
async function loadMetadata(
	this: ServiceLayerRequestContext,
	credentials: ServiceLayerCredentials,
	credentialId: string | null | undefined,
	cacheKey: string,
): Promise<MetadataCacheEntry> {
	return await withSingleFlight(pendingMetadataLoads, cacheKey, async () => {
		const xml = await fetchMetadataXml.call(this, credentials, credentialId);
		const hash = hashDocument(xml);
		const cached = metadataCache.get(cacheKey);
		const metadata =
			cached !== undefined && cached.hash === hash
				? cached.metadata
				: parseMetadataDocument.call(this, xml);
		const now = Date.now();
		const entry = { metadata, hash, fetchedAt: now, checkedAt: now };

		metadataCache.set(cacheKey, entry);

		return entry;
	});
}

/**
 * For running a workflow: returns cached metadata younger than an hour,
 * otherwise loads it and waits. Never starts a background check, but reads the
 * cache the editor keeps fresh.
 */
export async function getServiceLayerMetadata(
	this: ServiceLayerRequestContext,
	credentials: ServiceLayerCredentials,
	credentialId: string | null | undefined,
): Promise<ServiceLayerMetadata> {
	const cacheKey = getMetadataCacheKey(credentials);
	const cached = metadataCache.get(cacheKey);

	if (cached !== undefined && Date.now() - cached.fetchedAt <= METADATA_CACHE_TTL_MS) {
		return cached.metadata;
	}

	return (await loadMetadata.call(this, credentials, credentialId, cacheKey)).metadata;
}

/**
 * For the editor's lists: answers from the cache at once, whatever its age,
 * and checks in the background whether the document changed once the last
 * check is older than two minutes, so new fields and tables appear on the next
 * refresh. Only the first load, with nothing cached, is waited for. A failing
 * check keeps the cached metadata and shows no error.
 */
export async function getServiceLayerMetadataForEditor(
	this: ServiceLayerRequestContext,
	credentials: ServiceLayerCredentials,
	credentialId: string | null | undefined,
): Promise<ServiceLayerMetadata> {
	const cacheKey = getMetadataCacheKey(credentials);
	const cached = metadataCache.get(cacheKey);

	if (cached === undefined) {
		return (await loadMetadata.call(this, credentials, credentialId, cacheKey)).metadata;
	}

	if (isDueForCheck(cached.checkedAt)) {
		cached.checkedAt = Date.now();
		startBackgroundCheck(loadMetadata.call(this, credentials, credentialId, cacheKey));
	}

	return cached.metadata;
}
