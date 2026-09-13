import type { IExecuteFunctions, INode, INodeExecutionData } from 'n8n-workflow';

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
		getNodeParameter: (name: string, itemIndex: number): unknown => {
			if (!(name in options.parameters)) {
				throw new Error(`unexpected parameter read: ${name}`);
			}

			const value = options.parameters[name];

			return typeof value === 'function'
				? (value as (index: number) => unknown)(itemIndex)
				: value;
		},
		helpers: { httpRequest: options.http.httpRequest },
	};

	return partial as unknown as IExecuteFunctions;
}

/** Builds the `resourceMapper` parameter shape `getMappedValues` reads. */
export function mapperValue(value: Record<string, string | number | boolean | null>): unknown {
	return {
		mappingMode: 'defineBelow',
		value,
		matchingColumns: [],
		schema: [],
		attemptToConvertTypes: false,
		convertFieldsToString: false,
	};
}
