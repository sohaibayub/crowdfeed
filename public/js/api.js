// Small fetch wrapper for the JSON API.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, token, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'You seem to be offline. Check your connection and try again.');
  }
  if (response.status === 204) return null;
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new ApiError(response.status, (data && data.error) || `Request failed (${response.status})`);
  }
  return data;
}

let configPromise = null;
export function getConfig() {
  if (!configPromise) configPromise = api('/api/config').catch(() => ({ pushEnabled: false, survey: { min: 5, max: 8 }, profile: {} }));
  return configPromise;
}
