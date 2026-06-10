/**
 * Allège une entrée catalogue pour la prod (jeux.json déployé).
 * Champs retirés : devise (identique partout), rtp vide / N/A.
 */

export const DEFAULT_SLOT_DEVISE = { active: 'USD', symbole: '$' };

export function optimizeCatalogEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const out = { ...entry };
  delete out.devise;
  const rtp = String(out.rtp || '').trim();
  if (!rtp || rtp === 'N/A') delete out.rtp;
  return out;
}

export function optimizeCatalogArray(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(optimizeCatalogEntry);
}

export function normalizeCatalogEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (!entry.devise) entry.devise = DEFAULT_SLOT_DEVISE;
  return entry;
}
