import type { Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class SapBusinessOneServiceLayerApi implements ICredentialType {
	name = 'sapBusinessOneServiceLayerApi';

	displayName = 'SAP Business One Service Layer API';

	documentationUrl = 'https://docs.sap.com/businessone/latest/en-us/b1-service-layer';

	icon: Icon = {
		light: 'file:../nodes/SapBusinessOneServiceLayer/SapBusinessOneServiceLayer.svg',
		dark: 'file:../nodes/SapBusinessOneServiceLayer/SapBusinessOneServiceLayer.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://myserver.com:50000/b1s/v2',
			required: true,
			description:
				'Service Layer endpoint without trailing slash (e.g. https://server:50000/b1s/v2)',
		},
		{
			displayName: 'User Name',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
			description: 'SAP Business One user name for Service Layer authentication',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'SAP Business One user password',
		},
		{
			displayName: 'Company Database',
			name: 'companyDb',
			type: 'string',
			default: '',
			required: true,
			description: 'Company database name (e.g. SBODEMOEN)',
		},
		{
			displayName: 'Allow Unauthorized Certificates',
			name: 'ignoreSslIssues',
			type: 'boolean',
			default: false,
			noDataExpression: true,
			description:
				'Whether to accept self-signed or otherwise untrusted TLS certificates. Only enable for development environments',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/Login',
			method: 'POST',
			body: {
				CompanyDB: '={{$credentials.companyDb}}',
				UserName: '={{$credentials.username}}',
				Password: '={{$credentials.password}}',
			},
			json: true,
			skipSslCertificateValidation: '={{$credentials.ignoreSslIssues}}',
		},
	};
}
