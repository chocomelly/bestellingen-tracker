const KEY = process.env.SEVENTEEN_TRACK_KEY;
const BASE = 'https://api.17track.net/track/v2.2';

async function call(path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { '17token': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`17track ${path} HTTP ${res.status}`);
  return res.json();
}

async function register(numbers) {
  if (!numbers.length) return null;
  return call('register', numbers.map(n => ({ number: n })));
}

async function getInfo(numbers) {
  if (!numbers.length) return null;
  return call('gettrackinfo', numbers.map(n => ({ number: n })));
}

function mapStatus(rawStatus) {
  if (!rawStatus) return null;
  const s = String(rawStatus).toLowerCase().replace(/[\s_]/g, '');
  if (s.includes('delivered')) return 'bezorgd';
  if (s.includes('intransit') || s.includes('outfordelivery') ||
      s.includes('availableforpickup') || s.includes('pickup')) return 'verzonden';
  return null;
}

module.exports = {
  enabled: !!KEY,
  register,
  getInfo,
  mapStatus
};
