import { createHash } from 'node:crypto';

import { serviceLayerApiRequest } from './request';
import { withSingleFlight } from './singleFlight';
import type { ServiceLayerCredentials, ServiceLayerRequestContext } from './types';

/**
 * SAP labels keyed by technical name: entity set name, or property name of one
 * entity set. A name without a label is absent.
 */
export type LabelMap = ReadonlyMap<string, string>;

const NO_LABELS: LabelMap = new Map();

/**
 * The language the labels are read in. The node sends no `Language` at login,
 * so the Service Layer picks it; a language choice in the credential would
 * replace this value and, with it, the cache key.
 */
const DEFAULT_LABEL_LANGUAGE = 'default';

/** Same lifetime as the cached `/$metadata` (helpers/metadata.ts). */
const LABEL_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Only the entity container with one label per entity set, tens of KB instead
 * of the megabytes of the full document. `annotation=label` alone carries no
 * table prefix, so a label is never split: a real one reads
 * "Object: HR Employee Transfer".
 */
const ENTITY_SET_LABELS_URL = '/$metadata?scope=entityset&annotation=label';

/**
 * One entity set with the labels of its properties. Labels belong to the
 * entity set, not to its entity type: SAP labels a property for the form it
 * appears on, and entity sets sharing a type are labelled differently.
 *
 * `annotation=label` rather than `labelWithField`: verified on Service Layer
 * 1000291 and 1000340 to give the same property labels, without the column
 * name older versions put in front of each one (`CardCode:BP Code`), so a
 * label is never split here either.
 */
function getPropertyLabelsUrl(entitySetName: string): string {
	return `/$metadata?scope=entityset&entityset=${encodeURIComponent(entitySetName)}&annotation=label`;
}

interface LabelCacheEntry {
	labels: LabelMap;
	fetchedAt: number;
}

/**
 * Cached per n8n process, like the metadata. Only an answer of the server is
 * cached: a failed login, an unreachable server or an error status is not, so
 * the labels are back the next time a list is opened instead of an hour later.
 */
const labelCache = new Map<string, LabelCacheEntry>();

const pendingLabelLoads = new Map<string, Promise<LabelMap>>();

/**
 * Labels are company-wide, like the metadata, and depend on the login
 * language. `scope` keeps entity set labels and one entity set's property
 * labels apart.
 */
function getLabelCacheKey(credentials: ServiceLayerCredentials, scope: string): string {
	return createHash('sha256')
		.update(
			JSON.stringify([credentials.baseUrl, credentials.companyDb, DEFAULT_LABEL_LANGUAGE, scope]),
		)
		.digest('hex');
}

const XML_ENTITIES: Record<string, string> = {
	amp: '&',
	apos: "'",
	gt: '>',
	lt: '<',
	quot: '"',
};

function decodeXmlText(text: string): string {
	return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (entity, body: string) => {
		if (body.startsWith('#x')) {
			return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
		}

		if (body.startsWith('#')) {
			return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
		}

		return XML_ENTITIES[body] ?? entity;
	});
}

/** Attribute values of one start tag, decoded, keyed by attribute name. */
function parseAttributes(attributeText: string): Map<string, string> {
	const attributes = new Map<string, string>();

	for (const match of attributeText.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
		attributes.set(match[1], decodeXmlText(match[2]));
	}

	return attributes;
}

interface ParsedElement {
	attributes: Map<string, string>;
	innerXml: string;
}

/**
 * Every `<tagName ...>` element, self-closing or not. The start tag is matched
 * attribute by attribute, so a `>` inside a quoted value cannot end it early,
 * and attribute order does not matter: the Service Layer writes `EntityType`
 * before `Name`.
 */
function parseElements(xml: string, tagName: string): ParsedElement[] {
	const pattern = new RegExp(
		`<${tagName}((?:\\s+[\\w:.-]+\\s*=\\s*"[^"]*")*)\\s*(?:\\/>|>([\\s\\S]*?)<\\/${tagName}>)`,
		'g',
	);

	return [...xml.matchAll(pattern)].map((match) => ({
		attributes: parseAttributes(match[1]),
		innerXml: match[2] ?? '',
	}));
}

/** Treats whitespace-only text as no label at all. */
function normalizeLabel(value: string | undefined): string | undefined {
	const trimmed = value?.trim();

	return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/**
 * The label in the format FP2608 and later write: a child
 * `<Annotation Term="Common.Label" String="..."/>`. Read before the older
 * attribute, should a document ever carry both.
 */
function getAnnotationLabel(innerXml: string): string | undefined {
	for (const annotation of parseElements(innerXml, 'Annotation')) {
		const term = annotation.attributes.get('Term') ?? '';

		if (term === 'Common.Label' || term.endsWith('.Common.v1.Label')) {
			return normalizeLabel(annotation.attributes.get('String'));
		}
	}

	return undefined;
}

/**
 * Reads the entity set labels of a `scope=entityset&annotation=label`
 * document. The format is detected per element, never from a version number:
 * the label is a `Common.Label` annotation (FP2608 and later) or an
 * `sap:label` attribute (older versions). Entity sets outside the entity
 * container, and ones without a label, are left out.
 */
export function parseEntitySetLabels(xml: string): LabelMap {
	const containerXml = /<EntityContainer\b[^>]*>([\s\S]*?)<\/EntityContainer>/.exec(xml)?.[1] ?? '';
	const labels = new Map<string, string>();

	for (const entitySet of parseElements(containerXml, 'EntitySet')) {
		const name = entitySet.attributes.get('Name');
		const label =
			getAnnotationLabel(entitySet.innerXml) ??
			normalizeLabel(entitySet.attributes.get('sap:label'));

		if (name !== undefined && label !== undefined && !labels.has(name)) {
			labels.set(name, label);
		}
	}

	return labels;
}

/**
 * Reads the property labels of one entity set from a
 * `scope=entityset&entityset=<name>&annotation=label` document, in either
 * format (see `parseEntitySetLabels`). Like an entity set label, a property
 * label is never split: it can contain a colon of its own.
 */
export function parsePropertyLabels(xml: string): LabelMap {
	const labels = new Map<string, string>();

	for (const entityType of parseElements(xml, 'EntityType')) {
		for (const property of parseElements(entityType.innerXml, 'Property')) {
			const name = property.attributes.get('Name');
			const label =
				getAnnotationLabel(property.innerXml) ??
				normalizeLabel(property.attributes.get('sap:label'));

			if (name !== undefined && label !== undefined && !labels.has(name)) {
				labels.set(name, label);
			}
		}
	}

	return labels;
}

/**
 * The text a list shows for a technical name: `Label (Name)`, or the name alone
 * when there is no label or the label is exactly the name. The value a list
 * stores is always the technical name, never this text.
 */
export function formatLabel(name: string, labels: LabelMap): string {
	const label = labels.get(name);

	return label === undefined || label === name ? name : `${label} (${name})`;
}

/**
 * Fetches one label document and parses it, or returns `undefined` when the
 * request fails or the answer is not text. Labels only help to find a name, so
 * a list must never fail for want of them; the caller shows none instead.
 */
async function fetchLabels(
	this: ServiceLayerRequestContext,
	credentials: ServiceLayerCredentials,
	credentialId: string | null | undefined,
	url: string,
	parse: (xml: string) => LabelMap,
): Promise<LabelMap | undefined> {
	try {
		const { body } = await serviceLayerApiRequest.call(this, credentials, credentialId, {
			url,
			method: 'GET',
			json: false,
		});

		return typeof body === 'string' ? parse(body) : undefined;
	} catch {
		return undefined;
	}
}

async function getCachedLabels(
	this: ServiceLayerRequestContext,
	credentials: ServiceLayerCredentials,
	credentialId: string | null | undefined,
	scope: string,
	url: string,
	parse: (xml: string) => LabelMap,
): Promise<LabelMap> {
	const cacheKey = getLabelCacheKey(credentials, scope);
	const cached = labelCache.get(cacheKey);

	if (cached !== undefined && Date.now() - cached.fetchedAt <= LABEL_CACHE_TTL_MS) {
		return cached.labels;
	}

	const labels = await withSingleFlight(
		pendingLabelLoads,
		cacheKey,
		async () => await fetchLabels.call(this, credentials, credentialId, url, parse),
	);

	if (labels === undefined) {
		return NO_LABELS;
	}

	labelCache.set(cacheKey, { labels, fetchedAt: Date.now() });

	return labels;
}

/** The labels of every entity set, cached, or none when the server provides none. */
export async function getEntitySetLabels(
	this: ServiceLayerRequestContext,
	credentials: ServiceLayerCredentials,
	credentialId: string | null | undefined,
): Promise<LabelMap> {
	return await getCachedLabels.call(
		this,
		credentials,
		credentialId,
		'entitySets',
		ENTITY_SET_LABELS_URL,
		parseEntitySetLabels,
	);
}

/** The labels of one entity set's properties, cached, or none when the server provides none. */
export async function getPropertyLabels(
	this: ServiceLayerRequestContext,
	credentials: ServiceLayerCredentials,
	credentialId: string | null | undefined,
	entitySetName: string,
): Promise<LabelMap> {
	return await getCachedLabels.call(
		this,
		credentials,
		credentialId,
		`properties:${entitySetName}`,
		getPropertyLabelsUrl(entitySetName),
		parsePropertyLabels,
	);
}
