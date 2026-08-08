import { EmbedBuilder, MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { supabase } from '../supabase.js';
import { child } from '../lib/logger.js';
import { buildCommandDefs } from './commands-refresh.js';
export { buildCommandDefs, refreshGuildCommands } from './commands-refresh.js';
import {
  pickRandomCatalogSlot,
  resolveCatalogSlotFromQuery,
  searchCatalogSlots,
  slotCatalogImageOrPlaceholder,
  slotCatalogTitle,
  slotChoiceValue,
  slotGamdomOrSiteUrl,
} from '../lib/catalog.js';
import {
  cmdPronoStart,
  cmdPronoSubmit,
  cmdPronoLock,
  cmdPronoUnlock,
  cmdPronoClose,
  cmdPronoStatus,
  handlePronoModalSubmit,
  isPronoModalId,
} from './prono.js';
import {
  cmdCallsSubmit,
  cmdCallsLock,
  cmdCallsUnlock,
  cmdCallsClose,
  cmdCallsStatus,
} from './machine-calls.js';

const log = child({ mod: 'cmd' });
const COLOR = 0x7F5A83;

/** Version statique (utilisée par register-commands.js au boot / CLI). */
export const commandDefs = buildCommandDefs();

/* ─── Dispatcher ──────────────────────────────────────────────────────── */
export async function registerInteractionHandlers(client) {
  client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);
      if (
        (interaction.commandName === 'machine' && focused.name === 'nom')
        || (interaction.commandName === 'calls' && focused.name === 'machine')
      ) {
        try {
          return await autocompleteCallMachine(interaction);
        } catch (e) {
          log.error({ err: e }, 'autocomplete call failed');
          return interaction.respond([]).catch(() => {});
        }
      }
      return;
    }
    if (interaction.isModalSubmit()) {
      if (isPronoModalId(interaction.customId)) {
        try { return await handlePronoModalSubmit(interaction); }
        catch (e) {
          log.error({ err: e }, 'prono modal submit failed');
          const msg = { content: 'Erreur lors de l’enregistrement de ton prono.', flags: MessageFlags.Ephemeral };
          if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
          else await interaction.reply(msg).catch(() => {});
          return;
        }
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    try {
      switch (interaction.commandName) {
        case 'lastvideo': return cmdLastVideo(interaction);
        case 'lastslot': return cmdLastSlot(interaction);
        case 'link': return cmdLink(interaction);
        case 'unlink': return cmdUnlink(interaction);
        case 'hunts': return cmdHunts(interaction);
        case 'leaderboard': return cmdLeaderboard(interaction);
        case 'live': return cmdLive(interaction);
        case 'slot': return cmdRandomSlot(interaction);
        case 'machine': return cmdMachine(interaction);
        case 'activity': return cmdActivity(interaction);
        case 'prono-start': return cmdPronoStart(interaction);
        case 'prono': return cmdPronoSubmit(interaction);
        case 'prono-lock': return cmdPronoLock(interaction);
        case 'prono-unlock': return cmdPronoUnlock(interaction);
        case 'prono-close': return cmdPronoClose(interaction);
        case 'prono-status': return cmdPronoStatus(interaction);
        case 'calls': return cmdCallsSubmit(interaction);
        case 'calls-lock': return cmdCallsLock(interaction);
        case 'calls-unlock': return cmdCallsUnlock(interaction);
        case 'calls-close': return cmdCallsClose(interaction);
        case 'calls-status': return cmdCallsStatus(interaction);
        default: return interaction.reply({ content: 'Commande inconnue.', flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      log.error({ err: e, cmd: interaction.commandName }, 'command handler failed');
      const msg = { content: 'Erreur interne, réessaie dans un instant.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
  });
}

/* ─── /lastvideo ─────────────────────────────────────────────────────── */
async function cmdLastVideo(interaction) {
  await interaction.deferReply();
  const { data, error } = await supabase
    .from('youtube_videos')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    return interaction.editReply({ content: 'Aucune vidéo en base pour le moment.' });
  }
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(data.title || 'Dernière vidéo')
    .setURL(data.url)
    .setImage(data.thumbnail || `https://i.ytimg.com/vi/${data.video_id}/maxresdefault.jpg`)
    .setAuthor({ name: data.channel_label || '19enplein' })
    .setTimestamp(new Date(data.published_at));
  if (data.description) embed.setDescription(String(data.description).slice(0, 350));
  return interaction.editReply({ embeds: [embed] });
}

/* ─── /lastslot ──────────────────────────────────────────────────────── */
async function cmdLastSlot(interaction) {
  await interaction.deferReply();
  const { data, error } = await supabase
    .from('slot_releases')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    return interaction.editReply({ content: 'Aucune sortie en base pour le moment.' });
  }
  const embed = new EmbedBuilder()
    .setColor(0xA188A6)
    .setTitle(data.title || 'Dernière sortie')
    .setURL(data.url || null)
    .setTimestamp(new Date(data.published_at));
  if (data.provider) embed.addFields({ name: 'Provider', value: data.provider, inline: true });
  if (data.image) embed.setImage(data.image);
  if (data.summary) embed.setDescription(String(data.summary).slice(0, 380));
  embed.setFooter({ text: data.source === 'manual' ? 'Annonce HugoTaSlot' : 'Source : BigWinBoard' });
  return interaction.editReply({ embeds: [embed] });
}

/* ─── /link CODE ─────────────────────────────────────────────────────── */
async function cmdLink(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const code = String(interaction.options.getString('code', true) || '').trim().toUpperCase();
  if (code.length < 4 || code.length > 12) {
    return interaction.editReply({ content: 'Code invalide. Génère-le depuis ton profil sur le site.' });
  }
  const nowIso = new Date().toISOString();

  // Trouve la row "en attente" : code == ?, expires_at >= now, discord_id IS NULL
  const { data: pending, error: findErr } = await supabase
    .from('discord_links')
    .select('id, user_id, expires_at, discord_id')
    .eq('code', code)
    .maybeSingle();
  if (findErr) {
    log.warn({ err: findErr }, 'discord_links lookup failed');
    return interaction.editReply({ content: 'Erreur côté serveur, réessaie dans quelques minutes.' });
  }
  if (!pending) return interaction.editReply({ content: 'Code introuvable, expiré ou déjà utilisé.' });
  if (pending.expires_at && new Date(pending.expires_at).getTime() < Date.now()) {
    return interaction.editReply({ content: 'Code expiré. Re-génère-en un sur le site.' });
  }
  if (pending.discord_id && pending.discord_id !== String(interaction.user.id)) {
    return interaction.editReply({ content: 'Ce code est déjà associé à un autre Discord.' });
  }

  // Vérifie que ce Discord n'est pas déjà lié à un autre compte
  const { data: clash } = await supabase
    .from('discord_links')
    .select('id, user_id')
    .eq('discord_id', String(interaction.user.id))
    .maybeSingle();
  if (clash && clash.user_id !== pending.user_id) {
    return interaction.editReply({ content: 'Ton Discord est déjà lié à un autre compte HugoTaSlot. Utilise `/unlink` d\'abord.' });
  }

  const { error: updErr } = await supabase
    .from('discord_links')
    .update({
      discord_id: String(interaction.user.id),
      discord_username: interaction.user.username,
      linked_at: nowIso,
      code: null,
      expires_at: null,
    })
    .eq('id', pending.id);
  if (updErr) {
    log.warn({ err: updErr }, 'discord_links update failed');
    return interaction.editReply({ content: 'Liaison impossible (base de données).' });
  }
  return interaction.editReply({ content: '✅ Compte lié avec succès. Tu peux utiliser `/hunts`, `/leaderboard` et `/live slug`.' });
}

/* ─── /unlink ────────────────────────────────────────────────────────── */
async function cmdUnlink(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { data, error } = await supabase
    .from('discord_links')
    .select('id')
    .eq('discord_id', String(interaction.user.id))
    .maybeSingle();
  if (error || !data) return interaction.editReply({ content: 'Aucune liaison trouvée pour ce compte Discord.' });
  await supabase.from('discord_links').delete().eq('id', data.id);
  return interaction.editReply({ content: '🔓 Compte délié.' });
}

/* ─── /hunts [membre] ────────────────────────────────────────────────── */
async function cmdHunts(interaction) {
  await interaction.deferReply();
  const target = interaction.options.getUser('membre') || interaction.user;
  const { data: link } = await supabase
    .from('discord_links')
    .select('user_id, discord_username')
    .eq('discord_id', String(target.id))
    .maybeSingle();
  if (!link) {
    return interaction.editReply({
      content: target.id === interaction.user.id
        ? 'Ton compte Discord n\'est pas encore lié. Utilise `/link CODE` (génère le code sur le site).'
        : `${target.username} n\'a pas lié son compte Discord.`,
    });
  }
  const { data: hunts, error } = await supabase
    .from('hunts')
    .select('id, name, currency, starting_balance, start_balance_eur, archived, created_at, hunt_bonuses (id, win_value, bet)')
    .eq('user_id', link.user_id)
    .eq('archived', false)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) {
    log.warn({ err: error, code: error.code, msg: error.message }, 'fetch hunts failed');
    return interaction.editReply({ content: 'Impossible de récupérer les hunts.' });
  }
  if (!hunts?.length) return interaction.editReply({ content: `${target.username} n\'a aucun hunt.` });
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
    .setTitle('Derniers Bonus Hunts')
    .setDescription(hunts.map((h, i) => {
      const cur = (h.currency || 'EUR').toUpperCase();
      const sb = Number(h.starting_balance || 0).toFixed(2).replace('.', ',');
      const bonuses = Array.isArray(h.hunt_bonuses) ? h.hunt_bonuses : [];
      const bonusCount = bonuses.length;
      const totalWin = bonuses.reduce((s, b) => s + Number(b.win_value || 0), 0);
      const sign = (totalWin - Number(h.starting_balance || 0)) >= 0 ? '+' : '';
      const profit = (totalWin - Number(h.starting_balance || 0)).toFixed(2).replace('.', ',');
      const dt = h.created_at ? new Date(h.created_at).toLocaleDateString('fr-FR') : '';
      return `**${i + 1}. ${h.name || 'Sans nom'}** · solde ${sb}${cur} · ${bonusCount} bonus · profit **${sign}${profit}${cur}** · _${dt}_`;
    }).join('\n'))
    .setURL(`${config.site.url}/`)
    .setFooter({ text: 'Voir le détail sur HugoTaSlot' });
  return interaction.editReply({ embeds: [embed] });
}

/* ─── Autocomplete /machine nom · /calls machine ─────────────────────── */
async function autocompleteCallMachine(interaction) {
  const focused = interaction.options.getFocused(true);
  const q = String(focused.value || '').trim();
  if (q.length < 2) {
    return interaction.respond([]);
  }
  const slots = await searchCatalogSlots(q, { limit: 25 });
  const choices = slots.map((s) => {
    const title = slotCatalogTitle(s);
    const prov = String(s.provider || s.Provider || '').trim();
    const name = prov ? `${title.slice(0, 68)} · ${prov.slice(0, 26)}` : title;
    return { name: name.slice(0, 100), value: slotChoiceValue(s) };
  });
  return interaction.respond(choices);
}

function buildCatalogSlotEmbed(slot, mode) {
  const title = slotCatalogTitle(slot);
  const provider = String(slot.provider || slot.Provider || '').trim();
  const url = slotGamdomOrSiteUrl(slot);
  const isCall = mode === 'call';
  const embed = new EmbedBuilder()
    .setColor(isCall ? 0xffd700 : COLOR)
    .setTitle(isCall ? `📣 Call machine : ${title}` : `🎰 Slot aléatoire : ${title}`)
    .setTimestamp(new Date());
  if (url) embed.setURL(url);
  if (provider) embed.addFields({ name: 'Provider', value: provider.slice(0, 256), inline: true });
  // Toujours une grande image : URL catalogue (tous champs connus) ou placeholder lisible
  embed.setImage(slotCatalogImageOrPlaceholder(slot));
  embed.setDescription(
    isCall
      ? 'Machine choisie dans le catalogue HugoTaSlot — à toi de jouer.'
      : 'Tirage au sort parmi les slots du site.',
  );
  embed.setFooter({
    text: isCall ? 'HugoTaSlot · bonne chance' : 'Catalogue HugoTaSlot (jeux.json)',
  });
  return embed;
}

/* ─── /slot (aléatoire) ──────────────────────────────────────────────── */
async function cmdRandomSlot(interaction) {
  await interaction.deferReply();
  const slot = await pickRandomCatalogSlot();
  if (!slot) {
    return interaction.editReply({
      content: 'Impossible de charger le catalogue du site (`jeux.json`). Vérifie `SITE_URL` ou réessaie dans un instant.',
    });
  }
  return interaction.editReply({ embeds: [buildCatalogSlotEmbed(slot, 'slot')] });
}

/* ─── /machine [nom] — liste autocomplete ou hasard ──────────────────── */
async function cmdMachine(interaction) {
  await interaction.deferReply();
  const machineRaw = interaction.options.getString('nom');
  const query = machineRaw ? String(machineRaw).trim() : '';

  let slot = null;
  if (query) {
    const { slot: resolved, ambiguous } = await resolveCatalogSlotFromQuery(query);
    if (resolved) {
      slot = resolved;
    } else if (ambiguous.length > 1) {
      const lines = ambiguous.slice(0, 12).map((s, i) => {
        const t = slotCatalogTitle(s);
        const p = String(s.provider || s.Provider || '').trim();
        return `**${i + 1}.** ${t}${p ? ` · ${p}` : ''}`;
      });
      return interaction.editReply({
        content:
          `Plusieurs résultats pour « ${query.slice(0, 80)} ». Affine le nom ou choisis une ligne dans l’autocomplete :\n${lines.join('\n')}`.slice(0, 3900),
      });
    } else {
      return interaction.editReply({
        content: `Aucune slot trouvée pour « ${query.slice(0, 120)} » dans le catalogue (\`jeux.json\`).`,
      });
    }
  } else {
    slot = await pickRandomCatalogSlot();
  }

  if (!slot) {
    return interaction.editReply({
      content: 'Impossible de charger le catalogue du site (`jeux.json`). Vérifie `SITE_URL` ou réessaie dans un instant.',
    });
  }
  return interaction.editReply({ embeds: [buildCatalogSlotEmbed(slot, 'call')] });
}

/* ─── /leaderboard ───────────────────────────────────────────────────── */
async function cmdLeaderboard(interaction) {
  await interaction.deferReply();
  // On lit les 40 derniers hunts non archivés, on calcule le profit côté client,
  // et on enrichit avec le pseudo (profiles) ou le username Discord lié.
  const { data: hunts, error } = await supabase
    .from('hunts')
    .select('id, name, currency, starting_balance, user_id, archived, created_at, hunt_bonuses (win_value, bet)')
    .eq('archived', false)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) {
    log.warn({ err: error, code: error.code, msg: error.message }, 'leaderboard fetch failed');
    return interaction.editReply({ content: 'Impossible de récupérer les hunts.' });
  }
  const rows = (hunts || []).map((h) => {
    const bonuses = Array.isArray(h.hunt_bonuses) ? h.hunt_bonuses : [];
    const win = bonuses.reduce((s, b) => s + Number(b.win_value || 0), 0);
    const start = Number(h.starting_balance || 0);
    return {
      name: h.name || 'Sans nom',
      currency: (h.currency || 'EUR').toUpperCase(),
      user_id: h.user_id,
      bonusCount: bonuses.length,
      start,
      win,
      profit: win - start,
    };
  }).filter((r) => r.start > 0 && r.bonusCount > 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 10);

  if (!rows.length) return interaction.editReply({ content: 'Pas encore de hunts à classer.' });

  // Enrichit avec le pseudo (profiles.username) — best effort.
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  let userLabels = {};
  if (userIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', userIds);
    if (Array.isArray(profs)) {
      userLabels = Object.fromEntries(profs.map((p) => [p.id, p.username || '']));
    }
  }

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Top 10 des derniers Bonus Hunts (par profit)')
    .setDescription(rows.map((r, i) => {
      const sign = r.profit >= 0 ? '+' : '';
      const who = userLabels[r.user_id] ? ` · _par ${userLabels[r.user_id]}_` : '';
      return `**${i + 1}. ${r.name}** · solde ${r.start.toFixed(2).replace('.', ',')}${r.currency} · profit **${sign}${r.profit.toFixed(2).replace('.', ',')}${r.currency}**${who}`;
    }).join('\n'))
    .setFooter({ text: 'Calculé sur les 40 hunts les plus récents.' });
  return interaction.editReply({ embeds: [embed] });
}

/* ─── /live slug ─────────────────────────────────────────────────────── */
async function cmdLive(interaction) {
  await interaction.deferReply();
  const slug = String(interaction.options.getString('slug', true) || '').trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]{4,32}$/.test(slug)) {
    return interaction.editReply({ content: 'Slug invalide. Copie la partie après `/h/` dans le lien live du site.' });
  }
  const { data, error } = await supabase.rpc('get_public_hunt_share', { p_slug: slug });
  if (error) {
    log.warn({ err: error, slug }, 'get_public_hunt_share failed');
    return interaction.editReply({ content: 'Impossible de charger ce hunt live.' });
  }
  if (!data) {
    return interaction.editReply({ content: 'Hunt live introuvable ou désactivé. Vérifie le slug (partie après `/h/` sur le site).' });
  }
  const payload = data.payload || {};
  const hunt = payload.hunt || {};
  const stats = payload.stats || {};
  const liveUrl = `${config.site.url}/h/${slug}`;
  const profit = Number(stats.profit || 0);
  const sign = profit >= 0 ? '+' : '';
  const cur = String(stats.currency || hunt.currency || 'EUR').toUpperCase();
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(hunt.name || 'Bonus Hunt live')
    .setURL(liveUrl)
    .setDescription(`Suivi en direct — [ouvrir le live](${liveUrl})`)
    .setTimestamp(new Date(data.updated_at || Date.now()));
  embed.addFields(
    { name: 'Solde départ', value: `${Number(stats.startBalance || hunt.startBalance || 0).toFixed(2).replace('.', ',')} ${cur}`, inline: true },
    { name: 'Bonus', value: `${Number(stats.openedCount || 0)}/${Number(stats.bonusCount || 0)} ouverts`, inline: true },
    { name: 'Profit', value: `**${sign}${profit.toFixed(2).replace('.', ',')} ${cur}**`, inline: true },
  );
  if (stats.beAvg != null && Number(stats.beAvg) > 0) {
    embed.addFields({ name: 'BE moyen', value: `×${Number(stats.beAvg).toFixed(2)}`, inline: true });
  }
  const bonuses = Array.isArray(hunt.bonuses) ? hunt.bonuses : [];
  const lastOpen = [...bonuses].reverse().find((b) => b.win != null && b.win !== '');
  const thumb = lastOpen?.slotImage || bonuses[bonuses.length - 1]?.slotImage;
  if (thumb) embed.setThumbnail(String(thumb));
  embed.setFooter({ text: 'HugoTaSlot · hunt public partagé' });
  return interaction.editReply({ embeds: [embed] });
}

/* ─── /activity ─────────────────────────────────────────────────────── */
async function cmdActivity(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Activity HugoTaSlot')
    .setDescription(
      'Lance l’**Activity** pour afficher la **Rich Presence complète** (logos 19ENPLEIN + Gamdom) sur ton profil.\n\n'
      + '**Comment lancer :**\n'
      + '1. Clique sur le **+** (ou icône apps) dans un salon vocal ou texte\n'
      + '2. Choisis **HugoTaSlot** / **Bot enplein** dans la liste Activities\n'
      + '3. L’Activity s’ouvre → ta présence affiche les images\n\n'
      + '**URL Mappings Portal :** `/` → `activity.hugotaslot.fr` · `/ht-api` → `hugotaslot.fr`\n\n'
      + '*(Les bots seuls ne peuvent pas afficher les images — seuls les joueurs dans l’Activity le peuvent.)*',
    )
    .setURL(`${config.site.url}/discord-activity/`)
    .setFooter({ text: 'Developer Portal → Activities activées + URL mapping requis' });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
