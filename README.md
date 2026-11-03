# n8n Nodes for SAP Business One

This is an n8n community node. It lets you use the SAP Business One Service Layer in your n8n workflows.

[SAP Business One](https://help.sap.com/docs/SAP_BUSINESS_ONE) is an ERP system for small and midsize companies. Its Service Layer is the OData API through which other systems read and write its data, such as business partners, items, and sales orders.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

This is an unofficial integration, developed and maintained by [ANG Schweiz AG](https://www.an-group.one/ch/). It handles authentication, session handling, and OData requests for you, and reads the connected instance's metadata to offer its entity sets, fields, and operations in the editor.

## Project Status

Version 0.1.0 is the first published release. While the version starts with 0.x, node parameters, credential fields, and behavior may still change between minor versions; every change is listed in the [CHANGELOG](CHANGELOG.md). Try write operations on a test company first.

## Contents

- [Installation](#installation)
- [Operations](#operations)
- [Credentials](#credentials)
- [Compatibility](#compatibility)
- [Usage](#usage)
- [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

In n8n, go to **Settings → Community Nodes**, select **Install**, and enter `n8n-nodes-for-sap-business-one`.

The package is not verified by n8n yet, so it can be installed on self-hosted n8n only, not on n8n Cloud. To work on the node itself, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Operations

The node has three resources:

| Resource | Operations | Use it to |
|---|---|---|
| **Entity Set** | Get, Get Many, Create, Update, Delete, Execute Action or Function | read and write records such as `BusinessPartners`, `Orders`, or `Items` |
| **Service Operation** | Call | call an action or function that is not bound to a record, such as `CompanyService_GetCompanyInfo` |
| **Custom API Call** | Send Request | send a request to any Service Layer endpoint the other resources do not cover |

The entity sets, fields, and operations offered in the editor come from the connected instance's metadata (`/$metadata`), so user-defined tables and fields appear too.

Every operation and its parameters are described in [docs/operations.md](docs/operations.md): key fields, the field mapper, how Update merges collections such as `DocumentLines`, the filter, Select and Sort, pagination, bound and unbound actions and functions, and the Custom API Call.

Not supported yet:

- The `$expand` query option
- Structured SAP Business One error handling
- Webhook and event integration

## Credentials

The **SAP Business One Service Layer** credential connects the node to one company database.

Prerequisites:

- an SAP Business One Service Layer that exposes the v2 API (`/b1s/v2`) and is reachable from n8n over HTTPS
- an SAP Business One user with the permissions the workflows need; every session opened by the node uses one of that user's licensed sessions

Fields:

- **Base URL** — Service Layer host and port only, without a path or trailing slash, for example `https://server:50000`. The `/b1s/v2` API path is added automatically. Only the Service Layer v2 API (OData V4 metadata) is supported; older v1-only instances are rejected with a clear error rather than silently missing functionality.
- **User Name** — SAP Business One user name
- **Password** — SAP Business One user password, stored as a protected n8n credential field
- **Company Database** — name of the company database to sign in to, for example `SBODEMOEN`
- **Allow Unauthorized Certificates** — accepts self-signed or otherwise untrusted TLS certificates. Disabled by default and intended only for development environments.

The credential test signs in to the Service Layer `/Login` endpoint with the configured Base URL, company database, user name, and password. It honours **Allow Unauthorized Certificates** and reports sign-in and connection failures without exposing credential values.

Every credential test opens a real Service Layer session. `/Login` is the only endpoint that can validate these credentials, an n8n credential test cannot chain a `/Logout` call, and SAP Business One sessions stay open until they time out (30 minutes by default) while counting against the licensed session limit. Running the credential test repeatedly against an instance with few available sessions will accumulate open sessions.

## Compatibility

Tested with n8n 2.45.7 and SAP Business One 10.0 FP 2608 (version 10.00.340), Service Layer v2. Other versions have not been tested yet.

Only the Service Layer v2 API is supported. A minimum supported n8n version will be stated with release 1.0.0.

## Usage

### Example workflows

The [`examples`](examples) folder holds workflows to import into n8n; [examples/README.md](examples/README.md) explains how to import them and walks through the requests they send.

| File | What it shows |
| --- | --- |
| [`read-open-sales-orders.json`](examples/read-open-sales-orders.json) | Get Many with a manual filter, Select and Sort: the ten most recent open sales orders |
| [`create-and-update-business-partner.json`](examples/create-and-update-business-partner.json) | Create, Update and Get of a customer, with values from an Edit Fields node |
| [`create-sales-order-and-close.json`](examples/create-sales-order-and-close.json) | Create a sales order with three lines in `DocumentLines`, then the bound action `Close` |
| [`get-company-currencies.json`](examples/get-company-currencies.json) | Two unbound service operations without parameters |
| [`ai-agent-customer-lookup.json`](examples/ai-agent-customer-lookup.json) | The node as an AI agent tool, with `$fromAI()` in the filter and Select |

The sample values (`C20000`, `A00001` to `A00003`) are those of the SAP Business One demo company; replace them with codes of your company. The workflows that write create a business partner and a sales order, so run them against a test company.

### Session and metadata handling

The node signs in once per credential and reuses the session; a session the Service Layer rejects is renewed and the request retried once. It reads the connected instance's metadata, keeps it in memory, and checks it in the background while the editor is used. Sessions and metadata are held per n8n process. Details: [docs/session-and-metadata.md](docs/session-and-metadata.md).

### Use as an AI tool

The node is `usableAsTool`, so an AI agent given this node can issue any of these operations — including Delete and a Custom API Call with `DELETE` — against any Service Layer endpoint the SAP user is authorised for. Scope the SAP user's permissions accordingly.

Service Layer entities are large, and an agent's context fills quickly: three orders with all their fields come to almost 90,000 characters. When the node runs as a tool:

- set **Select Field Names or IDs** to the fields the agent needs;
- keep **Limit** small, or let the agent set it with `$fromAI()`;
- set **Tool Description** to **Set Manually** and name the entity set and what the tool returns, for example "Returns open sales orders with their number, customer, date and total". The automatic description names only the operation, not the entity set.

## Resources

- [Operations reference](docs/operations.md)
- [Session and metadata handling](docs/session-and-metadata.md)
- [Example workflows](examples/README.md)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [SAP Business One documentation](https://help.sap.com/docs/SAP_BUSINESS_ONE)
- [Development notes for maintainers](DEVELOPMENT.md)

## Version history

See [CHANGELOG.md](CHANGELOG.md).

## Security

Do not report security vulnerabilities through public GitHub issues; use the private reporting process in [SECURITY.md](SECURITY.md). Never include passwords, session cookies (`B1SESSION`, `ROUTEID`), credential values, internal hostnames, customer or business data, or private keys in issues, logs, screenshots, or example workflows.

## Contributing

The project uses a closed contribution model: bug reports, feature requests, documentation suggestions, and use cases are welcome as issues, external pull requests are not accepted yet. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Trademark and Affiliation Notice

This project is an independent, unofficial community integration and is not affiliated with, endorsed by, sponsored by, certified by, or otherwise associated with SAP SE, its affiliates, or n8n GmbH.

SAP and SAP Business One are trademarks or registered trademarks of SAP SE or its affiliates in Germany and other countries.

n8n is a trademark of n8n GmbH.

All other product names, trademarks, and registered trademarks are the property of their respective owners.

References to SAP products and n8n are made solely to describe compatibility and intended use.

No SAP or n8n logos, proprietary artwork, or other brand assets are included in this project.

## License

This project is licensed under the [MIT License](LICENSE).

Copyright © 2026 ANG Schweiz AG.

Project lead and maintainer: Markus Kistler.