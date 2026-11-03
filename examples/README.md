# Example workflows

Workflows to import into n8n (**Import from File** in the workflow menu, or paste the file's content onto the canvas). After the import, select your Service Layer credential in each SAP Business One node.

| File | What it shows |
| --- | --- |
| [`read-open-sales-orders.json`](read-open-sales-orders.json) | Get Many with a manual filter, Select and Sort: the ten most recent open sales orders |
| [`create-and-update-business-partner.json`](create-and-update-business-partner.json) | Create, Update and Get of a customer, with values from an Edit Fields node |
| [`create-sales-order-and-close.json`](create-sales-order-and-close.json) | Create a sales order with three lines in `DocumentLines`, then the bound action `Close` |
| [`get-company-currencies.json`](get-company-currencies.json) | Two unbound service operations without parameters |
| [`ai-agent-customer-lookup.json`](ai-agent-customer-lookup.json) | The node as an AI agent tool, with `$fromAI()` in the filter and Select |

The sample values (`C20000`, `A00001` to `A00003`) are those of the SAP Business One demo company; replace them with codes of your company. The workflows that write create a business partner and a sales order, so run them against a test company.

## Walkthroughs

The values below are examples; the field names are those of the standard SAP Business One metadata.

### Read open orders

Get the ten most recent open sales orders, with only the fields needed.

- **Resource:** Entity Set · **Entity Set:** `Orders` · **Operation:** Get Many
- **Limit:** `10`
- **Select Field Names or IDs:** `DocEntry`, `DocNum`, `CardCode`, `DocDate`, `DocTotal`
- **Filter:** Build Manually, one condition: `DocumentStatus` · Equal · `bost_Open`
- **Sort:** `DocDate` · Descending

Request sent:

```text
GET /b1s/v2/Orders?$select=DocEntry,DocNum,CardCode,DocDate,DocTotal&$filter=DocumentStatus eq 'bost_Open'&$orderby=DocDate desc
Prefer: odata.maxpagesize=10
```

Output, one item per order:

```json
[
  { "@odata.etag": "W/\"…\"", "DocEntry": 45, "DocNum": 30, "DocDate": "2026-03-05T00:00:00Z", "CardCode": "C20000", "DocTotal": 2160 },
  { "@odata.etag": "W/\"…\"", "DocEntry": 44, "DocNum": 29, "DocDate": "2026-03-03T00:00:00Z", "CardCode": "C30000", "DocTotal": 1080 }
]
```

### Create a business partner

- **Resource:** Entity Set · **Entity Set:** `BusinessPartners` · **Operation:** Create
- **Fields:** `CardCode` = `C30001`, `CardName` = `Example Customer`, `CardType` = `cCustomer` (from the dropdown)

Request sent:

```text
POST /b1s/v2/BusinessPartners
{ "CardCode": "C30001", "CardName": "Example Customer", "CardType": "cCustomer" }
```

The output is the created business partner with all its fields, including the defaults SAP Business One filled in (several hundred fields).

To create a sales order together with its lines, use the `Orders` entity set and enter the lines in the **DocumentLines** field as a JSON array, for example `[{ "ItemCode": "A00001", "Quantity": 1, "Price": 10 }]`.

### Close an order

- **Resource:** Entity Set · **Entity Set:** `Orders` · **Operation:** Execute Action or Function
- **Key Fields:** `DocEntry` = `45`, or an expression such as `{{ $json.DocEntry }}` to close the order a previous node returned
- **Action or Function:** `Close (Action)`

Request sent:

```text
POST /b1s/v2/Orders(45)/Close
```

The Service Layer answers `204 No Content`, so the output is:

```json
{ "success": true, "statusCode": 204 }
```

### Get company information

- **Resource:** Service Operation · **Service Operation:** `CompanyService_GetCompanyInfo (Function)`
- **Parameters:** none

Request sent:

```text
GET /b1s/v2/CompanyService_GetCompanyInfo()
```

Output, one item with the company settings, shortened:

```json
{ "Version": 1000340, "CompanyName": "Example Company", "LanguageCode": "ln_English", "Localization": "CH" }
```
