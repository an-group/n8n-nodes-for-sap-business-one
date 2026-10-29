/**
 * Hand-written, synthetic EDMX documents.
 *
 * They are TypeScript template strings rather than `.xml` files on purpose:
 * loading a file would need `__dirname` (banned by the shared ESLint config's
 * `no-restricted-globals`) and `import.meta.url` fails `tsc` with TS1343 under
 * this project's `"module": "commonjs"`. A fixture named `metadata.xml` would
 * also be swallowed by `.gitignore`, whose bare pattern matches at any depth.
 *
 * Element shapes and attribute order mirror a real Service Layer `/$metadata`
 * response — `EntityType` before `Name`, `<Key>` ahead of the `<Property>`
 * declarations, key properties not declared first — because the parser is
 * regex-based and those details are exactly what it has to cope with. No
 * customer data appears here; see SECURITY.md.
 */
export const SYNTHETIC_EDMX_V4 = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="SAPB1" xmlns="http://docs.oasis-open.org/odata/ns/edm">

      <EntityType Name="Order" OpenType="true">
        <Key>
          <PropertyRef Name="DocEntry"/>
        </Key>
        <Property Name="CardCode" Type="Edm.String"/>
        <Property Name="DocEntry" Nullable="false" Type="Edm.Int32"/>
        <Property Name="DocTotal" Type="Edm.Double"/>
        <Property Name="DocumentLines" Type="Collection(SAPB1.DocumentLine)"/>
      </EntityType>

      <EntityType Name="SalesTaxAuthority" OpenType="true">
        <Key>
          <PropertyRef Name="Type"/>
          <PropertyRef Name="Code"/>
        </Key>
        <Property Name="Rate" Type="Edm.Double"/>
        <Property Name="Type" Nullable="false" Type="Edm.Int32"/>
        <Property Name="Code" Nullable="false" Type="Edm.String"/>
      </EntityType>

      <EntityType Name="Item" OpenType="true">
        <Key>
          <PropertyRef Name="ItemCode"/>
        </Key>
        <Property Name="ItemCode" Nullable="false" Type="Edm.String"/>
        <Property Name="ItemName" Type="Edm.String"/>
        <Property Name="QuantityOnStock" Type="Edm.Double"/>
        <Property Name="Valid" Type="SAPB1.BoYesNoEnum"/>
      </EntityType>

      <EntityType Name="Ghost" OpenType="true">
        <Key>
          <PropertyRef Name="Missing"/>
        </Key>
        <Property Name="Present" Type="Edm.String"/>
      </EntityType>

      <EntityType Name="Report" OpenType="true">
        <Property Name="Title" Type="Edm.String"/>
      </EntityType>

      <Action IsBound="true" Name="Close">
        <Parameter Name="OrderParams" Type="SAPB1.Order"/>
      </Action>

      <Function IsBound="true" Name="GetOrderStatus">
        <Parameter Name="OrderParams" Type="SAPB1.Order"/>
        <Parameter Name="IncludeHistory" Nullable="false" Type="Edm.Boolean"/>
        <ReturnType Type="Edm.String"/>
      </Function>

      <Function Name="CompanyService_GetCompanyInfo">
        <Parameter Name="CompanyCode" Type="Edm.String"/>
        <ReturnType Type="SAPB1.CompanyInfo"/>
      </Function>

      <Action Name="QueryService_PostQuery">
        <Parameter Name="QueryOption" Type="Edm.String"/>
      </Action>

      <EntitySet EntityType="SAPB1.Report" Name="OutsideContainer"/>

      <EntityContainer Name="SAPB1">
        <EntitySet EntityType="SAPB1.Order" Name="Orders"/>
        <EntitySet EntityType="SAPB1.SalesTaxAuthority" Name="SalesTaxAuthorities"/>
        <EntitySet EntityType="SAPB1.Item" Name="Items"/>
        <EntitySet EntityType="SAPB1.Ghost" Name="Ghosts"/>
        <EntitySet EntityType="SAPB1.Report" Name="Reports"/>
        <FunctionImport Function="SAPB1.CompanyService_GetCompanyInfo" Name="CompanyService_GetCompanyInfo"/>
        <ActionImport Action="SAPB1.QueryService_PostQuery" Name="QueryService_PostQuery"/>
        <ActionImport Action="SAPB1.NoSuchAction" Name="DanglingImport"/>
      </EntityContainer>

    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`;

/** The older Service Layer v1 API's metadata, which must be rejected outright. */
export const EDMX_V1 = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices>
    <Schema Namespace="SAPB1">
      <EntityType Name="Order">
        <Key>
          <PropertyRef Name="DocEntry"/>
        </Key>
        <Property Name="DocEntry" Nullable="false" Type="Edm.Int32"/>
      </EntityType>
      <EntityContainer Name="SAPB1">
        <EntitySet EntityType="SAPB1.Order" Name="Orders"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`;

/** No `Version` attribute at all on the root element. */
export const EDMX_NO_VERSION = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="SAPB1"/>
  </edmx:DataServices>
</edmx:Edmx>
`;

/** Valid version, but an entity set pointing at an entity type that is not declared. */
export const EDMX_BROKEN_ENTITY_SET = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="SAPB1">
      <EntityContainer Name="SAPB1">
        <EntitySet EntityType="SAPB1.NoSuchType" Name="Phantoms"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`;

/** Structurally valid, but carries nothing at all. */
export const EDMX_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
</edmx:Edmx>
`;

/**
 * An exhaustive EDM-type matrix, kept separate from `SYNTHETIC_EDMX_V4` so the
 * document 195 existing tests already assert against stays untouched.
 *
 * `FieldTypes` declares one property per EDM kind the resource mapper has to
 * classify. `LineContainers` has no `<Key>` block and nothing but a
 * collection-valued property, which is the only way to reach an entity whose
 * mapper field list filters down to empty.
 */
export const EDMX_FIELD_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="SAPB1" xmlns="http://docs.oasis-open.org/odata/ns/edm">

      <EntityType Name="FieldType" OpenType="true">
        <Key>
          <PropertyRef Name="Code"/>
        </Key>
        <Property Name="Code" Nullable="false" Type="Edm.String"/>
        <Property Name="Count" Type="Edm.Int32"/>
        <Property Name="Amount" Type="Edm.Double"/>
        <Property Name="Active" Type="Edm.Boolean"/>
        <Property Name="Ref" Type="Edm.Guid"/>
        <Property Name="DueDate" Type="Edm.DateTimeOffset"/>
        <Property Name="Valid" Type="SAPB1.BoYesNoEnum"/>
      </EntityType>

      <EntityType Name="LineContainer" OpenType="true">
        <Property Name="Lines" Type="Collection(SAPB1.DocumentLine)"/>
      </EntityType>

      <EntityContainer Name="SAPB1">
        <EntitySet EntityType="SAPB1.FieldType" Name="FieldTypes"/>
        <EntitySet EntityType="SAPB1.LineContainer" Name="LineContainers"/>
      </EntityContainer>

    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`;

/**
 * Unbound Actions and Functions covering every parameter shape the Service
 * Operation resource handles: none, simple (`Edm.*`), complex, and collection.
 * Kept separate from `SYNTHETIC_EDMX_V4` so the parser tests that pin that
 * document's operation count stay untouched. Declared in non-alphabetical
 * order, so a sorted dropdown can only come from the sort.
 */
export const EDMX_SERVICE_OPERATIONS = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="SAPB1" xmlns="http://docs.oasis-open.org/odata/ns/edm">

      <Function Name="SBOBobService_GetDueDate">
        <Parameter Name="CardCode" Type="Edm.String"/>
        <Parameter Name="RefDate" Type="Edm.String"/>
        <ReturnType Type="Edm.String"/>
      </Function>

      <Function Name="CompanyService_GetCompanyInfo">
        <ReturnType Type="SAPB1.CompanyInfo"/>
      </Function>

      <Function Name="RateService_GetRate">
        <Parameter Name="Factor" Type="Edm.Double"/>
        <ReturnType Type="Edm.Double"/>
      </Function>

      <Function Name="ReportService_GetReport">
        <Parameter Name="ReportParams" Type="SAPB1.ReportParams"/>
        <ReturnType Type="SAPB1.Report"/>
      </Function>

      <Action Name="SBOBobService_SetSystemPermission">
        <Parameter Name="UserCode" Type="Edm.String"/>
        <Parameter Name="PermissionID" Type="Edm.String"/>
        <Parameter Name="Permission" Type="Edm.Int32"/>
      </Action>

      <Action Name="BankStatementsService_GetBankStatementList">
        <Parameter Name="BankStatementParams" Type="SAPB1.BankStatementParams"/>
        <ReturnType Type="Collection(SAPB1.BankStatementParams)"/>
      </Action>

      <Action Name="BatchService_PostLines">
        <Parameter Name="Lines" Type="Collection(SAPB1.BatchLine)"/>
      </Action>

      <Action Name="CleanupService_Run"/>

      <EntityContainer Name="SAPB1">
        <FunctionImport Function="SAPB1.SBOBobService_GetDueDate" Name="SBOBobService_GetDueDate"/>
        <FunctionImport Function="SAPB1.CompanyService_GetCompanyInfo" Name="CompanyService_GetCompanyInfo"/>
        <FunctionImport Function="SAPB1.RateService_GetRate" Name="RateService_GetRate"/>
        <FunctionImport Function="SAPB1.ReportService_GetReport" Name="ReportService_GetReport"/>
        <ActionImport Action="SAPB1.SBOBobService_SetSystemPermission" Name="SBOBobService_SetSystemPermission"/>
        <ActionImport Action="SAPB1.BankStatementsService_GetBankStatementList" Name="BankStatementsService_GetBankStatementList"/>
        <ActionImport Action="SAPB1.BatchService_PostLines" Name="BatchService_PostLines"/>
        <ActionImport Action="SAPB1.CleanupService_Run" Name="CleanupService_Run"/>
      </EntityContainer>

    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`;

/**
 * Bound Actions and Functions, modelled on the real Service Layer's: `Close`
 * is declared for two entity types (the real schema has it on 11), every
 * shape of binding is present — simple key, composite key, string key — and
 * `List` reproduces `SQLQueries`' single `ParamList` string. `Reopen` and
 * `GetStatus` are synthetic: no real bound operation takes a simple parameter
 * besides `List`, but the request construction must still handle one.
 * `Warehouses` binds nothing. Kept separate so the parser tests pinned to
 * `SYNTHETIC_EDMX_V4` stay untouched.
 */
export const EDMX_BOUND_OPERATIONS = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="SAPB1" xmlns="http://docs.oasis-open.org/odata/ns/edm">

      <EntityType Name="Document" OpenType="true">
        <Key>
          <PropertyRef Name="DocEntry"/>
        </Key>
        <Property Name="DocEntry" Nullable="false" Type="Edm.Int32"/>
      </EntityType>

      <EntityType Name="StockTransfer" OpenType="true">
        <Key>
          <PropertyRef Name="DocEntry"/>
        </Key>
        <Property Name="DocEntry" Nullable="false" Type="Edm.Int32"/>
      </EntityType>

      <EntityType Name="SalesTaxAuthority" OpenType="true">
        <Key>
          <PropertyRef Name="Type"/>
          <PropertyRef Name="Code"/>
        </Key>
        <Property Name="Type" Nullable="false" Type="Edm.Int32"/>
        <Property Name="Code" Nullable="false" Type="Edm.String"/>
      </EntityType>

      <EntityType Name="SQLQuery" OpenType="true">
        <Key>
          <PropertyRef Name="SqlCode"/>
        </Key>
        <Property Name="SqlCode" Nullable="false" Type="Edm.String"/>
      </EntityType>

      <EntityType Name="Warehouse" OpenType="true">
        <Key>
          <PropertyRef Name="WarehouseCode"/>
        </Key>
        <Property Name="WarehouseCode" Nullable="false" Type="Edm.String"/>
      </EntityType>

      <Action IsBound="true" Name="Close">
        <Parameter Name="DocumentParams" Type="SAPB1.Document"/>
      </Action>
      <Action IsBound="true" Name="Cancel">
        <Parameter Name="DocumentParams" Type="SAPB1.Document"/>
      </Action>
      <Action IsBound="true" Name="Reopen">
        <Parameter Name="DocumentParams" Type="SAPB1.Document"/>
        <Parameter Name="Reason" Type="Edm.String"/>
        <Parameter Name="Options" Type="SAPB1.ReopenOptions"/>
      </Action>
      <Function IsBound="true" Name="GetStatus">
        <Parameter Name="DocumentParams" Type="SAPB1.Document"/>
        <Parameter Name="Depth" Type="Edm.Int32"/>
        <Parameter Name="Label" Type="Edm.String"/>
        <Parameter Name="Filter" Type="SAPB1.StatusFilter"/>
        <ReturnType Type="Edm.String"/>
      </Function>
      <Action IsBound="true" Name="Close">
        <Parameter Name="StockTransferParams" Type="SAPB1.StockTransfer"/>
      </Action>
      <Function IsBound="true" Name="Recalculate">
        <Parameter Name="SalesTaxAuthorityParams" Type="SAPB1.SalesTaxAuthority"/>
        <ReturnType Type="SAPB1.SalesTaxAuthority"/>
      </Function>
      <Function IsBound="true" Name="List">
        <Parameter Name="SQLQueryParams" Type="SAPB1.SQLQuery"/>
        <Parameter Name="ParamList" Type="Edm.String"/>
        <ReturnType Type="SAPB1.SQLQueryResult"/>
      </Function>

      <EntityContainer Name="SAPB1">
        <EntitySet EntityType="SAPB1.Document" Name="Orders"/>
        <EntitySet EntityType="SAPB1.StockTransfer" Name="StockTransfers"/>
        <EntitySet EntityType="SAPB1.SalesTaxAuthority" Name="SalesTaxAuthorities"/>
        <EntitySet EntityType="SAPB1.SQLQuery" Name="SQLQueries"/>
        <EntitySet EntityType="SAPB1.Warehouse" Name="Warehouses"/>
      </EntityContainer>

    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`;
