import { SlashCommandBuilder, PermissionFlagsBits, REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { child } from '../lib/logger.js';
import { getBotState } from '../supabase.js';

const log = child({ mod: 'cmd-refresh' });

const PRONO_DESC_MAX = 100;
function pronoDescription({ activeMatch }) {
  if (activeMatch?.teamA && activeMatch?.teamB) {
    const dyn = `Prono : ${activeMatch.teamA} vs ${activeMatch.teamB} — score exact.`;
    if (dyn.length <= PRONO_DESC_MAX) return dyn;
    return dyn.slice(0, PRONO_DESC_MAX - 1) + '…';
  }
  return 'Envoie ton pronostic (score exact) pour le match en cours.';
}

/** Slugifie un nom d'équipe pour en faire une option Discord valide.
 *  Discord option name : lowercase, [a-z0-9_-], 1-32 chars, pas d'accents. */
function slugifyTeam(name) {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'equipe';
}

/** Renvoie 2 noms d'options uniques pour les 2 équipes. */
export function teamOptionNames(teamA, teamB) {
  let a = slugifyTeam(teamA);
  let b = slugifyTeam(teamB);
  if (a === b) {
    a = (a + '-a').slice(0, 32);
    b = (b + '-b').slice(0, 32);
  }
  return [a, b];
}

export function buildCommandDefs({ activeMatch = null } = {}) {
  const pronoCmd = new SlashCommandBuilder()
    .setName('prono')
    .setDescription(pronoDescription({ activeMatch }));
  if (activeMatch?.teamA && activeMatch?.teamB && !activeMatch.predictionsLocked) {
    const [optA, optB] = teamOptionNames(activeMatch.teamA, activeMatch.teamB);
    pronoCmd
      .addIntegerOption((o) => o
        .setName(optA)
        .setDescription(`Score ${activeMatch.teamA}`.slice(0, 100))
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(99))
      .addIntegerOption((o) => o
        .setName(optB)
        .setDescription(`Score ${activeMatch.teamB}`.slice(0, 100))
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(99));
  }

  const callsCmd = new SlashCommandBuilder()
    .setName('calls')
    .setDescription('Envoie ton call machine (un message dans le salon, 1 par personne).')
    .addStringOption((o) => o
      .setName('machine')
      .setDescription('Tape le nom de la slot puis choisis dans la liste')
      .setRequired(true)
      .setAutocomplete(true));

  return [
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
      .setName('live')
      .setDescription('Ouvre un hunt public partagé (lien live HugoTaSlot /h/…).')
      .addStringOption((o) => o
        .setName('slug')
        .setDescription('Slug du lien public (ex. abc123def4 depuis /h/…)')
        .setRequired(true)),
    new SlashCommandBuilder()
      .setName('slot')
      .setDescription('Tire une slot au hasard depuis le catalogue du site (jeux.json).'),
    new SlashCommandBuilder()
      .setName('machine')
      .setDescription('Choisis une slot du catalogue ou tire au hasard (hors concours calls).')
      .addStringOption((o) => o
        .setName('nom')
        .setDescription('Tape le nom (ex. Hounds of Hell) puis choisis dans la liste')
        .setRequired(false)
        .setAutocomplete(true)),
    new SlashCommandBuilder()
      .setName('activity')
      .setDescription('Lance l’Activity HugoTaSlot (Rich Presence avec logos 19ENPLEIN / Gamdom).'),
    /* ─── Pronos ─────────────────────────────────────────────────────── */
    new SlashCommandBuilder()
      .setName('prono-start')
      .setDescription('[Admin] Ouvre un nouveau match aux pronos et verrouille le salon pronos.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption((o) => o.setName('equipe_a').setDescription('Nom de la première équipe').setRequired(true))
      .addStringOption((o) => o.setName('equipe_b').setDescription('Nom de la seconde équipe').setRequired(true)),
    pronoCmd,
    new SlashCommandBuilder()
      .setName('prono-lock')
      .setDescription('[Admin] Ferme les pronos avant le coup d’envoi (plus aucune modification acceptée).')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('prono-unlock')
      .setDescription('[Admin] Rouvre les pronos en cas d’erreur (avant clôture du match).')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('prono-close')
      .setDescription('[Admin] Clôture le match en cours et annonce les gagnants.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addIntegerOption((o) => o.setName('score_a').setDescription('Score final équipe A').setRequired(true).setMinValue(0).setMaxValue(99))
      .addIntegerOption((o) => o.setName('score_b').setDescription('Score final équipe B').setRequired(true).setMinValue(0).setMaxValue(99)),
    new SlashCommandBuilder()
      .setName('prono-status')
      .setDescription('[Admin] Affiche l’état du match de pronos en cours.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    /* ─── Calls machines ─────────────────────────────────────────────── */
    callsCmd,
    new SlashCommandBuilder()
      .setName('calls-lock')
      .setDescription('[Admin] Ferme temporairement les calls (avant tirage).')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('calls-unlock')
      .setDescription('[Admin] Rouvre les calls.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('calls-close')
      .setDescription('[Admin] Annonce le gagnant + prix d’achat, puis remet les calls à zéro.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('calls-status')
      .setDescription('[Admin] Affiche les calls en cours.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ].map((c) => c.toJSON());
}

/** Re-push les slash commands à chaud (instantané sur guild).
 *  Si activeMatch omis, on relit bot_state. */
export async function refreshGuildCommands(opts = {}) {
  let { activeMatch } = opts;
  if (!('activeMatch' in opts)) {
    try {
      const m = await getBotState('active_prono_match');
      activeMatch = m?.matchId ? m : null;
    } catch (_) { activeMatch = null; }
  }
  const defs = buildCommandDefs({ activeMatch });
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  try {
    if (config.discord.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: defs },
      );
      log.info({ n: defs.length, prono: !!activeMatch }, 'slash commands rafraîchies (guild)');
    } else {
      await rest.put(Routes.applicationCommands(config.discord.clientId), { body: defs });
      log.info({ n: defs.length, prono: !!activeMatch }, 'slash commands rafraîchies (global)');
    }
  } catch (e) {
    log.warn({ err: e }, 'refreshGuildCommands failed');
  }
}
