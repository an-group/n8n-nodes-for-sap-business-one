# Operations

Reference for the resources and operations of the SAP Business One Service Layer node. For an overview, see the [README](../README.md).

In n8n's nodes panel every operation appears as an action, grouped by resource: the six Entity Set actions (for example **Get many entities**), **Call service operation**, and **Send custom API request**.

## Entity Set

Pick the **Entity Set** from a searchable list (**From List**, the default) or enter its name (**By Name**, also as an expression), for example `Orders`.

The lists show the SAP Business One labels next to the technical names, as `Label (TechnicalName)`: `Sales Order (Orders)` in the Entity Set list, `Posting Date (DocDate)` in the field lists and the field mappers. The search in the Entity Set list matches both. The labels are the wording of the SAP Business One client, so they can differ from the technical name (`Goods Receipt PO (PurchaseDeliveryNotes)`). The node sends no language at login, so the labels come in the Service Layer's default language, English on the systems tested. Where the Service Layer has no label, or the labels cannot be loaded, the technical name is shown alone. The node always stores and sends the technical name, so a different label never changes a workflow.

These lists are sorted alphabetically by the text they show. Entries that do not start with a letter, such as `1099 Forms (Forms1099)` or `347 Operation Code (OperationCode347)`, come after all others, and numbers compare as numbers (`347` before `1099`). Key Fields keep the order of the metadata, and the parameters of an Action or Function the order of its signature; only a single complex parameter shown as its fields is sorted. A field mapper saved in a workflow keeps the field order it was saved with; **Refresh field list** in the mapper's menu shows the current order.

| Operation | What it does |
|---|---|
| **Get** | fetch one entity by its key, optionally only some of its fields |
| **Get Many** | fetch a collection, with `Return All`/`Limit`, and optionally a filter, a field selection, and a sort order |
| **Create** | create an entity |
| **Update** | update an entity by its key; returns the Service Layer answer, `{ "success": true, "statusCode": 204 }` for a successful update. The key and the fields sent stay available from the input item, for example `$('Previous Node').item.json` |
| **Delete** | delete an entity by its key; each deleted entity returns `{ "deleted": true }` |
| **Execute Action or Function** | call an action or function bound to one entity, for example closing an order (`Orders(45)/Close`) |

### Key Fields

Used by Get, Update, Delete, and Execute Action or Function.

- One input per key property, filled from the metadata and labelled with its SAP label and name: a single `Item No. (ItemCode)` field for `Items`, or `Item No. (ItemCode)`, `BP Code (CardCode)`, and `BP Catalog Number (Substitute)` for the three-part key of `AlternateCatNum`.
- Every key field is required; leaving one unset is rejected before any request is sent.

### Fields

Used by Create and Update: a field mapper listing the entity type's properties from the metadata. Pick the ones to send.

- **Collections** such as `Orders.DocumentLines` are JSON array fields, **single complex properties** such as `AddressExtension` JSON object fields. They are sent as nested JSON, so an order can be created together with its lines. Invalid JSON, or an object where an array is expected (and the reverse), fails with a clear error before any request is sent.
- **Enum fields** such as `BoYesNoEnum` are dropdowns listing the enum's members. The selected member name (`tYES`) is sent unchanged; an expression can still supply it.
- **Time-of-day fields** (`Edm.TimeOfDay`, for example `DocTime` or `StartTime`) are n8n time fields: a text input the editor checks for `hh:mm` or `hh:mm:ss`; n8n has no time picker. The value is sent unchanged. Verified against a live Service Layer: `08:30` is stored as `08:30:00`, a full timestamp keeps only its time, and a time zone (`10:00:00+01:00`) is ignored, not converted.
- Other fields keep their type. Fields left empty are not sent.
- **Create** also offers the key properties, since some entity sets need a key from you (`CardCode`) while others assign one (`DocEntry`).
- **Update** leaves the key properties out: the key is given in **Key Fields**, and the Service Layer cannot change it through an update.

### Update and collections

The Service Layer **merges** a collection sent in an update; it never replaces it. Observed against a live Service Layer with `Orders.DocumentLines`:

- a line with `LineNum` updates that line, and only the properties given
- lines **without** `LineNum` are matched **by position**: the first entry updates line 0, the second line 1, and so on; only entries beyond the existing lines are appended as new lines. Sending one corrected line without `LineNum` therefore changes line 0, not a new line
- lines missing from the array stay unchanged, and an empty array (`[]`) changes nothing — lines cannot be removed through Update
- a single complex property (`AddressExtension`) is merged field by field: sub-fields not sent keep their value

To replace collections instead, turn on **Replace Collections**. Update then sends the `B1S-ReplaceCollectionsOnPatch: true` request header, and the lines sent replace the existing ones — observed live both with and without other properties in the same update.

### Filter

Used by Get Many: which entities are returned (`$filter`). One of:

- **None** (the default) — no filter; all entities are returned.
- **Build Manually** — a **Must Match** setting and a list of **Conditions**, described below.
- **OData Expression** — a `$filter` expression entered yourself, described below.

Only the chosen mode is sent: conditions or an expression left over from switching modes, hidden in the editor, are ignored.

**Build Manually**

- **Must Match** decides whether all conditions must be met (**All Conditions**, AND, the default) or at least one (**Any Condition**, OR). It applies to the whole list.
- Each condition has a field, an operator, and a value. Only fields holding a single value are offered; collections such as `DocumentLines` are not.
- The operators follow the field's type from the metadata, the way n8n's Data Table node offers them:
  - text fields: Equal, Not Equal, Greater Than, Greater Than or Equal, Less Than, Less Than or Equal, Contains, Starts With, Ends With and their negations (Not Contains, …), and Is Empty / Is Not Empty (`eq null` / `ne null`)
  - number, date, and time fields: the comparisons and the empty checks
  - enum and boolean fields: Equal, Not Equal, and the empty checks only — on an enum the string functions would silently match nothing
- The value input follows the field's type too: enum fields such as `ItemType` get a dropdown of their members, date fields a date picker, all others a text input (times as `08:00:00`).
- Values are entered without quotes. The node quotes them by the field's type, never by how the value looks: strings, enum values, dates, and times in single quotes (a `CardCode` of `10001` stays a string), numbers bare and never in exponent form (`1.5e3` is sent as `1500`).
- Rejected before any request is sent: a value that is not a number on a number field, and Contains, Starts With, or Ends With on an enum field given by expression.
- Verified live: Contains, Starts With, and Ends With are case-sensitive, and dates are compared by day only — the time and time zone of `2026-02-25T10:00:00+01:00` are ignored.

**OData Expression**

- Sent as entered, for example `DocTotal gt 1000 and startswith(CardCode,'C')`.
- Use it for mixed AND/OR and grouping, for example `(CardType eq 'cCustomer' or CardType eq 'cLid') and CurrentAccountBalance gt 1000`.
- Strings and enum values go in single quotes (`CardType eq 'cCustomer'`), with a quote inside doubled (`'O''Brien'`); numbers go without (`DocTotal gt '1000'` is rejected). Dates work quoted (`DocDate ge '2026-01-01'`).
- Supported: `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `and`, `or`, `not`, parentheses, `contains`, `startswith`, `endswith`; see [Query Options](https://help.sap.com/docs/SAP_BUSINESS_ONE/f110a154dd0f4c20bf7f3ebca9eeb794/3e5b7d980d99493f9271847450a927ef.html) in the SAP Business One Service Layer documentation.
- The node does not check the expression; a mistake fails with the Service Layer's own message.

### Select and Sort

- **Select Field Names or IDs** (Get, Get Many) — return only these properties (`$select`), picked from the metadata. It sits below **Key Fields** on Get and below **Limit** on Get Many. Collections and complex properties such as `DocumentLines` can be picked too and come back in full. Without a choice, all properties are returned, and that is a lot: one order has over 250 fields. Pick only the fields you need. An expression may give a list or a comma-separated string. The Service Layer still adds `@odata.etag` to each row.
- **Sort** (Get Many) — one or more fields with a direction (`$orderby`), applied in the order given. Only single-value properties are offered. Like n8n's own nodes (Airtable Search), Sort is a list of its own below the other parameters.

Filter, Select, and Sort values are percent-encoded, so `&`, `#`, and `%` inside a filter value are safe. For `$expand`, `$apply` (aggregation, grouping), or `$crossjoin`, use **Custom API Call**.

### Get Many pagination

The Service Layer returns 20 rows per page by default, however many match. Get Many asks for the page size it actually needs (`Limit`, or unlimited for `Return All`) with the `Prefer: odata.maxpagesize` request header, which normally returns everything in one request. The server's own pagination (`@odata.nextLink`) is still followed if a very large result is split across pages anyway. Verified live: the next link keeps `$select`, `$filter`, and `$orderby`, so every page is filtered, reduced, and sorted alike.

### Execute Action or Function

Calls an action or function bound to one entity of the selected entity set, identified through **Key Fields** (simple and composite keys).

- **Action or Function** — a searchable list of the operations bound to the selected entity set's entity type, with the kind in the label, for example `Close (Action)` or `List (Function)`. Names such as `Close` exist for many entity types; the list only offers the selected one's own. **By Name** takes the bare name instead, for example `Close`.
- **Parameters** — the operation's parameters, handled exactly as for [Service Operation](#service-operation). Almost every bound operation takes none; the mapper then says so.

Actions are sent as `POST /<EntitySet>(<key>)/<Action>`, with the parameters as a JSON body or no body when there are none. Functions are sent as `GET /<EntitySet>(<key>)/<Function>` without parentheses, with their parameters as query options written as OData literals (`?Name=value`): the Service Layer rejects bound function calls with parentheses.

`SQLQueries` `List` is the exception: its declared `ParamList` parameter is not accepted by the Service Layer under that name. Enter the stored query's own parameters there instead, as `name=value` pairs separated by `&`, with string values in single quotes and quotes inside them doubled — for example `code='C20000'&minTotal=100` for a query declaring `:code` and `:minTotal`. Each pair is sent as a query option of its own. A value containing `&` cannot be expressed this way; use **Custom API Call** for that query.

The output follows the [Custom API Call](#custom-api-call) convention.

## Service Operation

Calls an unbound action or function from the connected instance's metadata, without building the URL or request body yourself.

- **Service Operation** — a searchable list of every unbound action and function. The label shows the kind, for example `CompanyService_GetCompanyInfo (Function)` or `QueryService_PostQuery (Action)`, and the search matches it too; the node picks the HTTP method from the metadata. **By Name** takes the bare name instead, for example `CompanyService_GetCompanyInfo`.
- **Parameters** — a field mapper for the selected operation's parameters:
  - Most actions take exactly one complex or entity parameter, for example `SeriesService_GetDocumentSeries(DocumentTypeParams)` or `…_ApproveAndAdd(Document)`. For these, the mapper lists that type's properties as individual fields, handled like the [Fields](#fields) of Create. The values are sent wrapped under the parameter name, for example `{ "DocumentTypeParams": { "Document": "17" } }` — verified against a live Service Layer.
  - Every other operation gets one field per parameter: simple parameters a field of the matching type, enum parameters a dropdown of their members, time-of-day parameters (`Edm.TimeOfDay`) a time field, complex parameters a JSON object field, and collection parameters (`Collection(...)`) a JSON array field.
  - To pass a whole structured parameter as one JSON value, for example from an expression, use **Custom API Call**.
- Every parameter is optional, because the Service Layer metadata marks none of them as required; a missing value is reported by the Service Layer itself.
- Fields left empty are not sent. When every field of an expanded parameter is empty, the action is sent without a body, which the Service Layer treats like an empty object.
- Invalid JSON, or JSON of the wrong shape, fails with a clear error before any request is sent. An expression that resolves to an object or array is used as-is.

Actions are sent as `POST /<Action>` with the parameters as a JSON body, or no body when there are none. Functions are sent as `GET /<Function>(Name=value,...)`, with every value written as an OData literal of its declared type (strings quoted and escaped, numbers unquoted); a function without values is called as `/<Function>()`. A function parameter of a complex type cannot be written into the URL and is rejected; no function in the Service Layer metadata declares one.

The output follows the [Custom API Call](#custom-api-call) convention.

## Custom API Call

An escape hatch for Service Layer endpoints the guided operations do not cover yet. Requests go through the same authenticated request layer as the other resources, so login, `B1SESSION` reuse, expired-session retry, the TLS certificate setting, and error handling behave identically.

- **Method** — `DELETE`, `GET`, `PATCH`, `POST`, or `PUT`.
- **Endpoint** — a path relative to the credential's Base URL; the `/b1s/v2` API root is added automatically and a missing leading slash is added for you. Query parameters go directly into the endpoint. For example:

  ```text
  /Orders(45)
  /Orders?$top=10&$orderby=DocEntry desc
  /Orders(45)/Close
  /CompanyService_GetCompanyInfo()
  ```

  The following are rejected before any request or login is made:
  - absolute or protocol-relative URLs (`https://…`, `//host/…`, or any other `scheme:`), so the session cookie is never sent to another server
  - `..` path segments, including percent-encoded ones, so the call cannot leave the Service Layer API path
  - the `Login` and `Logout` endpoints, because the node manages the session itself — a custom login would put a session ID in the output, and a custom logout would end the session shared by every execution using the credential
- **JSON Body** (`POST`, `PATCH`, `PUT` only) — optional. Leave it empty to send no body. It must be a JSON object or array; invalid JSON fails with a clear error before any request is sent. An expression that resolves to an object is used as-is.
- **Options → Headers** — optional additional HTTP headers as name/value pairs, for example `B1S-ReplaceCollectionsOnPatch: true` for a `PATCH` that replaces a collection. Rows without a name are skipped. The `Cookie` header carries the node's session and cannot be set; an invalid header name, a name given twice (in any letter case), or a value with a line break fails with a clear error before any request is sent.

Each input item produces one output item:

- an object response is returned unchanged — collection responses (`{ "value": [...] }`) are **not** split into separate items and are **not** paginated; follow `@odata.nextLink` yourself if needed
- an empty response (for example `204 No Content` from `PATCH`, `DELETE`, or an action) returns `{ "success": true, "statusCode": 204 }`
- any other response (plain text, XML, or a top-level array) is returned under `data`

A structured query builder and file or binary uploads are not supported. Response headers are never returned, so session cookies cannot appear in the output.
