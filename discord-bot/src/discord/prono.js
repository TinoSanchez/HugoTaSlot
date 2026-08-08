import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from '../config.js';
import { child } from '../lib/logger.js';
import { getBotState, setBotState } from '../supabase.js';
import { getChannelSafe } from './client.js';
import { refreshGuildCommands, teamOptionNames } from './commands-refresh.js';

const log = child({ mod: 'prono' });
const STATE_KEY = 'active_prono_match';
const COLOR_OPEN = 0x00DC6E;
const COLOR_LOCKED = 0xFF9F1C;
const COLOR_CLOSED = 0x7F5A83;

function ephemeral(content) {
  return { content, flags: MessageFlags.Ephemeral };
}

const EPHEMERAL_DEFER = { flags: MessageFlags.Ephemeral };

async function loadMatch() {
  const raw = await getBotState(STATE_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw;
}

async function saveMatch(match) {
  await setBotState(STATE_KEY, match);
}

async function clearMatch() {
  await setBotState(STATE_KEY, {});
}

/** Verrouille (deny SEND_MESSAGES à @everyone) ou déverrouille le salon pronos. */
async function setPronoChannelLock(client, locked) {
  const channelId = config.discord.channels.pronos;
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
    }, { reason: locked ? 'Prono match en cours — écriture réservée admin' : 'Prono match clôturé — salon rouvert' });
    return { ok: true };
  } catch (e) {
    log.warn({ err: e }, 'setPronoChannelLock failed');
    return { ok: false, reason: e?.message || 'unknown' };
  }
}

function formatScore(a, b) {
  return `${a} - ${b}`;
}

/** Ré-édite le message d'ouverture d'un match (utile au boot si l'embed
 *  a évolué depuis que le match a été lancé). No-op si pas d'openMessageId. */
export async function refreshOpenEmbedIfNeeded(client, match) {
  if (!match?.matchId || !match.channelId || !match.openMessageId) return;
  try {
    const ch = await client.channels.fetch(match.channelId).catch(() => null);
    if (!ch) return;
    const msg = await ch.messages.fetch(match.openMessageId).catch(() => null);
    if (!msg) return;
    if (msg.author?.id !== client.user?.id) return; // on n'édite que nos propres messages
    await msg.edit({ embeds: [buildOpenEmbed(match)] }).catch(() => {});
    log.info({ matchId: match.matchId, msgId: match.openMessageId }, 'openEmbed re-synchronisé');
  } catch (e) {
    log.warn({ err: e }, 'refreshOpenEmbedIfNeeded failed');
  }
}

/** Embed d'ouverture d'un match (utilisé par /prono-start ET la re-sync au boot). */
export function buildOpenEmbed(match) {
  const optA = match.optionNameA || teamOptionNames(match.teamA, match.teamB)[0];
  const optB = match.optionNameB || teamOptionNames(match.teamA, match.teamB)[1];
  return new EmbedBuilder()
    .setColor(COLOR_OPEN)
    .setTitle(`⚽ PRONOS OUVERTS · ${match.teamA} vs ${match.teamB}`)
    .setDescription([
      `**Un nouveau match est ouvert aux pronos !**`,
      '',
      `**Comment participer :**`,
      `Depuis n’importe quel salon, tape :`,
      `\`/prono ${optA}: <score ${match.teamA}> ${optB}: <score ${match.teamB}>\``,
      '',
      `Exemple : \`/prono ${optA}: 2 ${optB}: 1\` pour un ${match.teamA} 2 - 1 ${match.teamB}.`,
      '',
      `**Les pronostics de tous les membres seront affichés ici.**`,
      `Un seul prono par personne (le dernier remplace le précédent). Le salon est verrouillé sauf pour les admins.`,
      `Les pronos seront fermés juste avant le coup d’envoi (\`/prono-lock\`).`,
    ].join('\n'))
    .addFields(
      { name: `🔵 ${match.teamA}`, value: 'Score ?', inline: true },
      { name: '⚔️', value: 'vs', inline: true },
      { name: `🔴 ${match.teamB}`, value: 'Score ?', inline: true },
    )
    .setFooter({ text: `Lancé par ${match.startedByTag || '—'} · ${match.matchId}` })
    .setTimestamp(match.startedAt ? new Date(match.startedAt) : new Date());
}

function isAdmin(interaction) {
  const perms = interaction.memberPermissions;
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ManageGuild) || perms.has(PermissionFlagsBits.Administrator);
}

/* ─── /prono-start teamA teamB ───────────────────────────────────────── */
export async function cmdPronoStart(interaction) {
  if (!isAdmin(interaction)) return interaction.reply(ephemeral('Réservé aux admins.'));

  const teamA = String(interaction.options.getString('equipe_a', true) || '').trim();
  const teamB = String(interaction.options.getString('equipe_b', true) || '').trim();
  if (!teamA || !teamB) return interaction.reply(ephemeral('Les deux équipes sont requises.'));
  if (teamA.toLowerCase() === teamB.toLowerCase()) return interaction.reply(ephemeral('Les deux équipes doivent être différentes.'));

  const channelId = config.discord.channels.pronos;
  if (!channelId) return interaction.reply(ephemeral('DISCORD_CHANNEL_PRONOS non configuré (Railway).'));

  const existing = await loadMatch();
  if (existing?.matchId) {
    return interaction.reply(ephemeral(`Un match est déjà ouvert : **${existing.teamA}** vs **${existing.teamB}**. Ferme-le avec \`/prono-close\` avant d’en lancer un nouveau.`));
  }

  await interaction.deferReply(EPHEMERAL_DEFER);

  const lockRes = await setPronoChannelLock(interaction.client, true);
  if (!lockRes.ok) log.warn({ res: lockRes }, 'lock salon pronos échoué (le match est quand même ouvert)');

  const ch = await getChannelSafe(channelId);
  if (!ch) return interaction.editReply({ content: 'Salon pronos introuvable. Vérifie DISCORD_CHANNEL_PRONOS.' });

  const matchId = `m_${Date.now().toString(36)}`;
  const [optA, optB] = teamOptionNames(teamA, teamB);
  const draftMatch = {
    matchId,
    teamA,
    teamB,
    optionNameA: optA,
    optionNameB: optB,
    startedAt: new Date().toISOString(),
    startedBy: interaction.user.id,
    startedByTag: interaction.user.tag,
    channelId,
    predictions: {},
    predictionsLocked: false,
  };

  const embed = buildOpenEmbed(draftMatch);
  const openMsg = await ch.send({
    content: `@everyone 🎯 **NOUVEAU MATCH À PRONOSTIQUER : ${teamA} vs ${teamB}**`,
    embeds: [embed],
    allowedMentions: { parse: ['everyone'] },
  });

  const savedMatch = { ...draftMatch, openMessageId: openMsg.id };
  await saveMatch(savedMatch);

  // Met à jour la description de /prono pour afficher les équipes dans Discord
  await refreshGuildCommands({ activeMatch: savedMatch }).catch(() => {});

  return interaction.editReply({
    content: `Match ouvert : **${teamA}** vs **${teamB}**. Salon verrouillé pour les non-admins, embed posté dans <#${channelId}>.`,
  });
}

/* ─── /prono <equipeA> <equipeB> — options dynamiques par match ───────── */

/** Compat descendante : ancien flux modal (avant refactor).
 *  Ne s'active plus, mais on garde le handler pour éviter les erreurs
 *  au cas où un client afficherait encore un vieux modal en cache. */
export function isPronoModalId(customId) {
  return typeof customId === 'string' && customId.startsWith('prono_submit:');
}
export async function handlePronoModalSubmit(interaction) {
  return interaction.reply(ephemeral('Cette version de `/prono` est obsolète. Refais `/prono` : les scores se saisissent maintenant directement en options.'));
}

/** Lit les 2 valeurs de score depuis l'interaction, en essayant d'abord
 *  les noms d'options stockés dans le match, puis fallback sur les 2 premières
 *  options INTEGER (au cas où on aurait re-renommé les équipes entre-temps). */
function readScoresFromInteraction(interaction, match) {
  const tryGet = (name) => {
    try {
      const v = interaction.options.getInteger(name, false);
      return typeof v === 'number' ? v : null;
    } catch (_) { return null; }
  };
  let scoreA = tryGet(match.optionNameA);
  let scoreB = tryGet(match.optionNameB);

  if (scoreA == null || scoreB == null) {
    const intOpts = (interaction.options?.data || []).filter((o) => o.type === 4); // ApplicationCommandOptionType.Integer = 4
    if (intOpts.length >= 2) {
      if (scoreA == null) scoreA = intOpts[0].value;
      if (scoreB == null) scoreB = intOpts[1].value;
    }
  }
  return { scoreA, scoreB };
}

export async function cmdPronoSubmit(interaction) {
  const match = await loadMatch();
  if (!match?.matchId) return interaction.reply(ephemeral('Aucun match en cours. Attends qu’un admin lance `/prono-start`.'));
  if (match.predictionsLocked) return interaction.reply(ephemeral('⏳ Les pronos sont **fermés** pour ce match — le coup d’envoi est imminent ou passé.'));

  const { scoreA, scoreB } = readScoresFromInteraction(interaction, match);
  if (scoreA == null || scoreB == null) {
    return interaction.reply(ephemeral(`Impossible de lire ton prono. Refais \`/prono\` : deux champs t’attendent (score **${match.teamA}** et score **${match.teamB}**).`));
  }
  if (scoreA < 0 || scoreB < 0) return interaction.reply(ephemeral('Les scores doivent être ≥ 0.'));
  if (scoreA > 99 || scoreB > 99) return interaction.reply(ephemeral('Sois raisonnable (max 99).'));

  const userId = interaction.user.id;
  const previous = match.predictions?.[userId] || null;

  await interaction.deferReply(EPHEMERAL_DEFER);

  const ch = await getChannelSafe(match.channelId);
  if (!ch) return interaction.editReply({ content: 'Salon pronos introuvable.' });

  const label = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  const scoreLine = `**${match.teamA} ${formatScore(scoreA, scoreB)} ${match.teamB}**`;
  const embed = new EmbedBuilder()
    .setColor(COLOR_LOCKED)
    .setAuthor({
      name: label,
      iconURL: interaction.user.displayAvatarURL({ size: 64 }),
    })
    .setDescription(`🎯 Prono : ${scoreLine}`)
    .setFooter({ text: previous ? 'Mise à jour de son prono' : 'Nouveau prono' })
    .setTimestamp(new Date());

  const posted = await ch.send({ embeds: [embed] });

  if (previous?.messageId) {
    try { await ch.messages.delete(previous.messageId); } catch (_) {}
  }

  match.predictions = match.predictions || {};
  match.predictions[userId] = {
    userId,
    username: label,
    userTag: interaction.user.tag,
    scoreA,
    scoreB,
    at: new Date().toISOString(),
    messageId: posted.id,
  };
  await saveMatch(match);

  return interaction.editReply({
    content: `Prono enregistré : ${scoreLine}${previous ? ' (ancien prono remplacé)' : ''}. Publié dans <#${match.channelId}>.`,
  });
}

/* ─── /prono-close score_a score_b ───────────────────────────────────── */
export async function cmdPronoClose(interaction) {
  if (!isAdmin(interaction)) return interaction.reply(ephemeral('Réservé aux admins.'));

  const match = await loadMatch();
  if (!match?.matchId) return interaction.reply(ephemeral('Aucun match en cours.'));

  const scoreA = interaction.options.getInteger('score_a', true);
  const scoreB = interaction.options.getInteger('score_b', true);
  if (scoreA < 0 || scoreB < 0) return interaction.reply(ephemeral('Les scores doivent être ≥ 0.'));

  await interaction.deferReply(EPHEMERAL_DEFER);

  const ch = await getChannelSafe(match.channelId);
  if (!ch) return interaction.editReply({ content: 'Salon pronos introuvable.' });

  const preds = Object.values(match.predictions || {});
  const winnerA = scoreA > scoreB ? match.teamA : (scoreB > scoreA ? match.teamB : 'Match nul');
  const winners = preds.filter((p) => p.scoreA === scoreA && p.scoreB === scoreB);
  const closeVsWinnerSide = preds.filter((p) => {
    if (winners.includes(p)) return false;
    const predWinner = p.scoreA > p.scoreB ? match.teamA : (p.scoreB > p.scoreA ? match.teamB : 'Match nul');
    return predWinner === winnerA;
  });

  const winnersLine = winners.length
    ? winners.map((p) => `🏆 <@${p.userId}> (**${p.username}**)`).join('\n')
    : '_Aucun prono exact pour ce match._';
  const closeLine = closeVsWinnerSide.length
    ? closeVsWinnerSide.slice(0, 15).map((p) => `• ${p.username} → ${match.teamA} ${p.scoreA}-${p.scoreB} ${match.teamB}`).join('\n')
    : '';

  const embed = new EmbedBuilder()
    .setColor(COLOR_CLOSED)
    .setTitle(`🏁 MATCH TERMINÉ · ${match.teamA} ${formatScore(scoreA, scoreB)} ${match.teamB}`)
    .setDescription([
      `Vainqueur : **${winnerA}**`,
      `Pronos reçus : **${preds.length}**`,
      `Scores exacts : **${winners.length}**`,
    ].join('\n'))
    .addFields(
      { name: `🎯 Score exact (gagnants)`, value: winnersLine.slice(0, 1024) || '—' },
    )
    .setFooter({ text: `Match clôturé par ${interaction.user.tag} · ${match.matchId}` })
    .setTimestamp(new Date());
  if (closeLine) embed.addFields({ name: '👍 Bon vainqueur (score inexact)', value: closeLine.slice(0, 1024) });

  const mentionList = winners.map((w) => `<@${w.userId}>`).join(' ');
  await ch.send({
    content: `@everyone 🏁 **RÉSULTAT DU MATCH : ${match.teamA} ${formatScore(scoreA, scoreB)} ${match.teamB}**${winners.length ? `\n🎉 Bravo aux gagnants ! ${mentionList}` : ''}`,
    embeds: [embed],
    allowedMentions: { parse: ['everyone', 'users'] },
  });

  // Déverrouille le salon
  const unlockRes = await setPronoChannelLock(interaction.client, false);
  if (!unlockRes.ok) log.warn({ res: unlockRes }, 'unlock salon pronos échoué');

  await clearMatch();

  // Remet la description /prono en défaut
  await refreshGuildCommands({ activeMatch: null }).catch(() => {});

  return interaction.editReply({
    content: `Match clôturé. ${winners.length} gagnant(s) sur ${preds.length} prono(s). Salon rouvert à tous.`,
  });
}

/* ─── /prono-lock ────────────────────────────────────────────────────── */
export async function cmdPronoLock(interaction) {
  if (!isAdmin(interaction)) return interaction.reply(ephemeral('Réservé aux admins.'));
  const match = await loadMatch();
  if (!match?.matchId) return interaction.reply(ephemeral('Aucun match en cours.'));
  if (match.predictionsLocked) return interaction.reply(ephemeral('Les pronos sont déjà fermés pour ce match.'));

  await interaction.deferReply(EPHEMERAL_DEFER);

  match.predictionsLocked = true;
  match.lockedAt = new Date().toISOString();
  await saveMatch(match);

  // Retire les options de score de /prono (l'autocomplete ne les propose plus)
  await refreshGuildCommands({ activeMatch: match }).catch(() => {});

  const ch = await getChannelSafe(match.channelId);
  if (ch) {
    const preds = Object.values(match.predictions || {});
    const embed = new EmbedBuilder()
      .setColor(COLOR_LOCKED)
      .setTitle(`🔒 PRONOS FERMÉS · ${match.teamA} vs ${match.teamB}`)
      .setDescription([
        `**Les pronos sont maintenant fermés** — coup d’envoi imminent.`,
        `Plus aucun nouveau prono ni modification acceptée.`,
        '',
        `Pronos enregistrés : **${preds.length}**`,
        `Résultat annoncé après le match via \`/prono-close\`.`,
      ].join('\n'))
      .setFooter({ text: `Fermé par ${interaction.user.tag}` })
      .setTimestamp(new Date());
    await ch.send({
      content: `@everyone 🔒 **PRONOS FERMÉS pour ${match.teamA} vs ${match.teamB}** — bonne chance !`,
      embeds: [embed],
      allowedMentions: { parse: ['everyone'] },
    }).catch(() => {});
  }

  return interaction.editReply({
    content: `🔒 Pronos fermés pour **${match.teamA}** vs **${match.teamB}** (${Object.keys(match.predictions || {}).length} prono(s) enregistré(s)). Utilise \`/prono-close\` après le match pour annoncer les gagnants.`,
  });
}

/* ─── /prono-unlock ──────────────────────────────────────────────────── */
export async function cmdPronoUnlock(interaction) {
  if (!isAdmin(interaction)) return interaction.reply(ephemeral('Réservé aux admins.'));
  const match = await loadMatch();
  if (!match?.matchId) return interaction.reply(ephemeral('Aucun match en cours.'));
  if (!match.predictionsLocked) return interaction.reply(ephemeral('Les pronos sont déjà ouverts.'));

  await interaction.deferReply(EPHEMERAL_DEFER);

  match.predictionsLocked = false;
  match.lockedAt = null;
  await saveMatch(match);

  // Remet les options de score sur /prono
  await refreshGuildCommands({ activeMatch: match }).catch(() => {});

  const ch = await getChannelSafe(match.channelId);
  if (ch) {
    const embed = new EmbedBuilder()
      .setColor(COLOR_OPEN)
      .setTitle(`🔓 PRONOS RÉOUVERTS · ${match.teamA} vs ${match.teamB}`)
      .setDescription(`Les admins ont rouvert les pronos. Tape \`/prono\` pour envoyer ou modifier ton prono.`)
      .setFooter({ text: `Rouvert par ${interaction.user.tag}` })
      .setTimestamp(new Date());
    await ch.send({
      content: `@everyone 🔓 **PRONOS RÉOUVERTS pour ${match.teamA} vs ${match.teamB}**`,
      embeds: [embed],
      allowedMentions: { parse: ['everyone'] },
    }).catch(() => {});
  }

  return interaction.editReply({ content: `🔓 Pronos rouverts pour **${match.teamA}** vs **${match.teamB}**.` });
}

/* ─── /prono-status ──────────────────────────────────────────────────── */
export async function cmdPronoStatus(interaction) {
  if (!isAdmin(interaction)) return interaction.reply(ephemeral('Réservé aux admins.'));
  const match = await loadMatch();
  if (!match?.matchId) return interaction.reply(ephemeral('Aucun match en cours.'));
  const preds = Object.values(match.predictions || {});
  const lines = preds
    .slice(-20)
    .map((p) => `• ${p.username} → **${p.scoreA}-${p.scoreB}**`)
    .join('\n') || '_Aucun prono pour l’instant._';
  const state = match.predictionsLocked ? '🔒 Fermés (attente résultat)' : '🟢 Ouverts';
  const embed = new EmbedBuilder()
    .setColor(match.predictionsLocked ? COLOR_LOCKED : COLOR_OPEN)
    .setTitle(`📊 Prono en cours · ${match.teamA} vs ${match.teamB}`)
    .setDescription([
      `État : **${state}**`,
      `Ouvert : <t:${Math.floor(new Date(match.startedAt).getTime() / 1000)}:R>`,
      match.lockedAt ? `Fermé : <t:${Math.floor(new Date(match.lockedAt).getTime() / 1000)}:R>` : null,
      `Ouvert par : ${match.startedByTag || '—'}`,
      `Pronos reçus : **${preds.length}**`,
    ].filter(Boolean).join('\n'))
    .addFields({ name: 'Derniers pronos', value: lines.slice(0, 1024) });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
