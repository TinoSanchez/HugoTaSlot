import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { commandDefs } from './commands.js';
import { logger } from '../lib/logger.js';

async function main() {
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  if (config.discord.guildId) {
    logger.info({ guild: config.discord.guildId, n: commandDefs.length }, 'Enregistrement des commandes (guild)');
    await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), { body: commandDefs });
    logger.info('Commandes enregistrées au niveau guild (instantané).');
  } else {
    logger.info({ n: commandDefs.length }, 'Enregistrement des commandes (global)');
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commandDefs });
    logger.info('Commandes enregistrées au niveau global (peut prendre jusqu\'à 1h).');
  }
}

main().catch((e) => {
  logger.error({ err: e }, 'register-commands failed');
  process.exit(1);
});
