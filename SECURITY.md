# Security Policy

## Supported Versions

This project is under active development. Security updates are provided for the latest released version only.

| Version                         | Supported |
| ------------------------------- | --------- |
| Latest release                  | Yes       |
| Older releases                  | No        |
| Unreleased development branches | No        |

Users should update to the latest available version before reporting an issue that may already have been resolved.

## Reporting a Vulnerability

Do not report security vulnerabilities through public GitHub issues, discussions, pull requests, workflow logs, or other public channels.

Report vulnerabilities privately using one of the following methods:

1. Use GitHub Private Vulnerability Reporting or open a private repository security advisory under the repository's **Security** tab.
2. If private reporting is unavailable, contact the maintainers at `support@an-group.one`.

Include the following information where possible:

- A clear description of the vulnerability
- The affected package and version
- The affected node, credential type, operation, or helper
- Steps required to reproduce the issue
- A minimal proof of concept
- The expected and actual behavior
- The potential impact
- Relevant logs with all secrets and business data removed
- Any known mitigations or suggested fixes

Do not include real SAP Business One credentials, session cookies, access tokens, customer data, company databases, internal hostnames, private certificates, or other confidential information.

## Response Process

The maintainers will make a reasonable effort to:

- Acknowledge the report within five business days
- Confirm whether the issue is within scope
- Investigate and assess the impact
- Coordinate remediation and disclosure with the reporter
- Publish a security advisory when appropriate
- Release a patched version when a fix is available

Response and remediation times depend on severity, complexity, reproducibility, and maintainer availability. No guaranteed service-level agreement is provided.

Please keep vulnerability details confidential until the maintainers have released a fix or agreed to public disclosure.

## Scope

Security issues that may be in scope include:

- Exposure of SAP Business One usernames, passwords, session cookies, or other secrets
- Credentials or sensitive values written to logs, execution output, error messages, or telemetry
- Authentication or authorization bypasses
- Unsafe handling of `B1SESSION`, `ROUTEID`, or related session data
- Requests sent to unintended hosts
- Server-side request forgery caused by insufficient URL validation
- TLS or certificate-validation behavior that is insecure or misleading
- Injection vulnerabilities in URLs, OData queries, headers, request bodies, or error handling
- Leakage of SAP Business One business data across executions or credentials
- Insecure temporary-file or attachment handling
- Dependency or supply-chain vulnerabilities that are exploitable through this package
- Published npm artifacts containing secrets, private files, source maps with sensitive content, or unintended development files
- GitHub Actions or release-workflow weaknesses that could compromise published packages

## Out of Scope

The following are generally outside the scope of this policy:

- Vulnerabilities in SAP Business One, the SAP Business One Service Layer, n8n, Node.js, npm, or third-party dependencies that are not caused or made exploitable by this project
- Security issues caused exclusively by unsupported, outdated, or incorrectly configured third-party software
- Misconfigured SAP Business One permissions, users, networks, certificates, firewalls, or reverse proxies
- Use of the option to allow unauthorized or self-signed TLS certificates when the user has explicitly enabled it
- Reports that require access to credentials or infrastructure already controlled by the attacker
- Social engineering, phishing, physical attacks, or denial-of-service testing against systems not owned by the reporter
- Automated scanner reports without a reproducible security impact
- Missing security headers on documentation or development-only services without a demonstrated impact
- Feature requests, general hardening suggestions, and non-security bugs

Out-of-scope reports may still be reviewed as normal bug reports or improvement proposals, provided they contain no confidential information.

## Safe Testing

Only test against systems and data that you own or are explicitly authorized to access.

Do not:

- Access, modify, delete, or exfiltrate third-party data
- Disrupt SAP Business One, n8n, network, or production services
- Perform denial-of-service or high-volume testing
- Retain confidential data obtained during testing
- Publish vulnerability details before coordinated disclosure

Stop testing and report the issue immediately if you encounter personal data, customer data, credentials, session information, or other confidential material.

## Security Considerations for Users

Users are responsible for securely configuring and operating their environments. In particular:

- Apply least-privilege permissions to SAP Business One users
- Use dedicated integration users instead of personal accounts
- Restrict network access to the SAP Business One Service Layer
- Use valid TLS certificates in production
- Enable acceptance of unauthorized certificates only in controlled environments
- Protect n8n credentials and encryption keys
- Avoid exposing n8n editors, webhooks, or APIs directly to untrusted networks
- Review workflow execution data and logs for sensitive information
- Keep n8n, Node.js, this package, and dependencies updated
- Validate untrusted input before using it in entity keys, OData expressions, URLs, headers, or request bodies
- Review community nodes before installing or updating them

## Secret Handling

The project must never intentionally log or expose:

- Passwords
- SAP Business One session cookies
- Authentication headers
- n8n credential values
- Private keys or certificates
- npm or GitHub tokens
- Customer or business data not required for the node output

Reports, tests, fixtures, screenshots, and examples must use synthetic or sanitized data.

If a secret is accidentally exposed, revoke or rotate it immediately. Removing it from Git history alone is not sufficient.

## Disclosure and Advisories

Confirmed vulnerabilities may be documented through a GitHub security advisory and, where applicable, assigned a CVE.

Security releases may contain limited technical detail until users have had a reasonable opportunity to update. Credit will be given to reporters who request it, unless legal, privacy, or operational constraints prevent attribution.

## No Warranty

Security reports are handled on a best-effort basis. This policy does not create a warranty, support agreement, service-level commitment, or obligation beyond the terms of the project's license.
