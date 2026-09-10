# n8n Nodes for SAP Business One

Unofficial n8n community nodes for integrating SAP Business One with n8n workflows.

The package is developed and maintained by [ANG Schweiz AG](https://an-group.one/).

The initial node focuses on the SAP Business One Service Layer. Its goal is to simplify authentication, session handling, OData requests, entity operations, error handling, webhook handling, and other recurring integration tasks.

## Project Status

This project is currently under active development.

The current version contains the initial node scaffold and local development tooling. It is not yet ready for production use.

APIs, node parameters, credential structures, operations, and behavior may change before the first stable release.

## Contents

- [Installation](#installation)
- [Development](#development)
- [Operations](#operations)
- [Credentials](#credentials)
- [Compatibility](#compatibility)
- [Security](#security)
- [Contributing](#contributing)
- [Resources](#resources)
- [Trademark and Affiliation Notice](#trademark-and-affiliation-notice)
- [License](#license)

## Installation

The package has not yet been published as a stable npm release.

Once published, installation instructions will follow the official [n8n community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

Until then, the project should only be used for development and testing from source.

## Development

Development requires:

- Node.js 22.22.0 or later
- npm
- Git
- OpenSSL
- Access to a local n8n development environment
- Access to an SAP Business One Service Layer instance for integration testing

Clone the repository and install the dependencies:

```bash
git clone https://github.com/an-group/n8n-nodes-for-sap-business-one.git
cd n8n-nodes-for-sap-business-one
npm install
```

The main development commands are:

```bash
npm run build
npm run lint
npm run dev
npm pack --dry-run
```

For Service Layer webhook development, n8n must be reachable through HTTPS. The repository includes the platform-independent setup script:

```text
scripts/setup-local-n8n.mjs
```

It reads the local configuration, determines the configured IPv4 address, creates the `cert/` directory, generates a self-signed certificate, and writes the required n8n settings to `.env.local`.

Create the local configuration from the provided example:

```bash
cp .local-development.example.env .local-development.env
```

PowerShell:

```powershell
Copy-Item .local-development.example.env .local-development.env
```

Adjust `.local-development.env` for your network interface, subnet, IP address, port, and OpenSSL installation.

Then start the local HTTPS development environment:

```bash
npm run dev:local
```

This command prepares the local HTTPS configuration and starts n8n.

To generate only the certificate and `.env.local` without starting n8n, run:

```bash
npm run setup:local
```

The following generated files and directories are local development artifacts and must not be committed:

```text
.env.local
.local-development.env
cert/
```

Self-signed certificates are intended for local development only. Production environments should use a stable hostname and a trusted certificate.

## Operations

The current scaffold contains a temporary test operation that verifies that the node can be built, loaded, and executed in n8n.

The planned Service Layer operations include:

- Get entity collection
- Get entity by key
- Create entity
- Update entity
- Delete entity
- Custom Service Layer request
- OData query options
- Structured SAP Business One error handling
- Session handling
- Webhook and event integration

These operations are planned and may not yet be available in the current development version.

## Credentials

The SAP Business One Service Layer credential is available to the Service Layer node.

It contains the following fields:

- **Base URL** — Service Layer endpoint without a trailing slash, for example `https://server:50000/b1s/v2`
- **User Name** — SAP Business One user name
- **Password** — SAP Business One user password, stored as a protected n8n credential field
- **Company Database** — company database name, for example `SBODEMOEN`
- **Allow Unauthorized Certificates** — accepts self-signed or otherwise untrusted TLS certificates. Disabled by default and intended only for development environments.

Credentials are stored using the n8n credential system.

The credential test authenticates against the Service Layer `/Login` endpoint using the configured base URL, company database, user name, and password. It honours the `Allow Unauthorized Certificates` setting and reports authentication and connection errors without exposing credential values.

Every credential test opens a real Service Layer session. `/Login` is the only endpoint that can validate these credentials, an n8n credential test cannot chain a `/Logout` call, and SAP Business One sessions stay open until they time out (30 minutes by default) while counting against the licensed session limit. Repeatedly running the credential test against an instance with few available sessions will accumulate open sessions.

### Session handling

The package manages Service Layer sessions internally. It authenticates once per credential, caches the resulting session in memory, and reuses it for subsequent requests.

- The session is created with `POST /Login` and identified by the `B1SESSION` cookie. `ROUTEID` is preserved when the Service Layer returns one, and updated if a later response re-routes the session.
- The server-provided `SessionTimeout` is treated as an idle timeout, measured from the last successful request. No session lifetime is assumed when the Service Layer does not report one; such a session is only discarded once the Service Layer rejects it.
- Concurrent requests using the same credential share a single login instead of opening one licensed session each.
- A session that the Service Layer reports as invalid is discarded, and the failed request is retried once after a new login.
- Editing the credential replaces its cached session rather than leaving a stale one behind.
- Sessions are held per n8n process. In queue mode each worker keeps its own session, so one credential can hold up to one licensed session per worker. Sessions are not persisted across restarts.
- The session is never exposed as a node parameter, a credential field, or node output, and session cookies are kept out of logs and error messages.

Logout handling is not yet implemented. No node operation uses this session layer yet; it is the foundation for the planned Service Layer operations listed above.

Passwords, session cookies, and other secrets must not be included in workflow parameters, logs, issues, screenshots, or example data.

## Compatibility

The project is currently tested as a development scaffold.

Production compatibility with specific versions of the following components has not yet been established:

- n8n
- SAP Business One
- SAP Business One Service Layer
- SAP HANA
- Microsoft SQL Server
- Windows
- Linux
- macOS

A supported version matrix will be added before the first stable release.

## Security

Do not report security vulnerabilities through public GitHub issues.

Use the private reporting process described in [SECURITY.md](SECURITY.md).

Never include the following information in issues, discussions, logs, screenshots, or example workflows:

- SAP Business One passwords
- `B1SESSION` cookies
- `ROUTEID` cookies
- n8n credential values
- Internal URLs or hostnames
- Customer data
- Business partner data
- Document or invoice data
- Private certificates or keys

## Contributing

The project currently uses a closed contribution model.

Only authorized maintainers from ANG Schweiz AG may merge changes into the official repository.

External users may:

- Report reproducible bugs
- Request features
- Suggest documentation improvements
- Describe SAP Business One integration use cases
- Report security vulnerabilities privately

External pull requests are not currently accepted.

This contribution model may change in the future. See [CONTRIBUTING.md](CONTRIBUTING.md) for the current policy.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [n8n documentation](https://docs.n8n.io/)
- [SAP Business One documentation](https://help.sap.com/docs/SAP_BUSINESS_ONE)
- [Project security policy](SECURITY.md)
- [Contribution guidelines](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## Trademark and Affiliation Notice

This project is an independent, unofficial community integration and is not affiliated with, endorsed by, sponsored by, certified by, or otherwise associated with SAP SE, its affiliates, or n8n GmbH.

SAP, SAP Business One, and SAP Crystal Reports are trademarks or registered trademarks of SAP SE or its affiliates in Germany and other countries.

n8n is a trademark of n8n GmbH.

All other product names, trademarks, and registered trademarks are the property of their respective owners.

References to SAP products and n8n are made solely to describe compatibility and intended use.

No SAP or n8n logos, proprietary artwork, or other brand assets are included in this project.

## License

This project is licensed under the [MIT License](LICENSE).

Copyright © 2026 ANG Schweiz AG.

Project lead and maintainer: Markus Kistler.
