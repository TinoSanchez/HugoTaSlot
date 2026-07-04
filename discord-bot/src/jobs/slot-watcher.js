import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { child } from '../lib/logger.js';
import { fetchFeed } from '../lib/rss.js';
import { supabase } from '../supabase.js';
import { getChannelSafe } from '../discord/client.js';

const log = child({ mod: 'slots' });
const LOOKBACK_HOURS = 96; // pas d'annonces sur les sorties trop vieilles au premier run

function buildSlotHuntPrefillUrl(slot) {
  const title = String(slot?.name || slot?.title || '').trim();
  if (!title) return `${config.site.url}/hunt`;
  const params = new URLSearchParams();
  params.set('slotTitle', title);
  const provider = String(slot?.provider || '').trim();
  const image = String(slot?.image || '').trim();
  const url = String(slot?.url || '').trim();
  if (provider) params.set('slotProvider', provider);
  if (image) params.set('slotImage', image);
  if (url) params.set('slotUrl', url);
  return `${config.site.url}/hunt?${params.toString()}`;
}

const REVIEW_HINTS = [/review/i, /slot review/i];
const RELEASE_HINTS = [/launch/i, /release/i, /coming soon/i, /preview/i, /just released/i];

/**
 * Détection "c'est bien une nouvelle sortie de slot" :
 *  - tag/category contient "Reviews" / "Slot Reviews"
 *  - OU titre matche heuristique
 */
function looksLikeSlotRelease(item) {
  const cats = (item.categories || []).map((c) => String(c).toLowerCase());
  if (cats.some((c) => c.includes('review') || c.includes('slot') || c.includes('release'))) return true;
  const t = String(item.title || '');
  if (REVIEW_HINTS.some((rx) => rx.test(t))) return true;
  if (RELEASE_HINTS.some((rx) => rx.test(t))) return true;
  return false;
}

/**
 * Extrait provider / nom du slot depuis un titre BigWinBoard.
 * Heuristique : "Drop'em Review – Hacksaw Gaming" → name="Drop'em" provider="Hacksaw Gaming"
 *   ou "Hacksaw Gaming – Drop'em Review"
 *   ou "Drop'em Slot Review"
 */
function extractProviderAndName(title) {
  const raw = String(title || '').trim();
  if (!raw) return { name: '', provider: '' };
  // sépare sur tiret long ou court
  const parts = raw.split(/\s[-–—|:]\s/).map((p) => p.trim()).filter(Boolean);
  // retire "Review" / "Slot Review" / "Online Slot"
  const clean = (s) => s.replace(/\b(slot review|slot|review|online)\b/gi, '').replace(/\s+/g, ' ').trim();
  if (parts.length >= 2) {
    const a = clean(parts[0]);
    const b = clean(parts[1]);
    // Le provider est souvent Hacksaw Gaming, Push Gaming, Pragmatic Play (mots avec Gaming/Play/Studio).
    const isProv = (s) => /(gaming|play|studio|interactive|games|nolimit|hacksaw|relax|push|nolimit|elk|massive|peter|true lab|netent|red tiger|stake)/i.test(s);
    if (isProv(b)) return { name: a, provider: b };
    if (isProv(a)) return { name: b, provider: a };
    return { name: a, provider: b };
  }
  return { name: clean(parts[0] || ''), provider: '' };
}

function slugify(str) {
  return String(str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function runSlotsCheck() {
  const url = config.bigwinboard.rss;
  if (!url) return { skipped: true };
  let feed;
  try {
    feed = await fetchFeed(url, { kind: 'rss' });
  } catch (e) {
    log.warn({ msg: e.message, code: e.code || '' }, 'fetchFeed BigWinBoard failed');
    return { error: e.message };
  }
  const items = (feed.items || []).filter(looksLikeSlotRelease).slice(0, 15);
  let posted = 0;
  for (const item of items.reverse()) {
    try {
      const { name, provider } = extractProviderAndName(item.title);
      const slug = `bwb_${slugify(provider)}_${slugify(name || item.title)}`.slice(0, 200);
      if (!slug || slug === 'bwb__') continue;

      const exists = await supabase
        .from('slot_releases')
        .select('id, posted_to_discord_at')
        .eq('slug', slug)
        .maybeSingle();
      if (exists.error && exists.error.code !== 'PGRST116') throw exists.error;
      const row = exists.data;

      const publishedAt = item.publishedAt ? new Date(item.publishedAt) : new Date();
      const tooOld = !row && (Date.now() - publishedAt.getTime()) / 36e5 > LOOKBACK_HOURS;

      if (!row) {
        await supabase.from('slot_releases').insert({
          source: 'bigwinboard',
          external_id: item.id,
          slug,
          title: name || item.title,
          provider,
          image: item.image || '',
          summary: (item.summary || '').slice(0, 800),
          url: item.url,
          published_at: publishedAt.toISOString(),
        });
      }
      const alreadyPosted = row?.posted_to_discord_at;
      if (alreadyPosted || tooOld) continue;

      const announced = await announce({ name: name || item.title, provider, image: item.image, url: item.url, summary: item.summary }, publishedAt);
      if (announced) {
        await supabase
          .from('slot_releases')
          .update({
            posted_to_discord_at: new Date().toISOString(),
            discord_message_id: announced.id || null,
          })
          .eq('slug', slug);
        posted += 1;
      }
    } catch (e) {
      log.warn({ err: e, title: item.title }, 'process slot release failed');
    }
  }
  log.info({ posted, total: items.length }, 'Slots check done');
  return { posted, total: items.length };
}

const SOURCE_LABELS = {
  manual: { author: 'Annonce HugoTaSlot', footer: 'Ajout manuel · admin' },
  bigwinboard: { author: 'Sortie de slot · BigWinBoard', footer: 'Source : BigWinBoard.com' },
  slotcatalog: {
    author: 'Nouvelle slot · SlotCatalog',
    footer: 'Répertoire mondial (aligné sur les nouveautés Stake, Gamdom, Shuffle, Celsius…)'
  },
  stake: { author: 'Nouveauté repérée · Stake', footer: 'Détectée sur Stake.com' },
  gamdom: { author: 'Nouveauté repérée · Gamdom', footer: 'Détectée sur Gamdom.com' },
  shuffle: { author: 'Nouveauté repérée · Shuffle', footer: 'Détectée sur Shuffle.com' },
  celsius: { author: 'Nouveauté repérée · Celsius', footer: 'Détectée sur Celsius.casino' },
};

const ANNOUNCEABLE_SOURCES = ['manual', 'slotcatalog', 'stake', 'gamdom', 'shuffle', 'celsius'];

/**
 * Poste sur Discord toutes les rows en attente issues de :
 *  - admin manuel (source='manual')
 *  - scrapers casino (source='stake'|'gamdom'|'shuffle'|'celsius')
 * BigWinBoard est traité par runSlotsCheck() (annonce immédiate à la détection).
 */
export async function announceManualPending() {
  const { data, error } = await supabase
    .from('slot_releases')
    .select('*')
    .in('source', ANNOUNCEABLE_SOURCES)
    .is('posted_to_discord_at', null)
    .order('created_at', { ascending: true })
    .limit(15);
  if (error) { log.warn({ err: error }, 'fetch pending failed'); return { error: error.message }; }
  let posted = 0;
  for (const row of data || []) {
    const ann = await announce(
      { name: row.title, provider: row.provider, image: row.image, url: row.url, summary: row.summary },
      row.published_at ? new Date(row.published_at) : new Date(),
      row.source || 'manual'
    );
    if (ann) {
      await supabase.from('slot_releases')
        .update({ posted_to_discord_at: new Date().toISOString(), discord_message_id: ann.id || null })
        .eq('id', row.id);
      posted += 1;
      // petit délai entre deux postes pour éviter le rate limit Discord
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  return { posted };
}

async function announce(slot, publishedAt, source = 'manual') {
  const ch = await getChannelSafe(config.discord.channels.slots);
  if (!ch) { log.warn('Channel slots non configuré ou introuvable'); return null; }
  const meta = SOURCE_LABELS[source] || SOURCE_LABELS.manual;
  const huntPrefillUrl = buildSlotHuntPrefillUrl(slot);
  const embed = new EmbedBuilder()
    .setColor(0xA188A6)
    .setAuthor({ name: meta.author })
    .setTitle((slot.name || 'Nouvelle slot').slice(0, 250))
    .setTimestamp(publishedAt instanceof Date ? publishedAt : new Date());
  if (slot.url) embed.setURL(slot.url);
  if (slot.provider) embed.addFields({ name: 'Provider', value: String(slot.provider), inline: true });
  if (slot.image) embed.setImage(String(slot.image));
  let desc = slot.summary ? String(slot.summary).slice(0, 280) : '';
  if (huntPrefillUrl) {
    const huntLine = `[➕ Ajouter au hunt sur HugoTaSlot](${huntPrefillUrl})`;
    desc = desc ? `${desc}\n\n${huntLine}` : huntLine;
  }
  if (desc) embed.setDescription(desc.slice(0, 380));
  embed.setFooter({ text: meta.footer });
  const content = source === 'manual' ? '🎰 **Annonce HugoTaSlot**' : '🎰 **Nouvelle sortie repérée !**';
  try {
    return await ch.send({ content, embeds: [embed] });
  } catch (e) {
    log.warn({ err: e }, 'Discord send failed');
    return null;
  }
}
