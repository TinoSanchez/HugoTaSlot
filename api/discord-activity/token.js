/**
 * OAuth token exchange pour Discord Activity (code → access_token).
 * Env Vercel : DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = process.env.DISCORD_CLIENT_ID || process.env.VITE_DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const code = req.body?.code;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET manquants sur Vercel' });
  }
  if (!code) {
    return res.status(400).json({ error: 'code requis' });
  }

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      return res.status(tokenRes.status || 400).json({
        error: data.error_description || data.error || 'Échange token échoué',
      });
    }
    return res.status(200).json({ access_token: data.access_token });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
