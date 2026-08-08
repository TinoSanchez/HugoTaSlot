import { Client, GatewayIntentBits } from 'discord.js';

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
await c.login(process.env.DISCORD_TOKEN);
await new Promise((r) => c.once('ready', r));

console.log('bot', c.user.tag, c.user.id);
console.log('guilds:');
for (const g of c.guilds.cache.values()) console.log(' -', g.id, g.name);

const gid = process.env.DISCORD_GUILD_ID;
const slotsConfigured = process.env.DISCORD_CHANNEL_SLOTS;
console.log('DISCORD_GUILD_ID', gid);
console.log('DISCORD_CHANNEL_SLOTS', slotsConfigured);

try {
  const g = await c.guilds.fetch(gid);
  const chans = await g.channels.fetch();
  console.log('--- channels matching slot/nouve/casino ---');
  for (const ch of chans.values()) {
    if (!ch || (ch.type !== 0 && ch.type !== 5)) continue;
    const n = String(ch.name || '').toLowerCase();
    if (/slot|sorti|nouve|casino|jeu|release/.test(n) || ch.id === slotsConfigured) {
      console.log(ch.id, `#${ch.name}`, `type=${ch.type}`);
    }
  }
} catch (e) {
  console.log('guild fetch error', e.message);
}

try {
  const direct = await c.channels.fetch(slotsConfigured);
  console.log('direct fetch OK', direct?.name, 'guild=', direct?.guildId);
} catch (e) {
  console.log('direct fetch FAIL', e.message);
}

c.destroy();
process.exit(0);
