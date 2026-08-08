import { Client, GatewayIntentBits, ChannelType } from 'discord.js';

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
await c.login(process.env.DISCORD_TOKEN);
await new Promise((r) => c.once('ready', r));

const gid = process.env.DISCORD_GUILD_ID;
const g = await c.guilds.fetch(gid);
const chans = await g.channels.fetch();
const rows = [...chans.values()]
  .filter((ch) => ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement))
  .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
  .map((ch) => `${ch.id}\t#${ch.name}`);
console.log(rows.join('\n'));
console.log('TOTAL', rows.length);
c.destroy();
process.exit(0);
