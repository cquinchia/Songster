// api/health.js
export default async function handler(_req, res) {
  const names = ['GH_TOKEN','GH_OWNER','GH_REPO','GH_PATH','GH_BRANCH'];
  const defined = names.filter(n => !!process.env[n]);
  const missing = names.filter(n => !process.env[n]);

  // No devolvemos GH_TOKEN por seguridad
  return res.status(200).json({
    ok: missing.length === 0,
    defined,          // p.ej. ["GH_OWNER","GH_REPO","GH_PATH","GH_BRANCH"]
    missing,          // p.ej. ["GH_TOKEN"]
    // para comprobar que no hay espacios/errores tipográficos:
    preview: {
      GH_OWNER: process.env.GH_OWNER || null,
      GH_REPO: process.env.GH_REPO || null,
      GH_PATH: process.env.GH_PATH || null,
      GH_BRANCH: process.env.GH_BRANCH || null
    }
  });
}
