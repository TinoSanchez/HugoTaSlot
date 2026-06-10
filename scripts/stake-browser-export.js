/*
 * Snippet console Chrome — exporte le catalogue Stake (groupe `slots`) au format
 * attendu par scripts/enrich-stake-placeholders.mjs (tableau brut d'objets game).
 *
 * UTILISATION
 *   1) Ouvre Chrome (avec VPN si Stake est bloqué chez ton FAI).
 *   2) Va sur https://stake.com/casino/group/slots — résous Cloudflare une fois.
 *   3) Ouvre DevTools (F12) → onglet « Console ».
 *   4) Colle l'intégralité de ce fichier et appuie sur Entrée.
 *   5) Patiente ~30-90 s (selon le nombre de jeux).
 *   6) Un fichier `stake-slots-<date>.json` est téléchargé automatiquement.
 *   7) Place-le dans le projet et lance :
 *        node scripts/enrich-stake-placeholders.mjs --from-file=stake-slots-XXXX.json
 *
 * Variantes utiles :
 *   - Pour exporter d'autres groupes, change `SLUGS` ci-dessous.
 *     Ex. ['slots','new-releases','pragmatic-play','hacksaw','nolimit-city'].
 *   - Si Stake renvoie 429, augmente PAUSE_MS.
 *
 * Le snippet ne reçoit ni envoie aucune donnée perso : il appelle uniquement
 * la même API GraphQL publique que la page sur laquelle tu es déjà.
 */

(async () => {
  const SLUGS = ['slots', 'new-releases'];
  const PAGE_SIZE = 39;
  const PAUSE_MS = 250;
  const MAX_PAGES_PER_SLUG = 500;

  const QUERY = `query SlugKuratorGroup($slug:String!,$limit:Int!,$offset:Int!,$sort:GameKuratorGroupGameSortEnum=popular7d,$locale:Locale="en"){slugKuratorGroup(slug:$slug){id slug translation type gameCount(locale:$locale) groupGamesList(limit:$limit,offset:$offset,sort:$sort,locale:$locale){id game{id name slug thumbnailUrl groupGames{group{id type slug translation}}}}}}`;

  async function gql(variables) {
    const res = await fetch('/_api/graphql', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        accept: 'application/graphql+json, application/json',
        'x-language': 'en',
        'x-operation-name': 'SlugKuratorGroup',
        'x-operation-type': 'query',
      },
      body: JSON.stringify({
        operationName: 'SlugKuratorGroup',
        query: QUERY,
        variables,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error('GraphQL: ' + JSON.stringify(json.errors).slice(0, 300));
    return json.data?.slugKuratorGroup;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  const seen = new Set();
  const all = [];
  for (const slug of SLUGS) {
    console.log(`[stake-export] slug="${slug}" — démarrage`);
    let offset = 0;
    let total = null;
    let page = 0;
    while (page < MAX_PAGES_PER_SLUG) {
      page += 1;
      let group;
      try {
        group = await gql({ slug, limit: PAGE_SIZE, offset, sort: 'popular7d', locale: 'en' });
      } catch (e) {
        console.warn(`[stake-export] erreur "${slug}" page ${page}: ${e.message} — retry…`);
        await sleep(1500);
        try {
          group = await gql({ slug, limit: PAGE_SIZE, offset, sort: 'popular7d', locale: 'en' });
        } catch (e2) {
          console.error(`[stake-export] abandon "${slug}" page ${page}: ${e2.message}`);
          break;
        }
      }
      if (!group) break;
      if (total === null) total = Number(group.gameCount || 0);
      const list = group.groupGamesList || [];
      for (const item of list) {
        const g = item?.game;
        if (!g) continue;
        const key = g.id || g.slug;
        if (key && !seen.has(key)) {
          seen.add(key);
          all.push(g);
        }
      }
      if (page % 5 === 0 || (total && all.length >= total)) {
        console.log(`[stake-export] "${slug}" — page ${page}, ${all.length} jeux uniques (total ${total ?? '?'})`);
      }
      if (list.length < PAGE_SIZE) break;
      if (total && offset + PAGE_SIZE >= total) break;
      offset += PAGE_SIZE;
      await sleep(PAUSE_MS);
    }
  }

  console.log(`[stake-export] terminé : ${all.length} jeux uniques.`);
  const json = JSON.stringify(all, null, 0);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `stake-slots-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  console.log(`[stake-export] téléchargé : ${a.download}`);
})();
