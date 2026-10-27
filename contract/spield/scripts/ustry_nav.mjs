// This source supplies relay observation time, not a certified bond valuation timestamp.
export const NAV_URL = 'https://api.sand.etherfuse.com/lookup/tokens/cost/ustry';
export function decimal8(value) {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) throw new Error('Invalid decimal NAV');
  const [whole, fraction = ''] = value.split('.');
  const n = BigInt(whole) * 100_000_000n + BigInt((fraction + '00000000').slice(0,8));
  if (n <= 0n || n > 100_000_000_000n) throw new Error('NAV outside supported range');
  return n;
}
export function validateNav(data) {
  if (data?.token_symbol !== 'USTRY' || data.token_kind !== 'bond' || data.currency !== 'USD'
    || data.token_mint !== 'BoTpvjYEDn8esZDrBkipexoUMeSBQ9DDG6A5mtzsDGSt') throw new Error('Unexpected sandbox NAV identity');
  return decimal8(data.token_cost_in_usd);
}
export async function fetchNav() {
  const response = await fetch(NAV_URL, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new Error(`NAV HTTP ${response.status}`);
  const data = await response.json();
  return { price: validateNav(data), fetchedAt: new Date().toISOString(), source: NAV_URL, response: data };
}
export function publicationDue(last, price, timestamp, expiry) {
  return timestamp > Number(last.timestamp) && (timestamp - Number(last.timestamp) >= 43_200
    || (price - BigInt(last.price) < 0n ? BigInt(last.price)-price : price-BigInt(last.price))*1000n >= BigInt(last.price)
    || (Number(last.timestamp) < expiry && timestamp >= expiry));
}
