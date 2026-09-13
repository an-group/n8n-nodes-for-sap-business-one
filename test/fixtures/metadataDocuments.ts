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
