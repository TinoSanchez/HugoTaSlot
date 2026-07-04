import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';

const statusEl = document.getElementById('status');
const siteLink = document.getElementById('site-link');

function setStatus(msg, cls = '') {
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.className = `status ${cls}`.trim();
  }
}

async function loadConfig() {
  const r = await fetch('./config.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('config.json introuvable');
  return r.json();
}

async function exchangeToken(code, siteUrl) {
  patchUrlMappings([{ prefix: '/ht-api', target: 'hugotaslot.fr' }]);
  const r = await fetch('/ht-api/api/discord-activity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    throw new Error(data.error || data.message || `Token HTTP ${r.status}`);
  }
  return data.access_token;
}

async function applyRichPresence(discordSdk, siteUrl) {
  const base = siteUrl.replace(/\/$/, '');
  await discordSdk.commands.setActivity({
    activity: {
      type: 0,
      details: '19ENPLEIN CASINO',
      state: 'Gamdom · Bonus Hunt',
      assets: {
        large_image: `${base}/discord-activity/assets/image_19.png`,
        large_text: '19ENPLEIN CASINO',
        small_image: `${base}/discord-activity/assets/gamdom.png`,
        small_text: 'Gamdom',
      },
      timestamps: { start: Math.floor(Date.now() / 1000) },
      party: { size: [1, 5] },
    },
  });
}

async function main() {
  const cfg = await loadConfig();
  const clientId = String(cfg.clientId || '').trim();
  const siteUrl = String(cfg.siteUrl || 'https://hugotaslot.fr').trim();

  if (siteLink) siteLink.href = siteUrl;

  if (!clientId) {
    setStatus('DISCORD_CLIENT_ID manquant (config.json / build Vercel)', 'err');
    return;
  }

  const discordSdk = new DiscordSDK(clientId);

  try {
    await discordSdk.ready();
    setStatus('SDK prêt — autorisation…');

    const { code } = await discordSdk.commands.authorize({
      client_id: clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify', 'rpc.activities.write'],
    });

    const accessToken = await exchangeToken(code, siteUrl);
    await discordSdk.commands.authenticate({ access_token: accessToken });

    await applyRichPresence(discordSdk, siteUrl);
    setStatus('Rich Presence active (images + 19ENPLEIN / Gamdom)', 'ok');
  } catch (e) {
    console.error('[discord-activity]', e);
    setStatus(String(e?.message || e || 'Erreur Activity'), 'err');
  }
}

main();
