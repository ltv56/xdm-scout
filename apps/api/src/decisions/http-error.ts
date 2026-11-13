// The provider's error code from a failed response, in brackets, or nothing if the body is not the usual shape.
export async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { code?: string | number } }
    return body.error?.code === undefined ? '' : ` (${body.error.code})`
  } catch {
    return ''
  }
}
