async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    const message = typeof detail?.message === 'string' ? detail.message : Array.isArray(detail?.message) ? detail.message.join('; ') : null
    throw new Error(message ?? `The API answered ${res.status}`)
  }
  return res.json()
}

export const getJson = <T>(path: string) => request<T>('GET', path)
export const postJson = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body)
export const patchJson = <T>(path: string, body: unknown) => request<T>('PATCH', path, body)
export const putJson = <T>(path: string, body: unknown) => request<T>('PUT', path, body)
