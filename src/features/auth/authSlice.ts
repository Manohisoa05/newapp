import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { WsConfig } from '../../shared/http/prestashopWebserviceClient'
import { clearAuthFlags, clearWsConfig, loadAuthFlags, loadWsConfig, saveAuthFlags, saveWsConfig } from './authStorage'

export type AuthState = {
  wsConfig: WsConfig | null
  backofficeLoggedIn: boolean
  frontofficeLoggedIn: boolean
}

const initialState: AuthState = {
  wsConfig: loadWsConfig(),
  ...loadAuthFlags(),
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setWsConfig(state, action: PayloadAction<WsConfig>) {
      state.wsConfig = action.payload
      saveWsConfig(action.payload)
    },
    setBackofficeLoggedIn(state, action: PayloadAction<boolean>) {
      state.backofficeLoggedIn = action.payload
      saveAuthFlags({
        backofficeLoggedIn: state.backofficeLoggedIn,
        frontofficeLoggedIn: state.frontofficeLoggedIn,
      })
    },
    setFrontofficeLoggedIn(state, action: PayloadAction<boolean>) {
      state.frontofficeLoggedIn = action.payload
      saveAuthFlags({
        backofficeLoggedIn: state.backofficeLoggedIn,
        frontofficeLoggedIn: state.frontofficeLoggedIn,
      })
    },
    clearAll(state) {
      state.wsConfig = null
      state.backofficeLoggedIn = false
      state.frontofficeLoggedIn = false
      clearWsConfig()
      clearAuthFlags()
    },
  },
})

export const { setWsConfig, setBackofficeLoggedIn, setFrontofficeLoggedIn, clearAll } = authSlice.actions
export const authReducer = authSlice.reducer
