/* Thin client for the Flask REST API (SQLite lives only on the server). */
const BASE = (import.meta.env && import.meta.env.VITE_API_BASE) || '/api';

async function request(path, options) {
  const res = await fetch(BASE + path, options);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

export const loadState = () => request('/state', { cache: 'no-store' });

export const saveState = (payload) =>
  request('/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

export function saveStateBeacon(payload) {
  navigator.sendBeacon(BASE + '/state', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
}

export const getFarmers = () => request('/farmers');
export const getTokens = () => request('/tokens');
export const getReceipts = () => request('/receipts');
export const getReceipt = (no) => request('/receipts/' + encodeURIComponent(no));
export const assessImages = (payload) =>
  request('/quality/assess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
