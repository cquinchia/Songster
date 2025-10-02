// api/add-song.js
export default async function handler(req, res) {
  // CORS simple
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

    // Comprobación clara de variables
    const missing = [];
    if (!GH_TOKEN)  missing.push('GH_TOKEN');
    if (!GH_OWNER)  missing.push('GH_OWNER');
    if (!GH_REPO)   missing.push('GH_REPO');
    if (!GH_PATH)   missing.push('GH_PATH');
    if (!GH_BRANCH) missing.push('GH_BRANCH');
    if (missing.length) {
      return res.status(500).json({ error: 'Faltan variables de entorno del GitHub repo', missing });
    }

    const base = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(GH_PATH)}`;

    // 1) LEER usando Contents API (NO download_url) para evitar caché y obtener el sha real
    const getResp = await fetch(`${base}?ref=${encodeURIComponent(GH_BRANCH)}`, {
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`, // Bearer funciona bien con fine-grained y classic
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'songster-bot'
      }
    });

    let current = [];
    let sha;

    if (getResp.status === 200) {
      const meta = await getResp.json();
      sha = meta.sha; // sha actual del blob
      // El contenido viene base64 con saltos de línea
      let raw = meta.content || '';
      if (meta.encoding === 'base64') {
        raw = Buffer.from(raw.replace(/\n/g, ''), 'base64').toString('utf-8');
      }
      try {
        const parsed = JSON.parse(raw);
        // Si por error el archivo no es un array, lo normalizamos
        current = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      } catch {
        current = [];
      }
    } else if (getResp.status === 404) {
      // primer commit del archivo
      current = [];
    } else {
      const text = await getResp.text();
      return res.status(500).json({ error: 'No se pudo leer el JSON', detail: text });
    }

    // 2) Evitar duplicados exactos (título+artista)
    const exists = current.some(x =>
      String(x.title || '').trim().toLowerCase() === String(title).trim().toLowerCase() &&
      String(x.artist || '').trim().toLowerCase() === String(artist).trim().toLowerCase()
    );
    if (exists) {
      return res.status(409).json({ error: 'La canción ya existe (misma Canción y Artista)' });
    }

    // 3) Generar code incremental (5 dígitos)
    const nums = current
      .map(x => parseInt(String(x.code || '').replace(/\D+/g, ''), 10))
      .filter(n => !isNaN(n));
    const next = (nums.length ? Math.max(...nums) + 1 : 1);
    const code = String(next).padStart(5, '0');

    // 4) Armar nuevo registro y APPEND
    const record = {
      title: String(title).trim(),
      artist: String(artist).trim(),
      code,
      created_at: new Date().toISOString()
    };
    const updated = [...current, record];

    // 5) PUT con el sha leído para que GitHub haga control de concurrencia
    const content = Buffer.from(JSON.stringify(updated, null, 2), 'utf-8').toString('base64');

    const putResp = await fetch(base, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'songster-bot',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `chore: nueva solicitud de canción ${record.title} - ${record.artist} (${code})`,
        content,
        branch: GH_BRANCH,
        ...(sha ? { sha } : {}) // si existe, es update; si no, lo crea
      }),
    });

    if (!putResp.ok) {
      const txt = await putResp.text();
      // Si otro commit entró mientras tanto, GitHub devuelve 409
      return res.status(500).json({ error: 'No se pudo escribir el JSON en GitHub', detail: txt });
    }

    return res.status(200).json({ ok: true, added: record });
  } catch (err) {
    return res.status(500).json({ error: 'Error inesperado', detail: String(err) });
  }
}
