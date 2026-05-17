import type { PropsWithChildren } from 'react'
import { Navigate } from 'react-router-dom'
import { useAppSelector } from '../../app/hooks'

export function RequireAuth({ children }: PropsWithChildren) {
  const { wsConfig, backofficeLoggedIn } = useAppSelector((s) => s.auth)
  if (!wsConfig || !backofficeLoggedIn) return <Navigate to="/login" replace />
  return <>{children}</>
}
