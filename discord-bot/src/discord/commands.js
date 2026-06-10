import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { supabase } from '../supabase.js';
import { child } from '../lib/logger.js';
import {
  pickRandomCatalogSlot,
  resolveCatalogSlotFromQuery,
  searchCatalogSlots,
  slotCatalogImageOrPlaceholder,
  slotCatalogTitle,
  slotChoiceValue,
  slotGamdomOrSiteUrl,
} from '../lib/catalog.js';

const log = child({ mod: 'cmd' });
const COLOR = 0x7F5A83;

/* ─── Définitions des commandes (pour register-commands.js) ───────────── */
export const commandDefs = [
  new SlashCommandBuilder()
    .setName('lastvideo')
    .setDescription('Affiche la dernière vidéo HugoTaSlot détectée par le bot.'),
  new SlashCommandBuilder()
    .setName('lastslot')
    .setDescription('Affiche la dernière sortie de slot annoncée.'),
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Lie ton compte Discord à ton compte HugoTaSlot.')
    .addStringOption((o) => o.setName('code').setDescription('Code à 6 caractères généré sur le site').setRequired(true)),
  new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Délie ton compte Discord de HugoTaSlot.'),
  new SlashCommandBuilder()
    .setName('hunts')
    .setDescription('Liste les derniers Bonus Hunts d’un membre lié.')
    .addUserOption((o) => o.setName('membre').setDescription('Membre cible (par défaut : toi)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top des derniers hunts terminés (par profit).'),
  new SlashCommandBuilder()
    .setName('slot')
    .setDescription('Tire une slot au hasard depuis le catalogue du site (jeux.json).'),
  new SlashCommandBuilder()
    .setName('call')
    .setDescription('Call machine : choisis une slot du catalogue ou tire au hasard.')
    .addStringOption((o) => o
      .setName('machine')
      .setDescription('Tape le nom (ex. Hounds of Hell) puis choisis dans la liste')
      .setRequired(false)
      .setAutocomplete(true)),
].map((c) => c.toJSON());

/* ─── Dispatcher ──────────────────────────────────────────────────────── */
export async function registerInteractionHandlers(client) {
  client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'call' && interaction.options.getFocused(true).name === 'machine') {
        try {
          return await autocompleteCallMachine(interaction);
        } catch (e) {
          log.error({ err: e }, 'autocomplete call failed');
          return interaction.respond([]).catch(() => {});
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
        case 'slot': return cmdRandomSlot(interaction);
        case 'call': return cmdCall(interaction);
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
    .setAuthor({ name: data.channel_label || 'HugoTaSlot' })
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
  return interaction.editReply({ content: '✅ Compte lié avec succès. Tu peux utiliser /hunts maintenant.' });
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

/* ─── Autocomplete /call machine ─────────────────────────────────────── */
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

/* ─── /call [machine] — liste autocomplete ou hasard ─────────────────── */
async function cmdCall(interaction) {
  await interaction.deferReply();
  const machineRaw = interaction.options.getString('machine');
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
