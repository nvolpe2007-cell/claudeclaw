export const API_BASE_URL = 'http://localhost:3001';

async function request(path, options) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function createOrUpdateUser(id, name) {
  return request('/api/users', {
    method: 'POST',
    body: JSON.stringify({ id, name }),
  });
}

export function postSession(userId, durationSeconds) {
  return request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ userId, durationSeconds }),
  });
}

export function getLeaderboard() {
  return request('/api/leaderboard');
}

export function getUser(userId) {
  return request(`/api/user/${userId}`);
}
