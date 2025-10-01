// api/add-song.js
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    const { title, artist } = req.body || {};
    if (!title || !artist) {
      return res.status(400).json({ error: 'Faltan campos: title y artist son requeridos' });
    }

    const {
      GH_TOKEN,
      GH_OWNER,
      GH_REPO,
      GH_PATH,
      GH_BRANCH = 'main',
    } = process.env;

    // 🔧 Diagnóstico claro de faltantes
    const missing = [];
    if (!GH_TOKEN) missing.push('GH_TOKEN');
    if (!GH_OWNER) missing.push('GH_OWNER');
    if (!GH_REPO) missing.push('GH_REPO');
    if (!GH_PATH) missing.push('GH_PATH');
    if (!GH_BRANCH) missing.push('GH_BRANCH');
    if (missing.length) {
      return res.status(500).json({
        error: 'Faltan variables de entorno del GitHub repo',
        missing, // p.ej. ["GH_TOKEN", "GH_PATH"]
      });
    }

    const base = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(GH_PATH)}?ref=${encodeURIComponent(GH_BRANCH)}`;

    // 1) Obtener contenido actual + sha
    const getResp = await fetch(base, {
      headers: { Authorization: `token ${GH_TOKEN}`, 'User-Agent': 'songster-bot' },
    });

    let current = [];
    let sha;

    if (getResp.status === 200) {
      const meta = await getResp.json();
      sha = meta.sha;
      const rawResp = await fetch(meta.download_url);
      current = await rawResp.json();
      if (!Array.isArray(current)) current = [];
    } else if (getResp.status === 404) {
      current = []; // primer commit del archivo
    } else {
      const text = await getResp.text();
      return res.status(500).json({ error: 'No se pudo leer el JSON', detail: text });
    }

    // 2) code incremental (5 dígitos)
    const nums = current
      .map(x => parseInt(String(x.code || '').replace(/\D+/g, ''), 10))
      .filter(n => !isNaN(n));
    const next = (nums.length ? Math.max(...nums) + 1 : 1);
    const code = String(next).padStart(5, '0');

    // 3) Evitar duplicados exactos
    const exists = current.some(x =>
      String(x.title || '').trim().toLowerCase() === String(title).trim().toLowerCase() &&
      String(x.artist || '').trim().toLowerCase() === String(artist).trim().toLowerCase()
    );
    if (exists) {
      return res.status(409).json({ error: 'La canción ya existe (misma Canción y Artista)' });
    }

    // 4) Nuevo registro
    const record = {
      title: String(title).trim(),
      artist: String(artist).trim(),
      code,
      created_at: new Date().toISOString()
    };
    const updated = [...current, record];
    const content = Buffer.from(JSON.stringify(updated, null, 2), 'utf-8').toString('base64');

    // 5) Commit a GitHub
    const putResp = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(GH_PATH)}`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${GH_TOKEN}`,
        'User-Agent': 'songster-bot',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `chore: nueva solicitud de canción ${record.title} - ${record.artist} (${code})`,
        content,
        branch: GH_BRANCH,
        ...(sha ? { sha } : {})
      }),
    });

    if (!putResp.ok) {
      const txt = await putResp.text();
      return res.status(500).json({ error: 'No se pudo escribir el JSON en GitHub', detail: txt });
    }

    return res.status(200).json({ ok: true, added: record });
  } catch (err) {
    return res.status(500).json({ error: 'Error inesperado', detail: String(err) });
  }
}

