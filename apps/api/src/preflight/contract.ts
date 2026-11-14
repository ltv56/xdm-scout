export type PreflightStatus = 'ok' | 'warn' | 'fail' | 'info'

export type PreflightRow = {
  id: string
  label: string
  status: PreflightStatus
  detail: string
  fix?: string
}
