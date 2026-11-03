import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
} from 'n8n-workflow';

import { SERVICE_LAYER_CREDENTIAL_NAME } from '../../nodes/SapBusinessOneServiceLayer/helpers/credentials';
import type {
	ServiceLayerCredentials,
	ServiceLayerRequestContext,
} from '../../nodes/SapBusinessOneServiceLayer/helpers/types';
import type { HttpFake } from './http';

/**
 * A minimal `INode`. Pass `null` to omit the credential block entirely, which is
 * how the `getSessionCacheKey` fingerprint fallback gets exercised.
 */
export function createTestNode(credentialId: string | null = 'cred-1'): INode {
	const node: INode = {
		id: 'node-1',
		name: 'SAP Business One Service Layer',
		type: 'n8n-nodes-for-sap-business-one.sapBusinessOneServiceLayer',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};

	if (credentialId === null) {
		return node;
	}

	return {
		...node,
		credentials: {
			[SERVICE_LAYER_CREDENTIAL_NAME]: { id: credentialId, name: 'SAP Service Layer account' },
		},
	};
}

/**
 * The context the session/request/metadata helpers need. `ServiceLayerRequestContext`
 * is only `getNode` plus `helpers.httpRequest`, so this is structurally exact —
 * no cast required.
 */
export function createRequestContext(http: HttpFake, node?: INode): ServiceLayerRequestContext {
	const resolved = node ?? createTestNode();

	return {
		getNode: () => resolved,
		helpers: { httpRequest: http.httpRequest },
	};
}

/** A parameter value, or a function of the item index for multi-item tests. */
export type ParameterValue = unknown | ((itemIndex: number) => unknown);

export interface ExecuteFakeOptions {
	http: HttpFake;
	credentials: ServiceLayerCredentials;
	parameters: Record<string, ParameterValue>;
	node?: INode;
	items?: INodeExecutionData[];
	continueOnFail?: boolean;
}

/**
 * An `IExecuteFunctions` stand-in for driving the node's `execute()`.
 *
 * It implements exactly the six members `execute()` touches — `getInputData`,
 * `getNodeParameter`, `getCredentials`, `getNode`, `continueOnFail`, and
 * `helpers.httpRequest`. That partial object is the contract behind the single
 * `as unknown as IExecuteFunctions` cast below; faking the full interface would
 * add hundreds of unused members for no assertion value. (`as unknown as T` is
 * not `any`, so `@typescript-eslint/no-explicit-any` is satisfied.)
 */
export function createExecuteFunctions(options: ExecuteFakeOptions): IExecuteFunctions {
	const node = options.node ?? createTestNode();
	const items = options.items ?? [{ json: {} }];

	const partial = {
		getInputData: () => items,
		getNode: () => node,
		continueOnFail: () => options.continueOnFail ?? false,
		getCredentials: async () => options.credentials,
		getNodeParameter: (
			name: string,
			itemIndex: number,
			_fallbackValue?: unknown,
			readOptions?: { extractValue?: boolean },
		): unknown => {
			if (!(name in options.parameters)) {
				throw new Error(`unexpected parameter read: ${name}`);
			}

			const configured = options.parameters[name];
			const value =
				typeof configured === 'function'
					? (configured as (index: number) => unknown)(itemIndex)
					: configured;

			return readOptions?.extractValue === true ? extractLocatorValue(value) : value;
		},
		helpers: { httpRequest: options.http.httpRequest },
	};

	return partial as unknown as IExecuteFunctions;
}

/**
 * Builds a Resource Locator parameter value as the editor stores it, for the
 * Entity Set, Action or Function and Service Operation parameters.
 */
export function locatorValue(value: string, mode: 'list' | 'name' = 'list'): unknown {
	return { __rl: true, mode, value };
}

/**
 * Mirrors n8n-core's `extractValue` for a locator without an `extractValue`
 * mode (extract-value.ts, `extractValueRLC`): a `{ mode, value }` object
 * yields its value, anything else passes through unchanged, so tests that
 * configure a plain string keep working.
 */
function extractLocatorValue(value: unknown): unknown {
	if (typeof value !== 'object' || value === null || !('mode' in value) || !('value' in value)) {
		return value;
	}

	return (value as { value: unknown }).value;
}

/** Builds the `resourceMapper` parameter shape `getMappedValues` reads. */
export function mapperValue(value: Record<string, unknown> | null): unknown {
	return {
		mappingMode: 'defineBelow',
		value,
		matchingColumns: [],
		schema: [],
		attemptToConvertTypes: false,
		convertFieldsToString: false,
	};
}

/** One `getCredentials` call, recorded so tests can assert how it was invoked. */
export interface CredentialCall {
	type: string;
	itemIndex?: number;
}

export interface LoadOptionsFakeOptions {
	http: HttpFake;
	credentials: ServiceLayerCredentials;
	parameters?: Record<string, unknown>;
	/**
	 * Required, unlike `ExecuteFakeOptions.node`: the credential id carried
	 * here is what keys the session cache, so defaulting it would quietly
	 * hand two tests the same cache slice.
	 */
	node: INode;
}

export interface LoadOptionsFake {
	context: ILoadOptionsFunctions;
	/** Every `getCredentials` call in order. */
	readonly credentialCalls: CredentialCall[];
}

/**
 * An `ILoadOptionsFunctions` stand-in for driving the node's `loadOptions` and
 * `resourceMapping` methods.
 *
 * It implements exactly the five members those methods touch — `getNode`,
 * `getCredentials`, `getNodeParameter`, `getCurrentNodeParameter`, and
 * `helpers.httpRequest` — behind the same single `as unknown as` cast
 * `createExecuteFunctions` uses above. `getCurrentNodeParameter` reads the same
 * table, so a sibling in a fixed collection is configured under its relative
 * name (`&field`).
 *
 * `getNodeParameter` throws for a name the test did not configure, which is
 * what proves `getEntityFields` never reads `operation` before an entity set
 * has been picked. A configured key holding `undefined` is answered normally,
 * so the "dropdown not yet filled" case stays reachable.
 */
export function createLoadOptionsFunctions(options: LoadOptionsFakeOptions): LoadOptionsFake {
	const parameters = options.parameters ?? {};
	const credentialCalls: CredentialCall[] = [];

	const partial = {
		getNode: () => options.node,
		getCredentials: async (type: string, itemIndex?: number) => {
			credentialCalls.push({ type, itemIndex });

			return options.credentials;
		},
		getNodeParameter: (
			name: string,
			_fallbackValue?: unknown,
			readOptions?: { extractValue?: boolean },
		): unknown => {
			if (!(name in parameters)) {
				throw new Error(`unexpected parameter read: ${name}`);
			}

			return readOptions?.extractValue === true
				? extractLocatorValue(parameters[name])
				: parameters[name];
		},
		getCurrentNodeParameter: (name: string): unknown => parameters[name],
		helpers: { httpRequest: options.http.httpRequest },
	};

	return { context: partial as unknown as ILoadOptionsFunctions, credentialCalls };
}
