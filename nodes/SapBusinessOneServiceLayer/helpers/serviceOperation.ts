import type { FunctionsBase, IDataObject } from 'n8n-workflow';
import { NodeOperationError, jsonParse } from 'n8n-workflow';

import { getServiceLayerCredentials } from './credentials';
import { toCustomApiCallOutput } from './customApiCall';
import { getServiceLayerMetadata } from './metadata';
import { encodeODataLiteral } from './odataLiteral';
import { serviceLayerApiRequest } from './request';
import type {
	OperationParameter,
	ServiceLayerCredentialContext,
	ServiceLayerMetadata,
	UnboundOperationDefinition,
} from './types';

type NodeContext = Pick<FunctionsBase, 'getNode'>;

/**
 * How an operation parameter's value is entered and sent.
 *
 * `primitive` covers `Edm.*` types. Every other non-collection type is treated
 * as a structured `object` entered as JSON. That includes enum types, which the
 * parser cannot tell apart from complex types yet; no unbound operation in the
 * analysed metadata takes an enum parameter.
 */
export type OperationParameterShape = 'primitive' | 'object' | 'array';

export function getOperationParameterShape(edmType: string): OperationParameterShape {
	if (edmType.startsWith('Collection(')) {
		return 'array';
	}

	if (edmType.startsWith('Edm.')) {
		return 'primitive';
	}

	return 'object';
}

/** True when a mapper field was left empty — `0` and `false` are legitimate values. */
function isUnset(value: unknown): boolean {
	return value === undefined || value === null || value === '';
}

/** Sentinel returned by `jsonParse` on failure, so no catch-and-rethrow is needed. */
const INVALID_JSON = Object.freeze({});

/**
 * Resolves a structured parameter's value. The resource mapper delivers the
 * JSON editor's text unparsed; an expression may already yield an object or
 * array, which is used as-is.
 */
function parseStructuredValue(
	context: NodeContext,
	parameter: OperationParameter,
	shape: 'object' | 'array',
	raw: unknown,
): unknown {
	const expected = shape === 'array' ? 'a JSON array' : 'a JSON object';
	let value = raw;

	if (typeof raw === 'string') {
		value = jsonParse<unknown>(raw, { fallbackValue: INVALID_JSON });

		if (value === INVALID_JSON) {
			throw new NodeOperationError(
				context.getNode(),
				`The value of parameter "${parameter.name}" is not valid JSON`,
				{
					description: `"${parameter.name}" (${parameter.edmType}) expects ${expected}. Check it for syntax errors such as missing quotes or trailing commas.`,
				},
			);
		}
	}

	const matchesShape =
		shape === 'array'
			? Array.isArray(value)
			: typeof value === 'object' && value !== null && !Array.isArray(value);

	if (!matchesShape) {
		throw new NodeOperationError(
			context.getNode(),
			`The value of parameter "${parameter.name}" must be ${expected}`,
			{ description: `"${parameter.name}" has the type ${parameter.edmType}.` },
		);
	}

	return value;
}

/**
 * Collects the values to send, in metadata order. Only parameters the
 * operation declares are read, so a stale mapper entry left behind by a
 * changed schema is never sent. Fields left empty are omitted; the Service
 * Layer reports a missing value itself, since the metadata marks no operation
 * parameter as required.
 */
export function resolveOperationParameterValues(
	context: NodeContext,
	parameters: OperationParameter[],
	mappedValues: IDataObject,
): Array<{ parameter: OperationParameter; value: unknown }> {
	const resolved: Array<{ parameter: OperationParameter; value: unknown }> = [];

	for (const parameter of parameters) {
		const raw = mappedValues[parameter.name];

		if (isUnset(raw)) {
			continue;
		}

		const shape = getOperationParameterShape(parameter.edmType);

		resolved.push({
			parameter,
			value: shape === 'primitive' ? raw : parseStructuredValue(context, parameter, shape, raw),
		});
	}

	return resolved;
}

/**
 * Builds a function call path with its parameters inline, e.g.
 * `/SBOBobService_GetDueDate(CardCode='C1',RefDate='20260101')`. A function
 * without values is still called with empty parentheses.
 */
export function buildFunctionPath(
	context: NodeContext,
	operationName: string,
	values: Array<{ parameter: OperationParameter; value: unknown }>,
): string {
	const segments = values.map(({ parameter, value }) => {
		if (getOperationParameterShape(parameter.edmType) !== 'primitive') {
			throw new NodeOperationError(
				context.getNode(),
				`Parameter "${parameter.name}" of function "${operationName}" cannot be sent in the URL`,
				{
					description: `Only simple parameter types can be passed to a function; "${parameter.name}" has the type ${parameter.edmType}. Use the Custom API Call resource for this call.`,
				},
			);
		}

		return `${parameter.name}=${encodeODataLiteral(String(value), parameter.literalKind)}`;
	});

	return `/${operationName}(${segments.join(',')})`;
}

/** Looks up an unbound operation by its import name. */
export function findUnboundOperation(
	context: NodeContext,
	metadata: ServiceLayerMetadata,
	operationName: string,
): UnboundOperationDefinition {
	const operation = metadata.unboundOperations.find(
		(candidate) => candidate.name === operationName,
	);

	if (operation === undefined) {
		throw new NodeOperationError(
			context.getNode(),
			`Unknown service operation "${operationName}"`,
			{
				description:
					'The operation is not listed in the Service Layer metadata of the connected instance. Pick it again from the list.',
			},
		);
	}

	return operation;
}

export interface ServiceOperationParameters {
	operationName: string;
	mappedValues: IDataObject;
}

/**
 * Calls an unbound Action (`POST`, parameters as a JSON body) or Function
 * (`GET`, parameters inline in the URL) through the shared authenticated
 * request layer, and shapes the response like a Custom API Call.
 */
export async function executeServiceOperation(
	this: ServiceLayerCredentialContext,
	parameters: ServiceOperationParameters,
	itemIndex: number,
): Promise<IDataObject> {
	const { credentials, credentialId } = await getServiceLayerCredentials.call(this, itemIndex);
	const metadata = await getServiceLayerMetadata.call(this, credentials, credentialId);
	const operation = findUnboundOperation(this, metadata, parameters.operationName);
	const values = resolveOperationParameterValues(
		this,
		operation.parameters,
		parameters.mappedValues,
	);

	if (operation.kind === 'function') {
		const response = await serviceLayerApiRequest.call(this, credentials, credentialId, {
			url: buildFunctionPath(this, operation.name, values),
			method: 'GET',
		});

		return toCustomApiCallOutput(response.body, response.statusCode);
	}

	const body: IDataObject = {};

	for (const { parameter, value } of values) {
		body[parameter.name] = value as IDataObject[string];
	}

	const response = await serviceLayerApiRequest.call(this, credentials, credentialId, {
		url: `/${operation.name}`,
		method: 'POST',
		...(values.length === 0 ? {} : { body }),
	});

	return toCustomApiCallOutput(response.body, response.statusCode);
}
