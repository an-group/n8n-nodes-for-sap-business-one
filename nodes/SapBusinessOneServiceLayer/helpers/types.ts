import type { FunctionsBase, RequestHelperFunctions } from 'n8n-workflow';

/**
 * Decrypted shape of the `sapBusinessOneServiceLayerApi` credential.
 */
export interface ServiceLayerCredentials {
	baseUrl: string;
	username: string;
	password: string;
	companyDb: string;
	skipTlsVerification: boolean;
}

/**
 * Minimal execution context the session/request/metadata helpers need. Both
 * `IExecuteFunctions` and `ILoadOptionsFunctions` satisfy this structurally, so
 * the same helpers serve `execute()` and `methods.loadOptions` without widening
 * to either concrete n8n context type.
 */
export type ServiceLayerRequestContext = Pick<FunctionsBase, 'getNode'> & {
	helpers: Pick<RequestHelperFunctions, 'httpRequest'>;
};

/**
 * A request context that can also resolve this node's credentials. Both
 * `IExecuteFunctions` and `ILoadOptionsFunctions` satisfy it, so `execute()`
 * and the `loadOptions`/`resourceMapping` methods share one metadata entry
 * point (see helpers/credentials.ts).
 */
export type ServiceLayerCredentialContext = ServiceLayerRequestContext &
	Pick<FunctionsBase, 'getCredentials'>;

/**
 * A Service Layer session held in memory for the lifetime of the n8n process.
 *
 * Never serialise this into node output, logs, or errors: `sessionId` and
 * `routeId` are authentication material.
 */
export interface ServiceLayerSession {
	/** `B1SESSION` value. */
	sessionId: string;
	/** `ROUTEID` value, only set when the Service Layer returns one. */
	routeId?: string;
	/**
	 * Idle timeout in milliseconds, derived from the server's `SessionTimeout`.
	 * Undefined when the server did not report one, in which case the session is
	 * never expired proactively and is only dropped once SAP rejects it.
	 */
	timeoutMs?: number;
	/** Epoch ms of the last successful use. Refreshed after every successful request. */
	lastUsedAt: number;
}

/**
 * Cache entry pairing a session with a fingerprint of the credential values it
 * was created from, so an edited credential replaces its session instead of
 * silently reusing a session that belongs to different values.
 */
export interface SessionCacheEntry {
	fingerprint: string;
	session: ServiceLayerSession;
}

/**
 * Narrowed Service Layer response. Response headers are deliberately not
 * exposed: they carry `set-cookie`, and at runtime they are an `AxiosHeaders`
 * instance rather than a plain object.
 */
export interface ServiceLayerResponse<T = unknown> {
	body: T;
	statusCode: number;
}

/**
 * How an EDM primitive type is written as an OData literal: `numeric` and
 * `datetime` are unquoted, `string` is quoted with embedded quotes doubled.
 * `datetime` is split out from `numeric` because its literal format (ISO 8601)
 * has constraints beyond "don't quote it" that this package has not verified
 * against a real Service Layer instance.
 */
export type OdataLiteralKind = 'numeric' | 'string' | 'datetime';

/** One property of an entity's key, in metadata declaration order. */
export interface EntityKeyProperty {
	name: string;
	edmType: string;
	literalKind: OdataLiteralKind;
}

/** One property of an entity or complex type, as declared in its type block. */
export interface EntityPropertyDefinition {
	name: string;
	edmType: string;
	nullable: boolean;
}

/** One parameter of a bound or unbound Action/Function, excluding any binding parameter. */
export interface OperationParameter {
	name: string;
	edmType: string;
	literalKind: OdataLiteralKind;
	nullable: boolean;
}

/** An Action or Function bound to an entity type, e.g. `Orders(1)/Close`. */
export interface BoundOperationDefinition {
	name: string;
	kind: 'action' | 'function';
	/** Unqualified entity type name it is bound to, e.g. `Document`. */
	bindingEntityType: string;
	parameters: OperationParameter[];
}

/** An unbound Action or Function reachable via `ActionImport`/`FunctionImport`. */
export interface UnboundOperationDefinition {
	name: string;
	kind: 'action' | 'function';
	parameters: OperationParameter[];
}

/** One entity set, resolved to its entity type's keys, properties, and bound operations. */
export interface EntityDefinition {
	entitySetName: string;
	/** Unqualified entity type name, e.g. `Document` (the `SAPB1.` prefix is stripped). */
	entityTypeName: string;
	/** Ordered per metadata; length > 1 means a composite key. */
	keys: EntityKeyProperty[];
	properties: EntityPropertyDefinition[];
	boundActions: BoundOperationDefinition[];
	boundFunctions: BoundOperationDefinition[];
}

/** A structured, keyless type such as `AddressExtension` or `DocumentLine`. */
export interface ComplexTypeDefinition {
	/** Unqualified type name, e.g. `DocumentLine` (the `SAPB1.` prefix is stripped). */
	name: string;
	properties: EntityPropertyDefinition[];
}

/**
 * An entity type's properties, independent of any entity set. Operation
 * parameters reference entity types directly (e.g. `SAPB1.Document`).
 */
export interface EntityTypeDefinition {
	/** Unqualified type name, e.g. `Document`. */
	name: string;
	properties: EntityPropertyDefinition[];
}

/** Parsed shape of a Service Layer instance's `/$metadata` (EDMX) document. */
export interface ServiceLayerMetadata {
	entities: Map<string, EntityDefinition>;
	unboundOperations: UnboundOperationDefinition[];
	/** Keyed by unqualified type name. */
	complexTypes: Map<string, ComplexTypeDefinition>;
	/** Unqualified names of every declared `EnumType`, e.g. `BoYesNoEnum`. */
	enumTypeNames: Set<string>;
	/**
	 * Every declared `EntityType`, keyed by unqualified name, including those no
	 * entity set exposes — operation parameters reference entity types directly.
	 */
	entityTypes: Map<string, EntityTypeDefinition>;
}

/**
 * What a property or parameter type refers to. `unknown` is a name the
 * metadata does not declare; callers decide how to fall back.
 */
export type ServiceLayerTypeCategory = 'primitive' | 'enum' | 'complex' | 'entity' | 'unknown';

/** A classified type reference, with any `Collection(...)` wrapper removed. */
export interface ServiceLayerTypeInfo {
	category: ServiceLayerTypeCategory;
	isCollection: boolean;
	/**
	 * The element type: `Edm.*` names are kept qualified, every other name is
	 * unqualified (e.g. `DocumentLine` for `Collection(SAPB1.DocumentLine)`).
	 */
	typeName: string;
}
