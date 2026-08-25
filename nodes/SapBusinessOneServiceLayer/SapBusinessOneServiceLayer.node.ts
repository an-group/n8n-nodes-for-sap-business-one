import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

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
		subtitle: '={{$parameter["operation"]}}',
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
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Test',
						value: 'test',
						action: 'Return test data',
						description: 'Return test data without connecting to SAP Business One',
					},
				],
				default: 'test',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
			const operation = this.getNodeParameter('operation', itemIndex) as string;

			if (operation === 'test') {
				returnData.push({
					json: {
						success: true,
						message: 'SAP Business One Service Layer node scaffold is working.',
					},
					pairedItem: {
						item: itemIndex,
					},
				});
			}
		}

		return [returnData];
	}
}
