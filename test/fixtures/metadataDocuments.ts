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
 * mapper field list filters down to empty. `TimeSlots` is synthetic: no real
 * key is `Edm.TimeOfDay`, but `Key Fields` must keep their own mapping.
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
        <Property Name="StartTime" Type="Edm.TimeOfDay"/>
      </EntityType>

      <EntityType Name="LineContainer" OpenType="true">
        <Property Name="Lines" Type="Collection(SAPB1.DocumentLine)"/>
      </EntityType>

      <EntityType Name="TimeSlot" OpenType="true">
        <Key>
          <PropertyRef Name="Slot"/>
        </Key>
        <Property Name="Slot" Nullable="false" Type="Edm.TimeOfDay"/>
      </EntityType>

      <EntityContainer Name="SAPB1">
        <EntitySet EntityType="SAPB1.FieldType" Name="FieldTypes"/>
        <EntitySet EntityType="SAPB1.LineContainer" Name="LineContainers"/>
        <EntitySet EntityType="SAPB1.TimeSlot" Name="TimeSlots"/>
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

/**
 * `ComplexType` and `EnumType` declarations, kept as a bare fragment so a test
 * can splice them into `SYNTHETIC_EDMX_V4` and prove the entity and operation
 * output does not change.
 *
 * Mirrors what a real Service Layer document contains: complex types with and
 * without `OpenType`, one self-closing complex type with no properties, and
 * `Event` declared twice (here with differing bodies, so the test can tell
 * which declaration is kept). Attribute order varies on purpose.
 *
 * The real document has no flags enum, no member-less enum and no enum
 * declared twice; `BoPermissionFlags`, `EmptyEnum` and the second `BoStatus`
 * cover them anyway. `BoStatus` lists `bost_Close` before `bost_Open` to
 * prove that members keep their declaration order.
 */
export const COMPLEX_AND_ENUM_TYPE_DECLARATIONS = `
      <ComplexType Name="DocumentLine">
        <Property Name="ItemCode" Type="Edm.String"/>
        <Property Name="LineNum" Nullable="false" Type="Edm.Int32"/>
        <Property Name="Quantity" Type="Edm.Double"/>
        <Property Name="TaxOnly" Type="SAPB1.BoYesNoEnum"/>
        <Property Name="Address" Type="SAPB1.AddressExtension"/>
        <Property Name="LineTaxJurisdictions" Type="Collection(SAPB1.LineTaxJurisdiction)"/>
      </ComplexType>
      <ComplexType OpenType="true" Name="AddressExtension">
        <Property Type="Edm.String" Name="ShipToStreet"/>
        <Property Type="Edm.String" Nullable="false" Name="BillToCity"/>
      </ComplexType>
      <ComplexType Name="LineTaxJurisdiction" OpenType="true">
        <Property Name="JurisdictionCode" Type="Edm.String"/>
      </ComplexType>
      <ComplexType Name="DocumentDistributedExpense"/>
      <ComplexType Name="Event">
        <Property Name="WebhookID" Type="Edm.String"/>
      </ComplexType>
      <ComplexType Name="Event">
        <Property Name="SecondDeclaration" Type="Edm.String"/>
      </ComplexType>
      <EnumType IsFlags="false" Name="BoYesNoEnum" UnderlyingType="Edm.Int32">
        <Member Name="tNO" Value="0"/>
        <Member Name="tYES" Value="1"/>
      </EnumType>
      <EnumType Name="BoStatus" UnderlyingType="Edm.Int32" IsFlags="false">
        <Member Name="bost_Close" Value="1"/>
        <Member Value="0" Name="bost_Open"/>
      </EnumType>
      <EnumType Name="BoStatus" UnderlyingType="Edm.Int32" IsFlags="false">
        <Member Name="SecondDeclaration" Value="0"/>
      </EnumType>
      <EnumType IsFlags="true" Name="BoPermissionFlags" UnderlyingType="Edm.Int32">
        <Member Name="pfRead" Value="1"/>
        <Member Name="pfWrite" Value="2"/>
      </EnumType>
      <EnumType Name="EmptyEnum" UnderlyingType="Edm.Int32"/>
`;

/** `SYNTHETIC_EDMX_V4` with `COMPLEX_AND_ENUM_TYPE_DECLARATIONS` spliced in ahead of the container. */
export const EDMX_COMPLEX_AND_ENUM_TYPES = SYNTHETIC_EDMX_V4.replace(
	'      <EntityContainer Name="SAPB1">',
	`${COMPLEX_AND_ENUM_TYPE_DECLARATIONS}\n      <EntityContainer Name="SAPB1">`,
);

/**
 * One entity type with every property shape the Create/Update `Fields` mapper
 * distinguishes: primitive, enum, single complex (`AddressExtension`), complex
 * collection (`DocumentLines`, as on `Orders`), plus shapes the real Service
 * Layer document does not use on entity types but the classifier still has to
 * place — an entity-typed property, a primitive collection, a type the
 * document never declares, a flags enum and an enum without members.
 * `KeyOnly` has nothing left to set on Update.
 */
export const EDMX_STRUCTURED_PROPERTIES = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="SAPB1" xmlns="http://docs.oasis-open.org/odata/ns/edm">

      <EntityType Name="Document" OpenType="true">
        <Key>
          <PropertyRef Name="DocEntry"/>
        </Key>
        <Property Name="DocEntry" Nullable="false" Type="Edm.Int32"/>
        <Property Name="CardCode" Type="Edm.String"/>
        <Property Name="DocumentStatus" Type="SAPB1.BoStatus"/>
        <Property Name="DocTime" Type="Edm.TimeOfDay"/>
        <Property Name="AddressExtension" Type="SAPB1.AddressExtension"/>
        <Property Name="DocumentLines" Type="Collection(SAPB1.DocumentLine)"/>
        <Property Name="Approver" Type="SAPB1.Employee"/>
        <Property Name="Tags" Type="Collection(Edm.String)"/>
        <Property Name="Mystery" Type="SAPB1.Undeclared"/>
        <Property Name="Permissions" Type="SAPB1.BoPermissionFlags"/>
        <Property Name="Placeholder" Type="SAPB1.EmptyEnum"/>
      </EntityType>

      <EntityType Name="Employee" OpenType="true">
        <Key>
          <PropertyRef Name="EmployeeID"/>
        </Key>
        <Property Name="EmployeeID" Nullable="false" Type="Edm.Int32"/>
      </EntityType>

      <EntityType Name="KeyOnly" OpenType="true">
        <Key>
          <PropertyRef Name="Code"/>
        </Key>
        <Property Name="Code" Nullable="false" Type="Edm.String"/>
      </EntityType>

      <ComplexType Name="DocumentLine">
        <Property Name="ItemCode" Type="Edm.String"/>
        <Property Name="LineNum" Nullable="false" Type="Edm.Int32"/>
        <Property Name="Quantity" Type="Edm.Double"/>
      </ComplexType>
      <ComplexType OpenType="true" Name="AddressExtension">
        <Property Type="Edm.String" Name="ShipToStreet"/>
      </ComplexType>
      <EnumType IsFlags="false" Name="BoStatus" UnderlyingType="Edm.Int32">
        <Member Name="bost_Open" Value="0"/>
        <Member Name="bost_Close" Value="1"/>
      </EnumType>
      <EnumType IsFlags="true" Name="BoPermissionFlags" UnderlyingType="Edm.Int32">
        <Member Name="pfRead" Value="1"/>
        <Member Name="pfWrite" Value="2"/>
      </EnumType>
      <EnumType Name="EmptyEnum" UnderlyingType="Edm.Int32"/>

      <EntityContainer Name="SAPB1">
        <EntitySet EntityType="SAPB1.Document" Name="Orders"/>
        <EntitySet EntityType="SAPB1.KeyOnly" Name="KeyOnlys"/>
      </EntityContainer>

    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`;

/**
 * Operations whose parameters are declared complex, entity, and enum types,
 * for expanding a single structured parameter into individual fields. Modelled
 * on the real Service Layer: most unbound Actions take exactly one complex
 * (`BankStatementParams`) or entity (`SAPB1.Document`) parameter. `Document`
 * has no entity set on purpose — operation parameters reference entity types
 * directly. `MergeService_Merge` (two complex parameters), `BatchService_PostLines`
 * (a collection), and `EmptyService_Run` (a type without properties) keep one
 * field per parameter. `ReportService_GetReport` is a synthetic function: no
 * real function takes a complex parameter.
 */
export const EDMX_EXPANDED_PARAMETERS = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="SAPB1" xmlns="http://docs.oasis-open.org/odata/ns/edm">

      <EnumType Name="BoStatus">
        <Member Name="bost_Open" Value="0"/>
        <Member Name="bost_Close" Value="1"/>
      </EnumType>

      <ComplexType Name="BankStatementParams">
        <Property Name="BankAccountKey" Type="Edm.Int32"/>
        <Property Name="StatementDate" Type="Edm.DateTimeOffset"/>
        <Property Name="StatementTime" Type="Edm.TimeOfDay"/>
        <Property Name="Status" Type="SAPB1.BoStatus"/>
        <Property Name="Address" Type="SAPB1.AddressExtension"/>
        <Property Name="Lines" Type="Collection(SAPB1.StatementLine)"/>
      </ComplexType>
      <ComplexType Name="AddressExtension">
        <Property Name="Street" Type="Edm.String"/>
      </ComplexType>
      <ComplexType Name="StatementLine">
        <Property Name="Amount" Type="Edm.Double"/>
      </ComplexType>
      <ComplexType Name="EmptyParams"/>

      <EntityType Name="Document" OpenType="true">
        <Key>
          <PropertyRef Name="DocEntry"/>
        </Key>
        <Property Name="DocEntry" Nullable="false" Type="Edm.Int32"/>
        <Property Name="CardCode" Type="Edm.String"/>
      </EntityType>

      <EntityType Name="BankPage" OpenType="true">
        <Key>
          <PropertyRef Name="Sequence"/>
        </Key>
        <Property Name="Sequence" Nullable="false" Type="Edm.Int32"/>
      </EntityType>

      <Action Name="BankStatementsService_GetBankStatementList">
        <Parameter Name="BankStatementParams" Type="SAPB1.BankStatementParams"/>
        <ReturnType Type="Collection(SAPB1.BankStatementParams)"/>
      </Action>

      <Action Name="DocumentsService_Preview">
        <Parameter Name="Document" Type="SAPB1.Document"/>
      </Action>

      <Action Name="MergeService_Merge">
        <Parameter Name="Source" Type="SAPB1.BankStatementParams"/>
        <Parameter Name="Target" Type="SAPB1.BankStatementParams"/>
      </Action>

      <Action Name="BatchService_PostLines">
        <Parameter Name="Lines" Type="Collection(SAPB1.StatementLine)"/>
      </Action>

      <Action Name="EmptyService_Run">
        <Parameter Name="Params" Type="SAPB1.EmptyParams"/>
      </Action>

      <Action Name="StatusService_SetStatus">
        <Parameter Name="Code" Type="Edm.String"/>
        <Parameter Name="Status" Type="SAPB1.BoStatus"/>
        <Parameter Name="EffectiveAt" Type="Edm.TimeOfDay"/>
      </Action>

      <Function Name="ReportService_GetReport">
        <Parameter Name="ReportParams" Type="SAPB1.BankStatementParams"/>
      </Function>

      <Action IsBound="true" Name="Reconcile">
        <Parameter Name="BankPageParams" Type="SAPB1.BankPage"/>
        <Parameter Name="BankStatementParams" Type="SAPB1.BankStatementParams"/>
      </Action>

      <EntityContainer Name="SAPB1">
        <EntitySet EntityType="SAPB1.BankPage" Name="BankPages"/>
        <ActionImport Action="SAPB1.BankStatementsService_GetBankStatementList" Name="BankStatementsService_GetBankStatementList"/>
        <ActionImport Action="SAPB1.DocumentsService_Preview" Name="DocumentsService_Preview"/>
        <ActionImport Action="SAPB1.MergeService_Merge" Name="MergeService_Merge"/>
        <ActionImport Action="SAPB1.BatchService_PostLines" Name="BatchService_PostLines"/>
        <ActionImport Action="SAPB1.EmptyService_Run" Name="EmptyService_Run"/>
        <ActionImport Action="SAPB1.StatusService_SetStatus" Name="StatusService_SetStatus"/>
        <FunctionImport Function="SAPB1.ReportService_GetReport" Name="ReportService_GetReport"/>
      </EntityContainer>

    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`;
