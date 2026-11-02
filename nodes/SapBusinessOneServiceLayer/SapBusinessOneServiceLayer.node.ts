import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
	ResourceMapperValue,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	SERVICE_LAYER_CREDENTIAL_NAME,
	getServiceLayerCredentials,
} from './helpers/credentials';
import { CUSTOM_API_CALL_BODY_METHODS, executeCustomApiCall } from './helpers/customApiCall';
import { buildEntityBody } from './helpers/entityBody';
import { buildEntityKeySegment } from './helpers/entityPath';
import { buildFilterExpression } from './helpers/filterExpression';
import { getServiceLayerMetadata } from './helpers/metadata';
import { buildEntityQueryString } from './helpers/queryOptions';
import { fetchEntityCollection, serviceLayerApiRequest } from './helpers/request';
import { executeBoundOperation, executeServiceOperation } from './helpers/serviceOperation';
import {
	getBoundOperations,
	getEntitySets,
	getFilterEnumValues,
	getFilterableFields,
	getSelectableFields,
	getServiceOperations,
	getSortableFields,
} from './methods/loadOptions';
import {
	getBoundOperationParameters,
	getEntityFields,
	getEntityKeys,
	getServiceOperationParameters,
} from './methods/resourceMapping';

/** Reads a resource mapper parameter's resolved field values. */
function getMappedValues(
	context: IExecuteFunctions,
	parameterName: string,
	itemIndex: number,
): IDataObject {
	const parameter = context.getNodeParameter(parameterName, itemIndex) as ResourceMapperValue;

	return (parameter.value ?? {}) as IDataObject;
}

/** Reads the Entity Set `Options` collection of `Get` and `Get Many`. */
function getEntityQueryOptions(context: IExecuteFunctions, itemIndex: number): IDataObject {
	return context.getNodeParameter('options', itemIndex, {}) as IDataObject;
}

export class SapBusinessOneServiceLayer implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SAP Business One Service Layer',
		name: 'sapBusinessOneServiceLayer',
		icon: {
			light: 'file:SapBusinessOneServiceLayer.svg',
			dark: 'file:SapBusinessOneServiceLayer.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle:
			'={{$parameter["resource"] === "entitySet" ? ($parameter["operation"] === "executeOperation" ? $parameter["boundOperation"] : $parameter["operation"]) + ": " + $parameter["entitySet"] : $parameter["resource"] === "serviceOperation" ? $parameter["serviceOperation"] : $parameter["resource"] === "customApiCall" ? $parameter["method"] + " " + $parameter["endpoint"] : $parameter["resource"]}}',
		description: 'Interact with the SAP Business One Service Layer',
		defaults: {
			name: 'SAP Business One Service Layer',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: SERVICE_LAYER_CREDENTIAL_NAME,
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Entity Set',
						value: 'entitySet',
						description:
							'Work with a Service Layer entity set (BusinessPartners, Orders, Items, ...)',
					},
					{
						name: 'Service Operation',
						value: 'serviceOperation',
						description: 'Call an unbound Service Layer action or function',
					},
					{
						name: 'Custom API Call',
						value: 'customApiCall',
						description: 'Call a Service Layer endpoint directly',
					},
				],
				default: 'entitySet',
			},
			{
				displayName: 'Entity Set Name or ID',
				name: 'entitySet',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getEntitySets',
				},
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['entitySet'],
					},
				},
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['entitySet'],
					},
				},
				options: [
					{ name: 'Create', value: 'create', description: 'Create a new entity in the entity set', action: 'Create entity' },
					{ name: 'Delete', value: 'delete', description: 'Delete an entity by its key', action: 'Delete entity' },
					{ name: 'Execute Action or Function', value: 'executeOperation', description: 'Call an action or function bound to an entity, such as closing an order', action: 'Execute action or function on entity' },
					{ name: 'Get', value: 'get', description: 'Retrieve an entity by its key', action: 'Get entity' },
					{ name: 'Get Many', value: 'getMany', description: 'Retrieve a list of entities, optionally filtered and sorted', action: 'Get many entities' },
					{ name: 'Update', value: 'update', description: 'Update fields of an existing entity', action: 'Update entity' },
				],
				default: 'get',
			},
			{
				displayName: 'Action or Function Name or ID',
				name: 'boundOperation',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getBoundOperations',
					loadOptionsDependsOn: ['entitySet'],
				},
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['executeOperation'],
					},
				},
				description:
					'Action or Function bound to the selected entity set. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Key Fields',
				name: 'keyFields',
				type: 'resourceMapper',
				default: {
					mappingMode: 'defineBelow',
					value: null,
				},
				noDataExpression: true,
				required: true,
				typeOptions: {
					loadOptionsDependsOn: ['entitySet'],
					resourceMapper: {
						resourceMapperMethod: 'getEntityKeys',
						mode: 'add',
						addAllFields: false,
						supportAutoMap: false,
						hideNoDataError: true,
						fieldWords: {
							singular: 'key field',
							plural: 'key fields',
						},
					},
				},
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['get', 'update', 'delete', 'executeOperation'],
					},
				},
			},
			{
				displayName: 'Parameters',
				name: 'boundOperationParameters',
				type: 'resourceMapper',
				default: {
					mappingMode: 'defineBelow',
					value: null,
				},
				noDataExpression: true,
				required: true,
				typeOptions: {
					loadOptionsDependsOn: ['entitySet', 'boundOperation'],
					resourceMapper: {
						resourceMapperMethod: 'getBoundOperationParameters',
						mode: 'add',
						addAllFields: false,
						supportAutoMap: false,
						hideNoDataError: true,
						fieldWords: {
							singular: 'parameter',
							plural: 'parameters',
						},
					},
				},
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['executeOperation'],
					},
				},
			},
			{
				displayName: 'Fields',
				name: 'entityFields',
				type: 'resourceMapper',
				default: {
					mappingMode: 'defineBelow',
					value: null,
				},
				noDataExpression: true,
				required: true,
				typeOptions: {
					loadOptionsDependsOn: ['entitySet', 'operation'],
					resourceMapper: {
						resourceMapperMethod: 'getEntityFields',
						mode: 'add',
						addAllFields: false,
						supportAutoMap: false,
						hideNoDataError: true,
						fieldWords: {
							singular: 'field',
							plural: 'fields',
						},
					},
				},
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['create', 'update'],
					},
				},
			},
			{
				displayName: 'Replace Collections',
				name: 'replaceCollections',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['update'],
					},
				},
				description:
					'Whether to replace collection properties such as DocumentLines instead of merging them into the existing lines. Sends the B1S-ReplaceCollectionsOnPatch header.',
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['getMany'],
					},
				},
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['getMany'],
						returnAll: [false],
					},
				},
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filter',
				name: 'filterType',
				type: 'options',
				options: [
					{
						name: 'None',
						value: 'none',
						description: 'All entities are returned',
					},
					{
						name: 'Build Manually',
						value: 'manual',
						description: 'Pick fields, operators and values from lists',
					},
					{
						name: 'OData String',
						value: 'string',
						description: 'Enter an OData $filter expression yourself, e.g. for mixed AND and OR',
					},
				],
				default: 'none',
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['getMany'],
					},
				},
				description: 'Which entities are returned ($filter)',
			},
			{
				displayName: 'Must Match',
				name: 'matchType',
				type: 'options',
				options: [
					{
						name: 'All Conditions',
						value: 'and',
					},
					{
						name: 'Any Condition',
						value: 'or',
					},
				],
				default: 'and',
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['getMany'],
						filterType: ['manual'],
					},
				},
			},
			{
				displayName: 'Conditions',
				name: 'conditions',
				type: 'fixedCollection',
				placeholder: 'Add condition',
				default: {},
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['getMany'],
						filterType: ['manual'],
					},
				},
				description:
					'Only entities that meet these conditions are returned. Without a condition, all are returned.',
				options: [
					{
						displayName: 'Condition',
						name: 'condition',
						values: [
							{
								displayName: 'Field Name or ID',
								name: 'field',
								type: 'options',
								typeOptions: {
									loadOptionsMethod: 'getFilterableFields',
									loadOptionsDependsOn: ['entitySet'],
								},
								default: '',
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Operator',
								name: 'comparisonOperator',
								type: 'options',
								options: [
									{ name: 'Equal', value: 'equal' },
									{ name: 'Greater Than', value: 'greaterThan' },
									{ name: 'Greater Than or Equal', value: 'greaterOrEqual' },
									{ name: 'Is Empty', value: 'isEmpty' },
									{ name: 'Is Not Empty', value: 'isNotEmpty' },
									{ name: 'Less Than', value: 'lessThan' },
									{ name: 'Less Than or Equal', value: 'lessOrEqual' },
									{ name: 'Not Equal', value: 'notEqual' },
								],
								default: 'equal',
								displayOptions: {
									show: {
										operatorSet: ['ordered'],
									},
								},
								description: 'Dates are compared by day only',
							},
							{
								displayName: 'Operator',
								name: 'equalityOperator',
								type: 'options',
								options: [
									{ name: 'Equal', value: 'equal' },
									{ name: 'Is Empty', value: 'isEmpty' },
									{ name: 'Is Not Empty', value: 'isNotEmpty' },
									{ name: 'Not Equal', value: 'notEqual' },
								],
								default: 'equal',
								displayOptions: {
									show: {
										operatorSet: ['equality'],
									},
								},
							},
							{
								displayName: 'Operator',
								name: 'operator',
								type: 'options',
								options: [
									{ name: 'Contains', value: 'contains' },
									{ name: 'Ends With', value: 'endsWith' },
									{ name: 'Equal', value: 'equal' },
									{ name: 'Greater Than', value: 'greaterThan' },
									{ name: 'Greater Than or Equal', value: 'greaterOrEqual' },
									{ name: 'Is Empty', value: 'isEmpty' },
									{ name: 'Is Not Empty', value: 'isNotEmpty' },
									{ name: 'Less Than', value: 'lessThan' },
									{ name: 'Less Than or Equal', value: 'lessOrEqual' },
									{ name: 'Not Contains', value: 'notContains' },
									{ name: 'Not Ends With', value: 'notEndsWith' },
									{ name: 'Not Equal', value: 'notEqual' },
									{ name: 'Not Starts With', value: 'notStartsWith' },
									{ name: 'Starts With', value: 'startsWith' },
								],
								default: 'equal',
								displayOptions: {
									hide: {
										operatorSet: ['ordered', 'equality'],
									},
								},
								description: 'Contains, Starts With and Ends With are case-sensitive',
							},
							{
								displayName: 'Operator Set',
								name: 'operatorSet',
								type: 'hidden',
								// The field's value carries the operators that fit it (`DocDate|date|ordered`),
								// which decides which of the operator inputs above is shown.
								default: '={{$parameter["&field"].split("|")[2]}}',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								displayOptions: {
									hide: {
										valueType: ['enum', 'date'],
										operator: ['isEmpty', 'isNotEmpty'],
									},
								},
								description:
									'Entered without quotes; it is quoted to match the field type. Times as 08:00:00.',
							},
							{
								displayName: 'Value',
								name: 'dateValue',
								type: 'dateTime',
								default: '',
								displayOptions: {
									show: {
										valueType: ['date'],
									},
									hide: {
										operator: ['isEmpty', 'isNotEmpty'],
									},
								},
								description: 'Compared by day only; the time is ignored',
							},
							{
								displayName: 'Value Name or ID',
								name: 'enumValue',
								type: 'options',
								typeOptions: {
									loadOptionsMethod: 'getFilterEnumValues',
									loadOptionsDependsOn: ['&field'],
								},
								default: '',
								displayOptions: {
									show: {
										valueType: ['enum'],
									},
									hide: {
										operator: ['isEmpty', 'isNotEmpty'],
									},
								},
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Value Type',
								name: 'valueType',
								type: 'hidden',
								// The field's value carries its kind (`DocDate|date`), which decides which
								// of the value inputs above is shown; see getFilterableFields.
								default: '={{$parameter["&field"].split("|")[1]}}',
							},
						],
					},
				],
			},
			{
				displayName: 'Filter (OData)',
				name: 'filterString',
				type: 'string',
				default: '',
				placeholder: "e.g. DocTotal gt 1000 and startswith(CardCode,'C')",
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['getMany'],
						filterType: ['string'],
					},
				},
				description:
					'OData $filter expression, sent as entered. Strings and enum values go in single quotes (CardType eq \'cCustomer\'), numbers without. Supported: eq, ne, gt, ge, lt, le, and, or, not, parentheses, contains, startswith, endswith.',
				hint: 'See <a href="https://help.sap.com/docs/SAP_BUSINESS_ONE/f110a154dd0f4c20bf7f3ebca9eeb794/3e5b7d980d99493f9271847450a927ef.html" target="_blank">Query Options</a> in the SAP Business One Service Layer documentation',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['get', 'getMany'],
					},
				},
				options: [
					{
						displayName: 'Select Field Names or IDs',
						name: 'select',
						type: 'multiOptions',
						typeOptions: {
							loadOptionsMethod: 'getSelectableFields',
							loadOptionsDependsOn: ['entitySet'],
						},
						default: [],
						description:
							'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
						hint: 'Only these properties are returned ($select). Without a choice, all are returned.',
					},
				],
			},
			{
				displayName: 'Sort',
				name: 'sort',
				type: 'fixedCollection',
				placeholder: 'Add sort field',
				default: {},
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						resource: ['entitySet'],
						operation: ['getMany'],
					},
				},
				description: 'Order of the results ($orderby), in the order given',
				options: [
					{
						displayName: 'Sort Field',
						name: 'fields',
						values: [
							{
								displayName: 'Field Name or ID',
								name: 'field',
								type: 'options',
								typeOptions: {
									loadOptionsMethod: 'getSortableFields',
									loadOptionsDependsOn: ['entitySet'],
								},
								default: '',
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{
								displayName: 'Direction',
								name: 'direction',
								type: 'options',
								options: [
									{ name: 'Ascending', value: 'asc' },
									{ name: 'Descending', value: 'desc' },
								],
								default: 'asc',
							},
						],
					},
				],
			},
			{
				displayName: 'Service Operation Name or ID',
				name: 'serviceOperation',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getServiceOperations',
				},
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['serviceOperation'],
					},
				},
				description:
					'Unbound Action or Function to call. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Parameters',
				name: 'operationParameters',
				type: 'resourceMapper',
				default: {
					mappingMode: 'defineBelow',
					value: null,
				},
				noDataExpression: true,
				required: true,
				typeOptions: {
					loadOptionsDependsOn: ['serviceOperation'],
					resourceMapper: {
						resourceMapperMethod: 'getServiceOperationParameters',
						mode: 'add',
						addAllFields: false,
						supportAutoMap: false,
						hideNoDataError: true,
						fieldWords: {
							singular: 'parameter',
							plural: 'parameters',
						},
					},
				},
				displayOptions: {
					show: {
						resource: ['serviceOperation'],
					},
				},
			},
			{
				displayName: 'Method',
				name: 'method',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['customApiCall'],
					},
				},
				options: [
					{ name: 'DELETE', value: 'DELETE' },
					{ name: 'GET', value: 'GET' },
					{ name: 'PATCH', value: 'PATCH' },
					{ name: 'POST', value: 'POST' },
					{ name: 'PUT', value: 'PUT' },
				],
				default: 'GET',
				description: 'The HTTP method to use',
			},
			{
				displayName: 'Endpoint',
				name: 'endpoint',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. /Orders(45)',
				displayOptions: {
					show: {
						resource: ['customApiCall'],
					},
				},
				description:
					'Service Layer path relative to the Base URL of the credential; the /b1s/v2 API root is added automatically. May include query parameters, for example /Orders?$top=10.',
			},
			{
				displayName: 'JSON Body',
				name: 'jsonBody',
				type: 'json',
				default: '',
				displayOptions: {
					show: {
						resource: ['customApiCall'],
						method: ['PATCH', 'POST', 'PUT'],
					},
				},
				description: 'Optional JSON request body. Leave empty to send no body.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						resource: ['customApiCall'],
					},
				},
				options: [
					{
						displayName: 'Headers',
						name: 'headers',
						type: 'fixedCollection',
						placeholder: 'Add header',
						default: {},
						typeOptions: {
							multipleValues: true,
						},
						description:
							'Additional HTTP headers to send, for example B1S-ReplaceCollectionsOnPatch. The session cookie is managed by the node and cannot be set.',
						options: [
							{
								displayName: 'Header',
								name: 'header',
								values: [
									{
										displayName: 'Name',
										name: 'name',
										type: 'string',
										default: '',
									},
									{
										displayName: 'Value',
										name: 'value',
										type: 'string',
										default: '',
									},
								],
							},
						],
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			getBoundOperations,
			getEntitySets,
			getFilterEnumValues,
			getFilterableFields,
			getSelectableFields,
			getServiceOperations,
			getSortableFields,
		},
		resourceMapping: {
			getBoundOperationParameters,
			getEntityFields,
			getEntityKeys,
			getServiceOperationParameters,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;

				// Branches before the metadata fetch below: a custom call addresses an
				// arbitrary endpoint and has no use for the parsed /$metadata document.
				if (resource === 'customApiCall') {
					const method = this.getNodeParameter('method', itemIndex) as string;
					const json = await executeCustomApiCall.call(
						this,
						{
							method,
							endpoint: this.getNodeParameter('endpoint', itemIndex),
							jsonBody: (CUSTOM_API_CALL_BODY_METHODS as readonly string[]).includes(method)
								? this.getNodeParameter('jsonBody', itemIndex, '')
								: undefined,
							headers: (this.getNodeParameter('options', itemIndex, {}) as IDataObject).headers,
						},
						itemIndex,
					);
					returnData.push({ json, pairedItem: { item: itemIndex } });
					continue;
				}

				if (resource === 'serviceOperation') {
					const json = await executeServiceOperation.call(
						this,
						{
							operationName: this.getNodeParameter('serviceOperation', itemIndex) as string,
							mappedValues: getMappedValues(this, 'operationParameters', itemIndex),
						},
						itemIndex,
					);
					returnData.push({ json, pairedItem: { item: itemIndex } });
					continue;
				}

				if (resource !== 'entitySet') {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown resource "${resource}"`,
						{ itemIndex },
					);
				}

				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const entitySetName = this.getNodeParameter('entitySet', itemIndex) as string;
				const { credentials, credentialId } = await getServiceLayerCredentials.call(
					this,
					itemIndex,
				);

				const metadata = await getServiceLayerMetadata.call(this, credentials, credentialId);
				const entity = metadata.entities.get(entitySetName);

				if (entity === undefined) {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown entity set "${entitySetName}"`,
						{ itemIndex },
					);
				}

				if (operation === 'get') {
					const keySegment = buildEntityKeySegment(
						this,
						entity,
						getMappedValues(this, 'keyFields', itemIndex),
					);
					// Only Select Field Names or IDs applies to Get; the filter and the sort of Get Many
					// are parameters of their own and are not read here.
					const queryString = buildEntityQueryString({
						select: getEntityQueryOptions(this, itemIndex).select,
					});
					const { body } = await serviceLayerApiRequest.call(
						this,
						credentials,
						credentialId,
						{ url: `/${keySegment}${queryString}`, method: 'GET' },
					);
					returnData.push({ json: body as IDataObject, pairedItem: { item: itemIndex } });
					continue;
				}

				if (operation === 'getMany') {
					const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
					const limit = returnAll
						? undefined
						: (this.getNodeParameter('limit', itemIndex) as number);
					const options = getEntityQueryOptions(this, itemIndex);
					const filterType = this.getNodeParameter('filterType', itemIndex, 'none');
					const filter = buildFilterExpression(
						this,
						entity,
						metadata,
						filterType === 'manual'
							? {
									filterType,
									conditions: this.getNodeParameter('conditions', itemIndex, {}),
									matchType: this.getNodeParameter('matchType', itemIndex, 'and'),
								}
							: filterType === 'string'
								? { filterType, filterString: this.getNodeParameter('filterString', itemIndex, '') }
								: { filterType },
					);

					const entities = await fetchEntityCollection.call(
						this,
						credentials,
						credentialId,
						entitySetName,
						limit,
						buildEntityQueryString({
							select: options.select,
							filter,
							sort: this.getNodeParameter('sort', itemIndex, {}),
						}),
					);

					for (const entityData of entities) {
						returnData.push({ json: entityData, pairedItem: { item: itemIndex } });
					}
					continue;
				}

				if (operation === 'create') {
					const { body } = await serviceLayerApiRequest.call(
						this,
						credentials,
						credentialId,
						{
							url: `/${entitySetName}`,
							method: 'POST',
							body: buildEntityBody(
								this,
								entity,
								metadata,
								getMappedValues(this, 'entityFields', itemIndex),
							),
						},
					);
					returnData.push({ json: body as IDataObject, pairedItem: { item: itemIndex } });
					continue;
				}

				if (operation === 'update') {
					const keyValues = getMappedValues(this, 'keyFields', itemIndex);
					const keySegment = buildEntityKeySegment(this, entity, keyValues);
					const fieldValues = buildEntityBody(
						this,
						entity,
						metadata,
						getMappedValues(this, 'entityFields', itemIndex),
					);

					const replaceCollections = this.getNodeParameter(
						'replaceCollections',
						itemIndex,
						false,
					) as boolean;

					// The Service Layer returns 204 No Content on a successful PATCH. Default
					// JSON parsing is kept (not json: false): an empty body parses to '' without
					// throwing, and json: false would also skip parsing a failed PATCH's error
					// body, losing the real SAP error message/code (confirmed against a live
					// instance — see sanitizeServiceLayerError in helpers/session.ts).
					await serviceLayerApiRequest.call(this, credentials, credentialId, {
						url: `/${keySegment}`,
						method: 'PATCH',
						body: fieldValues,
						// Without it the Service Layer merges collections into the existing
						// lines (see README, "Update and collections").
						...(replaceCollections ? { headers: { 'B1S-ReplaceCollectionsOnPatch': 'true' } } : {}),
					});

					returnData.push({
						json: {
							success: true,
							entitySet: entitySetName,
							key: keyValues,
							...fieldValues,
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (operation === 'delete') {
					const keyValues = getMappedValues(this, 'keyFields', itemIndex);
					const keySegment = buildEntityKeySegment(this, entity, keyValues);

					// The Service Layer returns 204 No Content on a successful DELETE. See the
					// comment on the Update branch above for why json: false is deliberately
					// not used here.
					await serviceLayerApiRequest.call(this, credentials, credentialId, {
						url: `/${keySegment}`,
						method: 'DELETE',
					});

					returnData.push({
						json: { deleted: true },
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (operation === 'executeOperation') {
					const json = await executeBoundOperation.call(
						this,
						credentials,
						credentialId,
						entity,
						metadata,
						{
							operationName: this.getNodeParameter('boundOperation', itemIndex) as string,
							keyValues: getMappedValues(this, 'keyFields', itemIndex),
							mappedValues: getMappedValues(this, 'boundOperationParameters', itemIndex),
						},
					);
					returnData.push({ json, pairedItem: { item: itemIndex } });
					continue;
				}

				throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
					itemIndex,
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				// buildEntityKeySegment, getServiceLayerMetadata, and serviceLayerApiRequest already
				// throw NodeApiError/NodeOperationError; both constructors return an existing instance
				// of their own type unchanged, so wrapping here is a no-op for those and only actually
				// wraps a genuinely raw error, while keeping every throw site covered by
				// require-node-api-error.
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex });
				}

				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
