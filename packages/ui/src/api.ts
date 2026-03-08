export class UiApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'UiApiError';
    this.status = status;
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new UiApiError(response.status, `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}
