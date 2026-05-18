import bcrypt from 'bcryptjs'
import type { WsConfig } from '../../shared/http/prestashopWebserviceClient'
import { wsRequest } from '../../shared/http/prestashopWebserviceClient'
import { parseXml } from '../../shared/xml/xml'

type EmployeeUser = {
  id: string
  email: string
  firstname: string
  lastname: string
  passwd: string
  active: boolean
}

type CustomerUser = {
  id: string
  email: string
  firstname: string
  lastname: string
  passwd: string
  active: boolean
}

const ADMIN_KEY = 'newapp.adminUser.v1'
const CUSTOMER_KEY = 'newapp.customerUser.v1'

function nodeText(value: any): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    if (typeof value['#text'] === 'string' || typeof value['#text'] === 'number') return String(value['#text'])
    if (typeof value[''] === 'string' || typeof value[''] === 'number') return String(value[''])
  }
  return ''
}

function getBoolean(value: any): boolean {
  const normalized = nodeText(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function normalizeHash(psHash: string): string {
  return psHash.replace(/^\$2y\$/, '$2a$')
}

async function fetchEmployeeByEmail(config: WsConfig, email: string): Promise<EmployeeUser | null> {
  const res = await wsRequest(config, {
    method: 'GET',
    path: 'employees',
    query: {
      display: 'full',
      'filter[email]': `[${email}]`,
    },
  })

  if (!res.ok) {
    throw new Error(`Connexion API PrestaShop echouee (HTTP ${res.status}). Verifiez l URL boutique et la cle webservice.`)
  }

  const data = parseXml<any>(res.xml)
  const collection = data?.prestashop?.employees?.employee
  if (!collection) return null

  const e = toArray(collection)[0]
  if (!e) return null

  return {
    id: nodeText(e.id),
    email: nodeText(e.email),
    firstname: nodeText(e.firstname),
    lastname: nodeText(e.lastname),
    passwd: nodeText(e.passwd),
    active: getBoolean(e.active),
  }
}

async function fetchCustomerByEmail(config: WsConfig, email: string): Promise<CustomerUser | null> {
  const res = await wsRequest(config, {
    method: 'GET',
    path: 'customers',
    query: {
      display: 'full',
      'filter[email]': `[${email}]`,
    },
  })

  if (!res.ok) {
    throw new Error(`Connexion API PrestaShop echouee (HTTP ${res.status}). Verifiez l URL boutique et la cle webservice.`)
  }

  const data = parseXml<any>(res.xml)
  const collection = data?.prestashop?.customers?.customer
  if (!collection) return null

  const c = toArray(collection)[0]
  if (!c) return null

  return {
    id: nodeText(c.id),
    email: nodeText(c.email),
    firstname: nodeText(c.firstname),
    lastname: nodeText(c.lastname),
    passwd: nodeText(c.passwd),
    active: getBoolean(c.active),
  }
}

async function verifyPassword(password: string, psHash: string): Promise<boolean> {
  if (!psHash) return false
  const compatibleHash = normalizeHash(psHash)
  return bcrypt.compare(password, compatibleHash)
}

function storeAdminUser(user: EmployeeUser) {
  const safeUser = {
    id: user.id,
    email: user.email,
    firstname: user.firstname,
    lastname: user.lastname,
  }
  localStorage.setItem(ADMIN_KEY, JSON.stringify(safeUser))
}

function storeCustomerUser(user: CustomerUser) {
  const safeUser = {
    id: user.id,
    email: user.email,
    firstname: user.firstname,
    lastname: user.lastname,
  }
  localStorage.setItem(CUSTOMER_KEY, JSON.stringify(safeUser))
}

function getStoredAdminUser() {
  const raw = localStorage.getItem(ADMIN_KEY)
  return raw ? JSON.parse(raw) : null
}

function getStoredCustomerUser() {
  const raw = localStorage.getItem(CUSTOMER_KEY)
  return raw ? JSON.parse(raw) : null
}

function clearAdminUser() {
  localStorage.removeItem(ADMIN_KEY)
}

function clearCustomerUser() {
  localStorage.removeItem(CUSTOMER_KEY)
}

async function loginAdmin(config: WsConfig, email: string, password: string) {
  const employee = await fetchEmployeeByEmail(config, email)
  if (!employee) throw new Error('Email ou mot de passe incorrect')
  if (!employee.active) throw new Error('Ce compte est desactive')

  const isValid = await verifyPassword(password, employee.passwd)
  if (!isValid) throw new Error('Email ou mot de passe incorrect')

  storeAdminUser(employee)
  return employee
}

async function loginCustomer(config: WsConfig, email: string, password: string) {
  const customer = await fetchCustomerByEmail(config, email)
  if (!customer) throw new Error('Email ou mot de passe incorrect')
  if (!customer.active) throw new Error('Ce compte est desactive')

  const isValid = await verifyPassword(password, customer.passwd)
  if (!isValid) throw new Error('Email ou mot de passe incorrect')

  storeCustomerUser(customer)
  return customer
}

export const authService = {
  loginAdmin,
  loginCustomer,
  getStoredAdminUser,
  getStoredCustomerUser,
  clearAdminUser,
  clearCustomerUser,
}
