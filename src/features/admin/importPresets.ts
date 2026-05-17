export type ImportPreset = {
  key: string
  label: string
  resource: string
  requiredColumns: string[]
  template: string
}

const PRODUCT_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <product>
    <name>
      <language id="1">{{name}}</language>
    </name>
    <price>{{price}}</price>
    <reference>{{reference}}</reference>
    <active>{{active}}</active>
    <id_category_default>{{id_category_default}}</id_category_default>
  </product>
</prestashop>
`

const CATEGORY_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <category>
    <name>
      <language id="1">{{name}}</language>
    </name>
    <id_parent>{{id_parent}}</id_parent>
    <active>{{active}}</active>
  </category>
</prestashop>
`

const CUSTOMER_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <customer>
    <firstname>{{firstname}}</firstname>
    <lastname>{{lastname}}</lastname>
    <email>{{email}}</email>
    <passwd>{{passwd}}</passwd>
    <active>{{active}}</active>
  </customer>
</prestashop>
`

export const importPresets: ImportPreset[] = [
  {
    key: 'products-basic',
    label: 'Products (basic)',
    resource: 'products',
    requiredColumns: ['name', 'price'],
    template: PRODUCT_TEMPLATE,
  },
  {
    key: 'categories-basic',
    label: 'Categories (basic)',
    resource: 'categories',
    requiredColumns: ['name', 'id_parent'],
    template: CATEGORY_TEMPLATE,
  },
  {
    key: 'customers-basic',
    label: 'Customers (basic)',
    resource: 'customers',
    requiredColumns: ['firstname', 'lastname', 'email', 'passwd'],
    template: CUSTOMER_TEMPLATE,
  },
]

export function findPresetByKey(key: string): ImportPreset | undefined {
  return importPresets.find((p) => p.key === key)
}

export function findPresetForResource(resource: string): ImportPreset | undefined {
  const normalized = resource.trim().replace(/^\/+/, '')
  return importPresets.find((p) => p.resource === normalized)
}
