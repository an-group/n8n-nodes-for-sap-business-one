import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { getEntitySets } from './methods/loadOptions';

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
		subtitle: '={{$parameter["resource"]}}',
		description: 'Interact with the SAP Business One Service Layer',
		defaults: {
			name: 'SAP Business One Service Layer',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'sapBusinessOneServiceLayerApi',
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
						description: 'Work with a Service Layer entity set (BusinessPartners, Orders, Items, ...)',
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
		],
	};

	methods = {
		loadOptions: {
			getEntitySets,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
			const message = 'This resource has no operations implemented yet';

			if (this.continueOnFail()) {
				returnData.push({ json: { error: message }, pairedItem: { item: itemIndex } });
				continue;
			}

			throw new NodeOperationError(this.getNode(), message, { itemIndex });
		}

		return [returnData];
	}
}
