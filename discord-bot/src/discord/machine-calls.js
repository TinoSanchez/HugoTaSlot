import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from '../config.js';
import { child } from '../lib/logger.js';
import {
  resolveCatalogSlotFromQuery,
  slotCatalogImageOrPlaceholder,
  slotCatalogTitle,
  slotGamdomOrSiteUrl,
} from '../lib/catalog.js';
import { getBotState, setBotState } from '../supabase.js';
import { getChannelSafe } from './client.js';

const log = child({ mod: 'machine-calls' });
const STATE_KEY = 'active_machine_calls';
const COLOR_OPEN = 0xFFD700;
const COLOR_LOCKED = 0xFF9F1C;
const COLOR_CLOSED = 0x7F5A83;

/** Prix d’achat possibles (€) tirés au sort à l’annonce du gagnant. */
const BUY_PRICES = [20, 30, 40, 50, 60];

function ephemeral(content) {
  return { content, flags: MessageFlags.Ephemeral };
}

const EPHEMERAL_DEFER = { flags: MessageFlags.Ephemeral };

/** État courant : pool de calls (pas de session start/fin). */
async function loadPool() {
  const raw = await getBotState(STATE_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { calls: {}, callsLocked: false };
  }
  return {
    calls: raw.calls && typeof raw.calls === 'object' ? raw.calls : {},
    callsLocked: !!raw.callsLocked,
    lockedAt: raw.lockedAt || null,
  };
}

async function savePool(pool) {
  await setBotState(STATE_KEY, {
    calls: pool.calls || {},
    callsLocked: !!pool.callsLocked,
    lockedAt: pool.lockedAt || null,
  });
}

async function resetPool() {
  await setBotState(STATE_KEY, { calls: {}, callsLocked: false, lockedAt: null });
}

async function setCallsChannelLock(client, locked) {
  const channelId = config.discord.channels.calls;
  if (!channelId) return { ok: false, reason: 'no_channel' };
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || !ch.guild) return { ok: false, reason: 'not_found' };
    const everyone = ch.guild.roles.everyone;
    await ch.permissionOverwrites.edit(everyone, {
      SendMessages: locked ? false : null,
      SendMessagesInThreads: locked ? false : null,
      CreatePublicThreads: locked ? false : null,
      CreatePrivateThreads: locked ? false : null,
      AddReactions: locked ? false : null,
    }, { reason: locked ? 'Calls machines fermés temporairement' : 'Calls machines rouverts' });
    return { ok: true };
  } catch (e) {
    log.warn({ err: e }, 'setCallsChannelLock failed');
    return { ok: false, reason: e?.message || 'unknown' };
  }
}

function isAdmin(interaction) {
  const perms = interaction.memberPermissions;
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ManageGuild) || perms.has(PermissionFlagsBits.Administrator);
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

async function deleteCallMessages(ch, entries) {
  for (const c of entries) {
    if (!c?.messageId) continue;
    try { await ch.messages.delete(c.messageId); } catch (_) {}
  }
}

/* ─── /calls machine — toujours dispo, poste un message dans le salon ─ */
export async function cmdCallsSubmit(interaction) {
  const channelId = config.discord.channels.calls;
  if (!channelId) {
    return interaction.reply(ephemeral('DISCORD_CHANNEL_CALLS non configuré (Railway).'));
  }

  const pool = await loadPool();
  if (pool.callsLocked) {
    return interaction.reply(ephemeral('⏳ Les calls sont **fermés** pour le moment — attends l’annonce du gagnant ou une réouverture.'));
  }

  const machineRaw = String(interaction.options.getString('machine', true) || '').trim();
  if (!machineRaw) {
    return interaction.reply(ephemeral('Choisis une machine via l’autocomplete de `/calls`.'));
  }

  await interaction.deferReply(EPHEMERAL_DEFER);

  const { slot, ambiguous } = await resolveCatalogSlotFromQuery(machineRaw);
  if (!slot) {
    if (ambiguous.length > 1) {
      const lines = ambiguous.slice(0, 12).map((s, i) => {
        const t = slotCatalogTitle(s);
        const p = String(s.provider || s.Provider || '').trim();
        return `**${i + 1}.** ${t}${p ? ` · ${p}` : ''}`;
      });
      return interaction.editReply({
        content: `Plusieurs résultats. Affine le nom ou choisis dans l’autocomplete :\n${lines.join('\n')}`.slice(0, 3900),
      });
    }
    return interaction.editReply({
      content: `Aucune slot trouvée pour « ${machineRaw.slice(0, 120)} » dans le catalogue.`,
    });
  }

  const title = slotCatalogTitle(slot);
  const provider = String(slot.provider || slot.Provider || '').trim();
  const slotId = String(slot.id || slot.Id || '').trim() || title;
  const url = slotGamdomOrSiteUrl(slot);
  const userId = interaction.user.id;
  const previous = pool.calls?.[userId] || null;
  const label = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

  const ch = await getChannelSafe(channelId);
  if (!ch) return interaction.editReply({ content: 'Salon calls introuvable. Vérifie DISCORD_CHANNEL_CALLS.' });

  const embed = new EmbedBuilder()
    .setColor(COLOR_OPEN)
    .setAuthor({
      name: label,
      iconURL: interaction.user.displayAvatarURL({ size: 64 }),
    })
    .setTitle(`📣 Call : ${title}`)
    .setDescription(provider ? `Provider : **${provider}**` : 'Machine du catalogue HugoTaSlot')
    .setFooter({ text: previous ? 'Mise à jour de son call' : 'Nouveau call' })
    .setTimestamp(new Date());
  if (url) embed.setURL(url);
  embed.setThumbnail(slotCatalogImageOrPlaceholder(slot));

  const posted = await ch.send({ embeds: [embed] });

  if (previous?.messageId) {
    try { await ch.messages.delete(previous.messageId); } catch (_) {}
  }

  pool.calls = pool.calls || {};
  pool.calls[userId] = {
    userId,
    username: label,
    userTag: interaction.user.tag,
    machine: title,
    provider,
    slotId,
    url: url || null,
    at: new Date().toISOString(),
    messageId: posted.id,
  };
  await savePool(pool);

  return interaction.editReply({
    content: `Call enregistré : **${title}**${previous ? ' (ancien call remplacé)' : ''}. Message posté dans <#${channelId}>.`,
  });
}

/* ─── /calls-lock ────────────────────────────────────────────────────── */
export async function cmdCallsLock(interaction) {
  if (!isAdmin(interaction)) return interaction.reply(ephemeral('Réservé aux admins.'));

  const pool = await loadPool();
  if (pool.callsLocked) return interaction.reply(ephemeral('Les calls sont déjà fermés.'));

  await interaction.deferReply(EPHEMERAL_DEFER);

  pool.callsLocked = true;
  pool.lockedAt = new Date().toISOString();
  await savePool(pool);

  const lockRes = await setCallsChannelLock(interaction.client, true);
  if (!lockRes.ok) log.warn({ res: lockRes }, 'lock salon calls échoué');

  const entries = Object.values(pool.calls || {});
  const ch = await getChannelSafe(config.discord.channels.calls);
  if (ch) {
    const embed = new EmbedBuilder()
      .setColor(COLOR_LOCKED)
      .setTitle('🔒 CALLS FERMÉS')
      .setDescription([
        '**Plus aucun nouveau call ni modification.**',
        '',
        `Calls enregistrés : **${entries.length}**`,
        'Tirage du gagnant via `/calls-close` — ensuite tout repart à zéro.',
      ].join('\n'))
      .setFooter({ text: `Fermé par ${interaction.user.tag}` })
      .setTimestamp(new Date());
    await ch.send({
      content: '@everyone 🔒 **CALLS FERMÉS** — bonne chance !',
      embeds: [embed],
      allowedMentions: { parse: ['everyone'] },
    }).catch(() => {});
  }

  return interaction.editReply({
    content: `🔒 Calls fermés (${entries.length} call(s)). Utilise \`/calls-close\` pour tirer le gagnant.`,
  });
}

/* ─── /calls-unlock ──────────────────────────────────────────────────── */
export async function cmdCallsUnlock(interaction) {
  if (!isAdmin(interaction)) return interaction.reply(ephemeral('Réservé aux admins.'));

  const pool = await loadPool();
  if (!pool.callsLocked) return interaction.reply(ephemeral('Les calls sont déjà ouverts.'));

  await interaction.deferReply(EPHEMERAL_DEFER);

  pool.callsLocked = false;
  pool.lockedAt = null;
  await savePool(pool);

  const unlockRes = await setCallsChannelLock(interaction.client, false);
  if (!unlockRes.ok) log.warn({ res: unlockRes }, 'unlock salon calls échoué');

  const ch = await getChannelSafe(config.discord.channels.calls);
  if (ch) {
    const embed = new EmbedBuilder()
      .setColor(COLOR_OPEN)
      .setTitle('🔓 CALLS RÉOUVERTS')
      .setDescription('Tu peux à nouveau envoyer ou modifier ton call avec `/calls`.')
      .setFooter({ text: `Rouvert par ${interaction.user.tag}` })
      .setTimestamp(new Date());
    await ch.send({
      content: '@everyone 🔓 **CALLS RÉOUVERTS**',
      embeds: [embed],
      allowedMentions: { parse: ['everyone'] },
    }).catch(() => {});
  }

  return interaction.editReply({ content: '🔓 Calls rouverts.' });
}

/* ─── /calls-close — tire le gagnant puis reset complet ──────────────── */
export async function cmdCallsClose(interaction) {
  if (!isAdmin(interaction)) return interaction.reply(ephemeral('Réservé aux admins.'));

  const pool = await loadPool();
  const entries = Object.values(pool.calls || {});
  if (!entries.length) {
    return interaction.reply(ephemeral('Aucun call enregistré — impossible de tirer un gagnant.'));
  }

  await interaction.deferReply(EPHEMERAL_DEFER);

  const winner = pickRandom(entries);
  const buyPrice = pickRandom(BUY_PRICES);
  const channelId = config.discord.channels.calls;
  const ch = await getChannelSafe(channelId);
  if (!ch) return interaction.editReply({ content: 'Salon calls introuvable.' });

  const embed = new EmbedBuilder()
    .setColor(COLOR_CLOSED)
    .setTitle('🏁 GAGNANT DES CALLS')
    .setDescription([
      `**Gagnant :** <@${winner.userId}> (**${winner.username}**)`,
      `**Machine :** **${winner.machine}**${winner.provider ? ` · ${winner.provider}` : ''}`,
      '',
      `**Prix d’achat tiré au sort :** **${buyPrice} €**`,
      `_Parmi : ${BUY_PRICES.map((p) => `${p} €`).join(' · ')}_`,
      '',
      '**Conditions pour toucher la récompense :**',
      '• Être abonné sur **au minimum un réseau** (YouTube, Rumble, Discord, etc.)',
      '',
      '**Part du profit** (par rapport au prix d’achat) :',
      '• Abonné réseau(x) → **20 %** du profit',
      '• Affilié **Gamdom** → **50 %** du profit',
      '',
      `_Exemple : achat ${buyPrice} €, gain 200 € → profit ${200 - buyPrice} € → 20 % = ${((200 - buyPrice) * 0.2).toFixed(0)} € · 50 % Gamdom = ${((200 - buyPrice) * 0.5).toFixed(0)} €_`,
      '',
      `Participants : **${entries.length}**`,
      '',
      '_Les calls sont remis à zéro — tu peux en renvoyer un avec `/calls`._',
    ].join('\n'))
    .setFooter({ text: `Annoncé par ${interaction.user.tag}` })
    .setTimestamp(new Date());
  if (winner.url) embed.setURL(winner.url);

  await ch.send({
    content: `@everyone 🏁 **GAGNANT DES CALLS :** <@${winner.userId}> → **${winner.machine}** · prix d’achat **${buyPrice} €**`,
    embeds: [embed],
    allowedMentions: { parse: ['everyone', 'users'] },
  });

  await deleteCallMessages(ch, entries);

  const unlockRes = await setCallsChannelLock(interaction.client, false);
  if (!unlockRes.ok) log.warn({ res: unlockRes }, 'unlock salon calls échoué');

  await resetPool();

  return interaction.editReply({
    content: `Gagnant annoncé : **${winner.username}** · **${winner.machine}** · **${buyPrice} €**. Pool remis à zéro (${entries.length} participant(s)).`,
  });
}

/* ─── /calls-status ──────────────────────────────────────────────────── */
export async function cmdCallsStatus(interaction) {
  if (!isAdmin(interaction)) return interaction.reply(ephemeral('Réservé aux admins.'));
  const pool = await loadPool();
  const entries = Object.values(pool.calls || {});
  const lines = entries
    .slice(-25)
    .map((c) => `• ${c.username} → **${c.machine}**`)
    .join('\n') || '_Aucun call pour l’instant._';
  const state = pool.callsLocked ? '🔒 Fermés (attente tirage)' : '🟢 Ouverts';
  const embed = new EmbedBuilder()
    .setColor(pool.callsLocked ? COLOR_LOCKED : COLOR_OPEN)
    .setTitle('📊 Calls machines')
    .setDescription([
      `État : **${state}**`,
      pool.lockedAt ? `Fermés : <t:${Math.floor(new Date(pool.lockedAt).getTime() / 1000)}:R>` : null,
      `Calls en cours : **${entries.length}**`,
      '_Pas de session : `/calls` à tout moment, reset auto après `/calls-close`._',
    ].filter(Boolean).join('\n'))
    .addFields({ name: 'Derniers calls', value: lines.slice(0, 1024) });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
