const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const api = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || `Server returned ${r.status}` }; }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
};
