# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-11-03

### Changed

- The npm package no longer contains the TypeScript build info file (`dist/tsconfig.tsbuildinfo`), which made up about half of its unpacked size.

### Fixed

- The README links ANG Schweiz AG to its working website.

## [0.1.0] - 2026-11-03

First public release. Supports the SAP Business One Service Layer v2 API; see the README for limitations.

### Added

- SAP Business One Service Layer node with three resources (Entity Set, Service Operation, Custom API Call); entity sets, fields and operations are read from the connected company's metadata; usable as a tool for AI agents.
- Entity Set: Get, Get Many, Create, Update, Delete and Execute Action or Function, with composite keys, a filter built manually or as an OData expression, Select, Sort, Return All/Limit with automatic paging, nested collections such as `DocumentLines`, and Replace Collections on Update.
- Service Operation: Call unbound actions and functions with typed parameter fields.
- Custom API Call: any Service Layer endpoint, with custom request headers.
- Editor: searchable lists for entity sets and operations, SAP labels next to technical names, lists sorted alphabetically by label, enum dropdowns, time fields, and a background check that picks up new fields and tables.
- SAP Business One Service Layer API credential (base URL, user name, password, company database, an option to allow unauthorized certificates) with a login test.
- Session handling: one login per credential, session reuse and renewal, one retry after an expired session; passwords and session cookies never appear in output, logs or error messages.
- Example workflows in `examples/`.

[unreleased]: https://github.com/an-group/n8n-nodes-for-sap-business-one/compare/0.1.1...HEAD
[0.1.1]: https://github.com/an-group/n8n-nodes-for-sap-business-one/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/an-group/n8n-nodes-for-sap-business-one/releases/tag/0.1.0
