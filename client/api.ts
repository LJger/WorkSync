export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method || 'GET', credentials: 'same-origin', signal: options.signal,
      headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', '连接暂时中断，请检查网络后重试。');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/me') window.dispatchEvent(new Event('worksync:unauthorized'));
    if (result.code === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new Event('worksync:password-required'));
    throw new ApiError(response.status, result.code || 'REQUEST_FAILED', result.message || '操作未完成，请重试。');
  }
  return result as T;
}
export function queryString(values: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '' && value !== false) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '操作未完成，请重试。'; }
