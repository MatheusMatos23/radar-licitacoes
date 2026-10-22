/* Radar de Licitações — módulo de cotação de fornecedores.
 * Cada item do edital pode ter várias cotações (marketplace, atacado, distribuidor regional, fábrica).
 * O menor custo efetivo (preço + frete rateado) vira o custo usado na análise. */
"use strict";

const TIPOS_FORNECEDOR = {
  regional: "Distribuidor da região",
  distribuidor: "Distribuidor / revenda",
  atacado: "Atacado",
  fabricante: "Fábrica",
  marketplace: "Marketplace",
};

const Cot = {
  todas: store.get("cotacoes", {}), // "id#n" -> [cotação]

  lista(key) { return this.todas[key] || []; },
  salvar() { store.set("cotacoes", this.todas); },
  adicionar(key, c) {
    (this.todas[key] = this.todas[key] || []).push({ ...c, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), em: new Date().toISOString() });
    this.salvar();
  },
  remover(key, id) {
    this.todas[key] = this.lista(key).filter(c => c.id !== id);
    if (!this.todas[key].length) delete this.todas[key];
    this.salvar();
  },

  /* Custo unitário efetivo = preço + frete total rateado pela quantidade do edital. */
  efetivo(c, qtd) {
    if (!(c.preco > 0)) return null;
    return c.preco + (c.frete > 0 && qtd > 0 ? c.frete / qtd : 0);
  },
  /* Menor custo entre as cotações que atendem à especificação; as de atendimento
   * incerto só valem quando não há nenhuma confirmada (e ficam sinalizadas). */
  melhor(key, qtd) {
    const validas = this.lista(key).filter(c =>
      this.efetivo(c, qtd) != null && c.atende !== "nao" && !(c.lote > 0 && qtd > 0 && c.lote > qtd));
    const confirmadas = validas.filter(c => c.atende === "sim");
    const pool = confirmadas.length ? confirmadas : validas;
    let best = null;
    for (const c of pool) {
      const e = this.efetivo(c, qtd);
      if (!best || e < best.efetivo) best = { ...c, efetivo: e, incerto: c.atende !== "sim" };
    }
    return best;
  },
  /* Cotação mais barata que a escolhida, mas com especificação ainda a confirmar. */
  aConfirmar(key, qtd) {
    const best = this.melhor(key, qtd);
    if (!best || best.incerto) return null;
    let alt = null;
    for (const c of this.lista(key)) {
      const e = this.efetivo(c, qtd);
      if (c.atende === "incerto" && e != null && e < best.efetivo && !(c.lote > qtd) && (!alt || e < alt.efetivo)) alt = { ...c, efetivo: e };
    }
    return alt;
  },
};

/* Cotações já pesquisadas (casos simulados / robô), por id do edital e número do item. */
function cotacoesPesquisadas(ed, it) {
  const caso = (S.casos || []).find(c => c.edital_id === ed.id);
  const item = caso?.itens.find(i => +i.n === +it.n);
  return item ? { caso, item } : null;
}

/* ---------------- interface do painel de cotação (dentro do detalhe do item) ---------------- */
function cotacaoHTML(it, r, ed) {
  const key = r.key;
  const cots = Cot.lista(key);
  const best = Cot.melhor(key, it.q);
  const pesq = cotacoesPesquisadas(ed, it);
  const maxEf = Math.max(...cots.map(c => Cot.efetivo(c, it.q) || 0), r.teto || 0, 1);

  const linhas = cots.map(c => {
    const ef = Cot.efetivo(c, it.q);
    const ehMelhor = best && best.id === c.id;
    const larg = ef ? Math.max(3, ef / maxEf * 100) : 0;
    return `<tr class="${ehMelhor ? "best" : ""}">
      <td><b>${esc(c.forn)}</b>${ehMelhor ? ` <span class="tag ${best.incerto ? "amber" : "green"}">${best.incerto ? "melhor custo (incerto)" : "melhor custo"}</span>` : ""}${c.atende === "incerto" ? ' <span class="tag amber">confirmar especificação</span>' : c.atende === "nao" ? ' <span class="tag red">não atende</span>' : ""}
        <div class="small muted">${esc(TIPOS_FORNECEDOR[c.tipo] || c.tipo)}${c.cidade ? " · " + esc(c.cidade) : ""}${c.fonte === "ia" ? " · pesquisado por IA" : ""}</div></td>
      <td class="r num">${c.preco > 0 ? brl(c.preco) : '<span class="muted">sob consulta</span>'}</td>
      <td class="r num">${c.frete > 0 ? brl(c.frete, 0) : "–"}</td>
      <td class="small">${c.lote ? nfmt(c.lote) + " un." : "–"}${c.prazo ? "<br>" + esc(c.prazo) : ""}</td>
      <td style="min-width:150px"><div class="bar"><span style="width:${larg}%"></span></div><div class="num small">${ef ? brl(ef) : "–"}</div></td>
      <td class="small">${c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">abrir</a>` : ""}${c.obs ? `<div class="muted">${esc(c.obs)}</div>` : ""}</td>
      <td><button class="btn sm ghost" data-rmcot="${esc(c.id)}" title="Remover">✕</button></td>
    </tr>`;
  }).join("");

  const tetoLinha = r.teto ? `<div class="small muted" style="margin:6px 0 0">Referência: teto do edital ${brl(r.teto)} · para manter ${nfmt(S.cfg.marg, 1)}% de margem no lance equilibrado, o custo efetivo precisa ficar até <b>${r.custoMax ? brl(r.custoMax) : "–"}</b>.</div>` : "";

  const pesquisaBox = pesq ? `<div class="note" style="margin-bottom:12px">
      <b>Cotação de referência (estudo de caso):</b> ${pesq.item.cotacoes.filter(c => c.preco_unit > 0).length} preços pesquisados em ${dataBR(pesq.caso.pesquisado_em)}.
      <button class="btn sm" data-importar="${esc(key)}" style="margin-left:6px">Importar para minha cotação</button></div>` : "";

  return `${pesquisaBox}
    ${cots.length ? `<table class="hist cot"><thead><tr><th>Fornecedor</th><th class="r">Preço unit.</th><th class="r">Frete total</th><th>Lote mín. / prazo</th><th>Custo efetivo unit.</th><th>Fonte</th><th></th></tr></thead><tbody>${linhas}</tbody></table>${tetoLinha}`
      : `<p class="small muted" style="margin-top:0">Nenhuma cotação ainda. Pesquise em pelo menos <b>três tipos de fonte</b> — marketplace, atacado e um distribuidor da região. O melhor preço nem sempre está na internet: distribuidores locais dão desconto por lote e o frete sai mais barato.</p>`}
    <details class="add-cot" ${cots.length ? "" : "open"}>
      <summary>+ Registrar cotação</summary>
      <form class="cot-form" data-key="${esc(key)}">
        <input name="forn" placeholder="Fornecedor" required>
        <select name="tipo">${Object.entries(TIPOS_FORNECEDOR).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        <input name="cidade" placeholder="Cidade/UF">
        <input name="preco" type="number" step="0.01" min="0" placeholder="Preço unit. (R$)">
        <input name="frete" type="number" step="0.01" min="0" placeholder="Frete total (R$)">
        <input name="lote" type="number" step="1" min="0" placeholder="Lote mínimo">
        <input name="prazo" placeholder="Prazo de entrega">
        <input name="link" type="url" placeholder="Link (opcional)">
        <select name="atende"><option value="sim">Atende a especificação</option><option value="incerto">Atendimento incerto</option><option value="nao">Não atende</option></select>
        <button class="btn primary sm">Adicionar</button>
      </form>
    </details>
    <div class="cot-actions">
      <button class="btn sm" data-ia="${esc(key)}" title="Um agente de IA pesquisa preços na web (requer chave da API Claude em Configurações)">Pesquisar com agente de IA</button>
      <button class="btn sm" data-pedido="${esc(key)}">Gerar pedido de cotação</button>
    </div>
    <div class="ia-out" data-iaout="${esc(key)}"></div>
    <div class="pedido-out" data-pedidoout="${esc(key)}"></div>`;
}

function importarPesquisa(ed, it, key) {
  const p = cotacoesPesquisadas(ed, it);
  if (!p) return;
  const existentes = new Set(Cot.lista(key).map(c => c.link));
  let n = 0;
  for (const c of p.item.cotacoes) {
    if (!(c.preco_unit > 0) || existentes.has(c.link)) continue;
    Cot.adicionar(key, {
      forn: c.fornecedor, tipo: c.tipo in TIPOS_FORNECEDOR ? c.tipo : "distribuidor", cidade: c.cidade_uf || "",
      preco: +c.preco_unit, frete: 0, lote: 0, prazo: c.prazo_entrega || "", link: c.link || "",
      atende: c.atende_especificacao === "nao" ? "nao" : c.atende_especificacao === "sim" ? "sim" : "incerto",
      obs: c.observacao ? c.observacao.slice(0, 140) : "", fonte: "pesquisa",
    });
    n++;
  }
  toast(n ? `${n} cotação(ões) importada(s)` : "Nada novo para importar");
}

/* ---------------- pedido de cotação (WhatsApp / e-mail) ---------------- */
function textoPedido(it, ed) {
  const base = S.cfg.base || "(sua cidade)";
  return `Olá! Sou da empresa ${S.cfg.empresa || "(sua empresa)"}, de ${base}, e gostaria de uma cotação para fornecimento a órgão público:

Produto: ${it.d}
Quantidade: ${nfmt(it.q, 2)} ${it.u}
Entrega: ${ed.municipio}/${ed.uf} (${ed.orgao})
Previsão de pedido: após o resultado da licitação, que encerra em ${dataBR(ed.encerramento)}.

Por favor, informe:
1. Preço unitário à vista e para faturamento em 30 dias
2. Frete até ${ed.municipio}/${ed.uf} (ou retirada)
3. Lote mínimo e desconto por volume
4. Prazo de entrega após o pedido
5. Marca/modelo e ficha técnica (precisa atender à especificação acima)
6. Validade da proposta (ideal: 60 dias)

Obrigado!`;
}
function pedidoHTML(it, ed) {
  const txt = textoPedido(it, ed);
  const assunto = `Cotação: ${termoBusca(it.d)} — ${nfmt(it.q)} ${it.u}`;
  return `<div class="pedido">
    <textarea rows="12" readonly>${esc(txt)}</textarea>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button class="btn sm" data-copiar>Copiar texto</button>
      <a class="btn sm" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">Abrir no WhatsApp</a>
      <a class="btn sm" href="mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(txt)}">Abrir no e-mail</a>
    </div>
    <p class="small muted">Envie para 3 a 5 fornecedores. Fornecedores da região sugeridos na aba <b>Fornecedores</b>.</p>
  </div>`;
}

/* ---------------- agente de IA (API Claude, chave do próprio usuário) ---------------- */
const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm";
let clienteIA = null;

async function obterCliente() {
  if (!S.cfg.chaveIA) throw new Error("Configure sua chave da API Claude em Configurações.");
  if (!clienteIA || clienteIA._chave !== S.cfg.chaveIA) {
    const { default: Anthropic } = await import(SDK_URL);
    // A chave fica só neste navegador e vai direto para a API da Anthropic.
    clienteIA = new Anthropic({ apiKey: S.cfg.chaveIA, dangerouslyAllowBrowser: true });
    clienteIA._chave = S.cfg.chaveIA;
  }
  return clienteIA;
}

function promptCotacao(it, ed) {
  return `Você é um comprador experiente de uma pequena empresa de ${S.cfg.base || "São Paulo"}/${S.cfg.uf} que revende para órgãos públicos SEM ESTOQUE (compra do fornecedor só depois de ganhar a licitação).

Pesquise na web preços REAIS e atuais para este item de licitação:
- Especificação: ${it.d}
- Quantidade: ${it.q} ${it.u}
- Local de entrega: ${ed.municipio}/${ed.uf}
- Teto do edital (preço máximo unitário): ${it.v > 0 ? "R$ " + it.v : "sigiloso"}

Busque em fontes DIVERSAS, não só marketplaces:
1. distribuidores e revendas da REGIÃO de ${ed.municipio} e ${S.cfg.base || ed.municipio} (cidades próximas), que vendem para CNPJ;
2. atacadistas / B2B com preço por caixa, fardo ou lote;
3. fabricante ou distribuidor oficial (para o volume do edital);
4. marketplaces (Mercado Livre, Amazon, Magalu etc.) como referência.
O produto precisa atender à especificação. Converta o preço para a MESMA unidade do edital (${it.u}). Nunca invente preço: só registre preço que você viu, com o link. Fornecedor que só passa preço por orçamento pode entrar com preco_unit null.

Responda APENAS com um JSON válido, sem texto antes ou depois, neste formato:
{"cotacoes":[{"fornecedor":"","tipo":"regional|distribuidor|atacado|fabricante|marketplace","cidade_uf":"","preco_unit":0,"lote_minimo":0,"prazo_entrega":"","link":"","atende_especificacao":"sim|incerto|nao","observacao":""}],"resumo":"2 frases: melhor opção e cuidado principal"}
Traga de 4 a 8 cotações.`;
}

async function pesquisarComIA(it, ed, key, alvo) {
  alvo.innerHTML = `<div class="note"><span class="loader"></span> O agente está pesquisando fornecedores na web (marketplaces, atacado, distribuidores da região). Leva de 30 s a 2 min…</div>`;
  try {
    const client = await obterCliente();
    const messages = [{ role: "user", content: promptCotacao(it, ed) }];
    let resposta;
    for (let volta = 0; volta < 4; volta++) {
      resposta = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8, user_location: { type: "approximate", country: "BR", region: ed.uf } }],
        messages,
      });
      if (resposta.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: resposta.content }); // continua a pesquisa
    }
    if (resposta.stop_reason === "refusal") throw new Error("O modelo recusou esta pesquisa.");
    const texto = resposta.content.filter(b => b.type === "text").map(b => b.text).join("");
    const json = JSON.parse(texto.slice(texto.indexOf("{"), texto.lastIndexOf("}") + 1));
    let n = 0;
    for (const c of json.cotacoes || []) {
      Cot.adicionar(key, {
        forn: c.fornecedor || "Fornecedor", tipo: c.tipo in TIPOS_FORNECEDOR ? c.tipo : "distribuidor", cidade: c.cidade_uf || "",
        preco: +c.preco_unit || 0, frete: 0, lote: +c.lote_minimo || 0, prazo: c.prazo_entrega || "", link: c.link || "",
        atende: c.atende_especificacao || "incerto", obs: (c.observacao || "").slice(0, 140), fonte: "ia",
      });
      n++;
    }
    const buscas = resposta.usage?.server_tool_use?.web_search_requests ?? "?";
    toast(`${n} cotações encontradas pelo agente`);
    renderAnaliseMantendo();
    const novo = document.querySelector(`[data-iaout="${CSS.escape(key)}"]`);
    if (novo) novo.innerHTML = `<div class="note"><b>Agente de IA:</b> ${esc(json.resumo || "")} <span class="muted small">(${buscas} buscas na web · confira cada link antes de fechar negócio)</span></div>`;
  } catch (e) {
    const msg = e.status === 401 ? "chave da API inválida — confira em Configurações."
      : e.status === 429 ? "limite de uso da API atingido; tente de novo em alguns minutos."
      : e.status === 402 || /credit/i.test(e.message) ? "sem créditos na conta Anthropic."
      : e instanceof SyntaxError ? "o agente não devolveu as cotações no formato esperado; tente novamente."
      : e.message;
    alvo.innerHTML = `<div class="callout small">Não foi possível pesquisar: ${esc(msg)}</div>`;
  }
}
