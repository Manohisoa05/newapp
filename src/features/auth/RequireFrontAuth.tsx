import type { PropsWithChildren } from 'react'
import { Navigate } from 'react-router-dom'
import { useAppSelector } from '../../app/hooks'

export function RequireFrontAuth({ children }: PropsWithChildren) {
  const { frontofficeLoggedIn } = useAppSelector((s) => s.auth)
  if (!frontofficeLoggedIn) return <Navigate to="/front-login" replace />
  return <>{children}</>
}
