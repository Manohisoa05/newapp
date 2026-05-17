import bcrypt from 'bcryptjs'
import api from '../api/prestashop.js'
import { parsePrestaXML, getValue, getBoolean } from '../utils/xmlParser.js'

const STORAGE_KEY = 'ps_admin_user'

// ─── 1. Récupérer un employé par email ───────────────────────────────────────
async function fetchEmployeeByEmail(email) {
  try {
    const res = await api.get('/employees', {
      params: {
        display: 'full',
        'filter[email]': `[${email}]`
      }
    })

    const data = parsePrestaXML(res.data)
    const collection = data?.prestashop?.employees?.employee
    if (!collection) return null

    const liste = Array.isArray(collection) ? collection : [collection]
    const e = liste[0]
    if (!e) return null

    return {
      id:        getValue(e.id),
      email:     getValue(e.email),
      firstname: getValue(e.firstname),
      lastname:  getValue(e.lastname),
      passwd:    getValue(e.passwd),
      active:    getBoolean(e.active),
    }

  } catch (err) {
    console.error('[authService] fetchEmployeeByEmail error:', err)
    throw new Error('Erreur lors de la connexion à l\'API PrestaShop')
  }
}

// ─── 2. Comparer le mot de passe avec le hash PS ─────────────────────────────
async function verifyPassword(password, psHash) {
  try {
    if (!psHash) {
      throw new Error('L\'API ne retourne pas le mot de passe')
    }
    // PS utilise $2y$, bcryptjs utilise $2a$ — il faut remplacer sinon ça échoue
    const compatibleHash = psHash.replace(/^\$2y\$/, '$2a$')
    return bcrypt.compare(password, compatibleHash)

  } catch (err) {
    console.error('[authService] verifyPassword error:', err)
    throw err
  }
}

// ─── 3. Stocker l'utilisateur dans localStorage ───────────────────────────────
function storeUser(employee) {
  try {
    // On ne stocke JAMAIS le hash du mot de passe
    const safeEmployee = {
      id:        employee.id,
      email:     employee.email,
      firstname: employee.firstname,
      lastname:  employee.lastname,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeEmployee))

  } catch (err) {
    console.error('[authService] storeUser error:', err)
    throw new Error('Impossible de sauvegarder la session')
  }
}

// ─── 4. Récupérer l'utilisateur depuis localStorage ──────────────────────────
function getStoredUser() {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : null
  } catch (err) {
    console.error('[authService] getStoredUser error:', err)
    return null
  }
}

// ─── 5. Supprimer l'utilisateur du localStorage ──────────────────────────────
function clearStoredUser() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (err) {
    console.error('[authService] clearStoredUser error:', err)
  }
}

// ─── 6. Login complet ─────────────────────────────────────────────────────────
async function login(email, password) {
  console.log('[authService] login attempt:', email)

  // Étape 1 — chercher l'employé par email
  const employee = await fetchEmployeeByEmail(email)
  if (!employee) {
    throw new Error('Email ou mot de passe incorrect')
  }
  console.log('[authService] employee found:', employee.firstname, employee.lastname)

  // Étape 2 — vérifier si le compte est actif
  if (!employee.active) {
    throw new Error('Ce compte est désactivé')
  }

  // Étape 3 — vérifier le mot de passe
  const isValid = await verifyPassword(password, employee.passwd)
  if (!isValid) {
    console.warn('[authService] wrong password for:', email)
    throw new Error('Email ou mot de passe incorrect')
  }
  console.log('[authService] login success:', email)

  // Étape 4 — stocker dans localStorage
  storeUser(employee)

  return employee
}

// ─── 7. Logout ────────────────────────────────────────────────────────────────
function logout() {
  console.log('[authService] logout')
  clearStoredUser()
}

// ─── 8. Vérifier si connecté ──────────────────────────────────────────────────
function isAuthenticated() {
  return getStoredUser() !== null
}

export const authService = {
  login,
  logout,
  isAuthenticated,
  getStoredUser,
}