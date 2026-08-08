import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { child } from '../lib/logger.js';
import { fetchFeed } from '../lib/rss.js';
import { supabase } from '../supabase.js';
import { getChannelSafe } from '../discord/client.js';

const log = child({ mod: 'slots' });
const LOOKBACK_HOURS = 96; // pas d'annonces sur les sorties trop vieilles au premier run
const COLOR = 0xC9A227;
const DESC_MAX = 3900; // marge sous la limite Discord 4096

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
 */
function extractProviderAndName(title) {
  const raw = String(title || '').trim();
  if (!raw) return { name: '', provider: '' };
  const parts = raw.split(/\s[-–—|:]\s/).map((p) => p.trim()).filter(Boolean);
  const clean = (s) => s.replace(/\b(slot review|slot|review|online)\b/gi, '').replace(/\s+/g, ' ').trim();
  if (parts.length >= 2) {
    const a = clean(parts[0]);
    const b = clean(parts[1]);
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
  let inserted = 0;
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

      if (!row && !tooOld) {
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
        inserted += 1;
      }
    } catch (e) {
      log.warn({ err: e, title: item.title }, 'process slot release failed');
    }
  }
  // Annonce groupée (même flux que les autres sources)
  const ann = await announceManualPending();
  log.info({ inserted, total: items.length, announced: ann?.posted || 0 }, 'Slots check done');
  return { inserted, total: items.length, announced: ann?.posted || 0 };
}

const ANNOUNCEABLE_SOURCES = [
  'manual',
  'bigwinboard',
  'slotcatalog',
  'slotreport',
  'stake',
  'gamdom',
  'shuffle',
  'celsius',
];

function providerKey(p) {
  return String(p || '').trim() || 'Autres';
}

/** Groupe les rows par provider (tri alpha), slots triées par titre. */
function groupByProvider(rows) {
  const map = new Map();
  for (const row of rows) {
    const prov = providerKey(row.provider);
    if (!map.has(prov)) map.set(prov, []);
    map.get(prov).push(row);
  }
  const providers = [...map.keys()].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  return providers.map((prov) => ({
    provider: prov,
    slots: map.get(prov).sort((a, b) =>
      String(a.title || '').localeCompare(String(b.title || ''), 'fr', { sensitivity: 'base' }),
    ),
  }));
}

function formatSlotLine(row) {
  const title = String(row.title || 'Sans nom').trim();
  const url = String(row.url || '').trim();
  if (url && /^https?:\/\//i.test(url)) return `· [${title}](${url})`;
  return `· ${title}`;
}

/**
 * Construit 1..n embeds : un récap joliment espacé, trié par fournisseur.
 * Découpe si on dépasse la taille Discord.
 */
export function buildGroupedSlotEmbeds(rows) {
  const groups = groupByProvider(rows);
  const total = rows.length;
  const header = total === 1
    ? '**1 nouvelle slot**'
    : `**${total} nouvelles slots**`;

  const blocks = groups.map(({ provider, slots }) => {
    const lines = slots.map(formatSlotLine).join('\n');
    return `**${provider}**\n${lines}`;
  });

  const chunks = [];
  let current = `${header}\n`;
  for (const block of blocks) {
    const next = `${current}\n${block}\n`;
    if (next.length > DESC_MAX && current.length > header.length + 2) {
      chunks.push(current.trimEnd());
      current = `${header} _(suite)_\n\n${block}\n`;
    } else {
      current = next;
    }
  }
  if (current.trim()) chunks.push(current.trimEnd());

  return chunks.map((description, i) => {
    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(i === 0 ? '🎰 Nouvelles sorties' : `🎰 Nouvelles sorties (${i + 1}/${chunks.length})`)
      .setDescription(description)
      .setTimestamp(new Date());
    if (i === chunks.length - 1) {
      embed.setFooter({ text: `${total} slot${total > 1 ? 's' : ''} · triées par fournisseur` });
    }
    return embed;
  });
}

/**
 * Poste sur Discord toutes les rows en attente, en **un seul message**
 * (embeds groupés par fournisseur). Pas de mention.
 */
export async function announceManualPending() {
  const { data, error } = await supabase
    .from('slot_releases')
    .select('*')
    .in('source', ANNOUNCEABLE_SOURCES)
    .is('posted_to_discord_at', null)
    .order('created_at', { ascending: true })
    .limit(60);
  if (error) { log.warn({ err: error }, 'fetch pending failed'); return { error: error.message }; }
  const rows = data || [];
  if (!rows.length) return { posted: 0 };

  const ch = await getChannelSafe(config.discord.channels.slots);
  if (!ch) { log.warn('Channel slots non configuré ou introuvable'); return { posted: 0 }; }

  const embeds = buildGroupedSlotEmbeds(rows).slice(0, 10); // limite Discord
  let msg;
  try {
    msg = await ch.send({ embeds, allowedMentions: { parse: [] } });
  } catch (e) {
    log.warn({ err: e }, 'Discord batch send failed');
    return { posted: 0, error: e.message };
  }

  const nowIso = new Date().toISOString();
  const ids = rows.map((r) => r.id);
  const { error: updErr } = await supabase
    .from('slot_releases')
    .update({
      posted_to_discord_at: nowIso,
      discord_message_id: msg.id || null,
    })
    .in('id', ids);
  if (updErr) log.warn({ err: updErr }, 'mark posted batch failed');

  log.info({ posted: rows.length, providers: groupByProvider(rows).length }, 'Slots batch announced');
  return { posted: rows.length, messageId: msg.id };
}

/** Envoie un digest Discord pour une liste de rows (sans toucher posted_to_discord_at). */
export async function sendSlotsDigest(rows, { title } = {}) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return { posted: 0, error: 'empty' };
  const ch = await getChannelSafe(config.discord.channels.slots);
  if (!ch) return { posted: 0, error: 'no_channel' };
  const embeds = buildGroupedSlotEmbeds(list).slice(0, 10);
  if (title && embeds[0]) embeds[0].setTitle(title);
  try {
    const msg = await ch.send({ embeds, allowedMentions: { parse: [] } });
    return { posted: list.length, messageId: msg.id };
  } catch (e) {
    log.warn({ err: e }, 'sendSlotsDigest failed');
    return { posted: 0, error: e.message };
  }
}
