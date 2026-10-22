/**
 * Proxy opcional para o Radar de Licitações (Cloudflare Workers, plano gratuito).
 * Permite que o painel consulte ao vivo o histórico de preços do Compras.gov.br,
 * que não aceita chamadas diretas de outros sites (CORS).
 *
 * Como publicar: dash.cloudflare.com > Workers & Pages > Create > Worker >
 * cole este código > Deploy. Depois, em Configurações do painel, use:
 *   https://SEU-WORKER.workers.dev/?url=
 */
const PERMITIDOS = ["dadosabertos.compras.gov.br", "pncp.gov.br"];

export default {
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const alvo = new URL(request.url).searchParams.get("url");
    let destino;
    try { destino = new URL(alvo); } catch { return new Response("url inválida", { status: 400, headers: cors }); }
    if (!PERMITIDOS.includes(destino.hostname)) return new Response("domínio não permitido", { status: 403, headers: cors });

    const r = await fetch(destino, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 radar-licitacoes" },
      cf: { cacheTtl: 21600, cacheEverything: true },
    });
    return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
  },
};
