/* Radar de Licitações — painel estático (GitHub Pages).
 * Fontes: data/*.json (gerados pelo robô scripts/coletar.py) + API pública do PNCP ao vivo. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];
const LIMITE_PORTE = { MEI: 81000, ME: 360000, EPP: 4800000, DEMAIS: Infinity };
const BENEFICIO = { 1: "Exclusivo ME/EPP", 2: "Subcontratação ME/EPP", 3: "Cota reservada ME/EPP", 4: "Sem benefício", 5: "Não se aplica" };
const PNCP = "https://pncp.gov.br/api";
const PRECOS_API = "https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial";

const CFG_PADRAO = { empresa: "", chaveIA: "", porte: "ME", uf: "SP", base: "", fat: 0, imp: 6, frete: 4, out: 2, marg: 15, dist: 1, proxy: "" };

/* ---------------- armazenamento seguro ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("radar." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("radar." + k, JSON.stringify(v)); } catch { /* modo privado */ } },
};

const S = {
  cfg: { ...CFG_PADRAO, ...store.get("cfg", {}) },
  custos: store.get("custos", {}),     // "id#n" -> custo unitário digitado
  sel: store.get("sel", {}),           // "id#n" -> true/false (participar do item)
  carteira: store.get("carteira", {}), // id -> resumo do edital
  base: { editais: [], precos: {}, meta: null },
  precosVivo: {},                      // preços consultados via proxy nesta sessão
  mun: { porIbge: new Map(), porNome: new Map() },
  fonte: "base",
  resultados: [],
  vivoBruto: [],                       // tudo que veio do PNCP ao vivo, antes dos filtros
  mostrados: 0,
  livePagina: 0,
  liveTotal: 0,
  atual: null,
  itFiltro: { q: "", ver: "todos", ord: "num" }, // filtro da tabela de itens da análise
};

/* ---------------- utilitários ---------------- */
const brl = (v, dec = 2) => v == null || isNaN(v) ? "–" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: dec, maximumFractionDigits: dec });
const brlCurto = v => {
  if (v == null || isNaN(v)) return "–";
  if (v >= 1e6) return "R$ " + (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi";
  if (v >= 1e3) return "R$ " + (v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " mil";
  return brl(v, 0);
};
const nfmt = (v, d = 0) => v == null || isNaN(v) ? "–" : v.toLocaleString("pt-BR", { maximumFractionDigits: d });
const pct = v => v == null || isNaN(v) ? "–" : (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const dataBR = s => s ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T12:00" : s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–";
const dataHoraBR = s => s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";
const dias = s => s ? (new Date(s) - Date.now()) / 864e5 : null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2600);
}

async function getJSON(url, { timeout = 30000 } = {}) {
  const ctl = new AbortController();
  const h = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (r.status === 204 || r.status === 404) return null;
    if (!r.ok) throw new Error("HTTP " + r.status);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  } finally { clearTimeout(h); }
}

async function emLotes(lista, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (i < lista.length) { const k = i++; await fn(lista[k], k); }
  });
  await Promise.all(workers);
}

const ICON = {
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  gavel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 6l4 4M9 11l4 4M12 4l8 8-3 3-8-8zM3 21l7-7"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  starOn: '<svg viewBox="0 0 24 24" width="15" height="15" fill="#c99a2e" stroke="#c99a2e" stroke-width="2"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
};

/* ---------------- municípios e distância ---------------- */
function achaMunicipio(nome, uf) {
  if (!nome) return null;
  const n = norm(nome).trim();
  return S.mun.porNome.get(n + "|" + uf) || [...S.mun.porNome.entries()].find(([k]) => k.startsWith(n + "|"))?.[1] || null;
}
function distanciaKm(a, b) {
  if (!a || !b) return null;
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.25; // fator ~estrada
}
function baseAtual() { return achaMunicipio($("#fBase").value || S.cfg.base, $("#fUf").value || S.cfg.uf); }

/* ---------------- normalização de dados do PNCP ---------------- */
function itemDoPncp(it) {
  const cat = it.catalogo?.id;
  return {
    n: it.numeroItem, d: (it.descricao || "").trim().slice(0, 400), q: it.quantidade || 0,
    u: it.unidadeMedida || "", v: it.valorUnitarioEstimado || 0, s: !!it.orcamentoSigiloso,
    b: it.tipoBeneficio, m: it.materialOuServico,
    c: cat === 1 && it.catalogoCodigoItem ? String(it.catalogoCodigoItem) : null, r: !!it.temResultado,
  };
}
function editalDaBusca(e) {
  return {
    id: e.numero_controle_pncp, cnpj: e.orgao_cnpj, ano: e.ano, seq: e.numero_sequencial,
    titulo: e.title, objeto: (e.description || "").trim(), orgao: e.orgao_nome, unidade: e.unidade_nome,
    municipio: e.municipio_nome, ibge: e.codigo_ibge, uf: e.uf, esfera: e.esfera_nome,
    modalidade: e.modalidade_licitacao_nome, publicacao: (e.data_publicacao_pncp || "").slice(0, 16),
    abertura: (e.data_inicio_vigencia || "").slice(0, 16), encerramento: (e.data_fim_vigencia || "").slice(0, 16),
    url: `https://pncp.gov.br/app/editais/${e.orgao_cnpj}/${e.ano}/${e.numero_sequencial}`, itens: null,
  };
}
async function carregarItens(ed) {
  if (ed.itens) return ed.itens;
  let todos = [], p = 1;
  while (true) {
    const d = await getJSON(`${PNCP}/pncp/v1/orgaos/${ed.cnpj}/compras/${ed.ano}/${ed.seq}/itens?pagina=${p}&tamanhoPagina=100`);
    if (!d || !d.length) break;
    todos = todos.concat(d);
    if (d.length < 100) break;
    p++;
  }
  ed.itens = todos.map(itemDoPncp);
  return ed.itens;
}

/* ---------------- histórico de preços ---------------- */
function hist(c) {
  if (!c) return null;
  const h = S.base.precos[c] || S.precosVivo[c];
  return h && h.n > 0 ? h : null;
}
async function buscarPrecoVivo(c) {
  if (!S.cfg.proxy || !c || c in S.precosVivo || S.base.precos[c]) return;
  const fim = new Date(), ini = new Date(Date.now() - 365 * 864e5);
  const alvo = `${PRECOS_API}?pagina=1&tamanhoPagina=500&tipo=codigoItemCatalogo&codigo=${c}&dataCompraInicio=${ini.toISOString().slice(0, 10)}&dataCompraFim=${fim.toISOString().slice(0, 10)}`;
  try {
    const d = await getJSON(S.cfg.proxy + encodeURIComponent(alvo), { timeout: 45000 });
    S.precosVivo[c] = resumirPrecos(d?.resultado || []);
  } catch { S.precosVivo[c] = { n: 0 }; }
}
function quantil(arr, p) {
  if (arr.length === 1) return arr[0];
  const k = (arr.length - 1) * p, f = Math.floor(k);
  return arr[f] + (arr[Math.min(f + 1, arr.length - 1)] - arr[f]) * (k - f);
}
function resumirPrecos(regs) {
  regs = regs.filter(r => r.precoUnitario > 0);
  if (!regs.length) return { n: 0 };
  let p = regs.map(r => +r.precoUnitario).sort((a, b) => a - b);
  if (p.length >= 8) {
    const q1 = quantil(p, .25), q3 = quantil(p, .75), iqr = q3 - q1;
    const f = p.filter(x => x >= q1 - 3 * iqr && x <= q3 + 3 * iqr);
    if (f.length) p = f;
  }
  regs.sort((a, b) => String(b.dataResultado || b.dataCompra).localeCompare(String(a.dataResultado || a.dataCompra)));
  return {
    n: p.length, total: regs.length, min: p[0], p25: quantil(p, .25), med: quantil(p, .5), p75: quantil(p, .75), max: p[p.length - 1],
    ult: regs.slice(0, 12).map(r => ({ data: r.dataResultado || r.dataCompra, preco: +r.precoUnitario, qtd: r.quantidade, uf: r.estado, mun: r.municipio, orgao: r.nomeUasg || r.nomeOrgao, forn: r.nomeFornecedor, marca: r.marca, un: r.nomeUnidadeFornecimento || r.siglaUnidadeMedida })),
  };
}

/* ---------------- motor de decisão ---------------- */
function taxas(ed) {
  const c = S.cfg;
  const freteP = (+c.frete || 0) + (+c.dist || 0) * ((ed?._dist || 0) / 100);
  return { T: ((+c.imp || 0) + (+c.out || 0) + freteP) / 100, M: (+c.marg || 0) / 100, freteP };
}

/* Probabilidade aproximada de vencer com um lance, usando a distribuição de preços vencedores. */
function chance(lance, h, teto) {
  if (lance == null) return null;
  if (h && h.n >= 3) {
    const pts = [[h.min, .9], [h.p25, .72], [h.med, .5], [h.p75, .28], [h.max, .08]];
    if (lance <= pts[0][0]) return .92;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (lance <= x1) return x1 === x0 ? y1 : y0 + (y1 - y0) * (lance - x0) / (x1 - x0);
    }
    return .04;
  }
  if (teto) {
    const r = lance / teto; // deságio típico em pregão eletrônico: 15% a 30%
    return clamp(1.55 - 1.4 * r, .05, .85);
  }
  return null;
}

function calcular(it, ed) {
  const h = hist(it.c);
  const teto = it.v > 0 ? it.v : null;
  const { T, M } = taxas(ed);
  let agr = null, equ = null, con = null, fonteRef = null;
  if (h) {
    agr = h.p25; equ = h.med; con = h.p75; fonteRef = "hist";
    if (teto) { agr = Math.min(agr, teto); equ = Math.min(equ, teto); con = Math.min(con, teto); }
  } else if (teto) {
    agr = teto * .75; equ = teto * .85; con = teto * .95; fonteRef = "teto";
  }
  const unidadeSuspeita = h && teto && (h.med / teto > 3 || h.med / teto < .3);
  const key = ed.id + "#" + it.n;
  // Custo digitado manualmente tem prioridade; senão, usa a melhor cotação registrada
  const melhorCot = typeof Cot !== "undefined" ? Cot.melhor(key, it.q) : null;
  const custoManual = S.custos[key] > 0 ? +S.custos[key] : null;
  const custo = custoManual ?? (melhorCot ? Math.round(melhorCot.efetivo * 100) / 100 : null);
  const fator = 1 - T - M;
  const custoMax = equ != null && fator > 0 ? equ * fator : null;
  const compreAte = teto && fator > 0 ? teto * fator : custoMax; // custo máximo admissível, lance no teto
  const r = { h, teto, agr, equ, con, fonteRef, unidadeSuspeita, key, custo, custoManual, melhorCot, custoMax, compreAte, T, M, lance: equ, veredito: "unk" };

  if (custo != null && fator > 0) {
    const pMin = custo / fator;
    r.pMin = pMin;
    const limite = teto || con;
    if (agr != null && pMin <= agr) { r.veredito = "go"; r.lance = agr; }
    else if (equ != null && pMin <= equ) { r.veredito = "ok"; r.lance = Math.ceil(pMin * 100) / 100; }
    else if (limite != null && pMin <= limite) { r.veredito = "tight"; r.lance = Math.ceil(pMin * 100) / 100; }
    else if (limite != null) { r.veredito = "no"; r.lance = null; }
    else { r.veredito = "unk"; r.lance = Math.ceil(pMin * 100) / 100; }
  }
  if (r.lance != null) {
    r.chance = chance(r.lance, h, teto);
    if (custo != null) {
      r.lucroUn = r.lance * (1 - T) - custo;
      r.margem = r.lucroUn / r.lance;
      r.lucro = r.lucroUn * it.q;
    }
    r.receita = r.lance * it.q;
  }
  return r;
}

/* Alertas por tipo de produto, aprendidos nos estudos de caso: o que pode barrar a revenda antes da margem. */
const ALERTAS = [
  [/hospitalar|m[eé]dic|odontol|desfibril|ox[ií]metro|autoclave|esterilizaç|cir[uú]rgic|ortop|seringa|cateter|monitor multiparam/i,
    "red", "Produto para saúde", "Revender exige AFE da Anvisa, licença sanitária e responsável técnico, além do registro Anvisa do modelo."],
  [/saneante|desinfetante|cloro|[aá]gua sanit|hipoclorito|detergente|alvejante|inseticida/i,
    "amber", "Saneante", "O produto precisa de notificação/registro na Anvisa. Peça o número ao fornecedor."],
  [/saco (de |p\/ )?lixo|saco lixo/i, "amber", "Norma ABNT", "Sacos de lixo costumam exigir a NBR 9191 — peça o laudo ao fabricante."],
  [/extintor|capacete|luva|bota|[oó]culos de prote|protetor auricular|cinto de seguran|\bEPI\b/i,
    "amber", "Certificação", "Equipamento de proteção ou segurança: exige CA (Certificado de Aprovação) ou Inmetro."],
  [/medicament|f[aá]rmaco|comprimido|ampola/i, "red", "Medicamento", "Exige AFE de distribuidora de medicamentos e farmacêutico responsável."],
  [/aliment|g[eê]nero|carne|hortifr|leite|p[aã]o\b/i, "amber", "Alimento", "Perecível: entrega frequente, refrigeração e licença sanitária podem ser exigidas."],
  [/instala[cç][aã]o|montagem|treinamento|assist[eê]ncia t[eé]cnica/i, "amber", "Serviço embutido", "O item inclui instalação, montagem ou assistência: considere esse custo e quem vai executar."],
];
/* "PCT COM 100", "CX C/ 12", "caixa com 50 unidades" -> 100, 12, 50 */
function unidadesPorEmbalagem(desc) {
  const m = desc.match(/(?:pct|pacote|cx|caixa|embalagem|kit|fardo|rolo|bloco)\.?\s*(?:com|c\/|de)\s*(\d{2,5})/i);
  return m ? +m[1] : null;
}
function alertasItem(it) {
  return ALERTAS.filter(([re]) => re.test(it.d)).map(([, cor, rotulo, dica]) => `<span class="tag ${cor}" title="${esc(dica)}">${rotulo}</span>`).join("");
}

const VEREDITO = {
  go: ["v-go", "Entrar forte"], ok: ["v-ok", "Viável"], tight: ["v-tight", "Margem apertada"],
  no: ["v-no", "Não compensa"], unk: ["v-unk", "A cotar"],
};

/* Atratividade 0–100 de um edital para pequena empresa revendedora. */
function pontuar(ed) {
  let s = 0;
  const d = dias(ed.encerramento);
  s += d == null ? 6 : d < 1 ? 0 : d < 3 ? 5 : d <= 20 ? 15 : 10;
  s += ed._dist == null ? 12 : ed._dist <= 60 ? 25 : ed._dist <= 150 ? 19 : ed._dist <= 300 ? 11 : 4;
  const itens = (ed._alvo?.length ? ed._alvo : ed.itens)?.filter(i => i.m !== "S");
  if (itens && itens.length) {
    const me = itens.filter(i => i.b === 1 || i.b === 3).length / itens.length;
    s += 20 * me;
    const comRef = itens.filter(i => i.v > 0 || hist(i.c)).length / itens.length;
    s += 10 * comRef;
    const folgas = itens.map(i => { const h = hist(i.c); return h && i.v > 0 ? clamp((i.v - h.med) / i.v, -0.2, .4) : null; }).filter(x => x != null);
    s += folgas.length ? 20 * clamp((folgas.reduce((a, b) => a + b, 0) / folgas.length + .1) / .5, 0, 1) : 8;
    s += ed._valor && ed._valor <= limiteRestante() ? 10 : ed._valor ? 0 : 5;
  } else {
    s += 25; // sem itens ainda: neutro
  }
  return Math.round(clamp(s, 0, 100));
}
function limiteRestante() { return (LIMITE_PORTE[S.cfg.porte] ?? Infinity) - (+S.cfg.fat || 0); }

function enriquecer(ed, termos) {
  const mu = S.mun.porIbge.get(+ed.ibge) || achaMunicipio(ed.municipio, ed.uf);
  ed._dist = distanciaKm(baseAtual(), mu);
  if (ed.itens) {
    const mat = ed.itens.filter(i => i.m !== "S");
    ed._alvo = termos.length ? mat.filter(i => termos.every(t => norm(i.d).includes(t))) : [];
    const conj = ed._alvo.length ? ed._alvo : mat;
    ed._valor = conj.reduce((a, i) => a + (i.v > 0 ? i.v * i.q : 0), 0) || null;
    ed._me = conj.filter(i => i.b === 1 || i.b === 3).length;
    ed._hist = conj.filter(i => hist(i.c)).length;
    ed._nItens = mat.length;
  }
  ed._score = pontuar(ed);
  return ed;
}

/* ---------------- RADAR ---------------- */
function lerFiltros() {
  const q = norm($("#fQ").value).split(/\s+/).filter(t => t.length > 1);
  return {
    q, qTexto: $("#fQ").value.trim(), uf: $("#fUf").value, raio: +$("#fRaio").value, prazo: +$("#fPrazo").value,
    me: $("#fMe").checked, hist: $("#fHist").checked, porte: $("#fPorte").checked, disp: $("#fDisp").checked, ord: $("#fOrd").value,
  };
}

function passa(ed, f) {
  if (f.uf && ed.uf !== f.uf) return false;
  if (!f.disp && /dispensa/i.test(ed.modalidade || "")) return false;
  const d = dias(ed.encerramento);
  if (d != null && d < f.prazo) return false;
  if (f.raio && ed._dist != null && ed._dist > f.raio) return false;
  if (f.q.length && S.fonte === "base") {
    const noObjeto = f.q.every(t => norm(ed.objeto).includes(t));
    if (!noObjeto && !(ed._alvo && ed._alvo.length)) return false;
  }
  if (ed.itens) {
    if (f.me && !ed._me) return false;
    if (f.hist && !ed._hist) return false;
    if (f.porte && ed._valor && ed._valor > limiteRestante()) return false;
  }
  return true;
}

function ordenar(lista, ord) {
  const k = {
    score: (a, b) => b._score - a._score,
    prazo: (a, b) => String(a.encerramento).localeCompare(String(b.encerramento)),
    dist: (a, b) => (a._dist ?? 1e9) - (b._dist ?? 1e9),
    valor: (a, b) => (b._valor || 0) - (a._valor || 0),
    recente: (a, b) => String(b.publicacao).localeCompare(String(a.publicacao)),
  }[ord];
  return lista.sort(k);
}

async function buscar(maisLive = false) {
  const f = lerFiltros();
  const status = $("#status");
  if (!baseAtual() && f.raio) status.innerHTML = "Informe sua cidade base para usar o filtro de raio.";
  if (S.fonte === "base") {
    if (!S.base.editais.length) {
      status.innerHTML = "A base do robô ainda está vazia — usando busca ao vivo.";
      setFonte("live");
      return buscar();
    }
    S.base.editais.forEach(e => enriquecer(e, f.q));
    S.resultados = ordenar(S.base.editais.filter(e => passa(e, f)), f.ord);
    const fora = S.base.meta?.ufs && !S.base.meta.ufs.includes(f.uf);
    status.innerHTML = fora
      ? `A base do robô cobre ${S.base.meta.ufs.join(", ")}. Para ${f.uf}, use <a href="#" id="toLive">busca ao vivo</a> ou adicione a UF no <code>config.json</code>.`
      : `${S.resultados.length} de ${S.base.editais.length} editais da base · coleta de ${dataHoraBR(S.base.meta?.coletado_em)}`;
    $("#toLive")?.addEventListener("click", ev => { ev.preventDefault(); setFonte("live"); buscar(); });
    S.mostrados = 0;
    renderLista(true);
    return;
  }

  // ---- ao vivo no PNCP ----
  if (!maisLive) { S.livePagina = 0; S.vivoBruto = []; $("#opps").innerHTML = '<div class="skeleton"></div>'.repeat(4); }
  status.innerHTML = '<span class="loader"></span> Consultando o PNCP…';
  const paginas = [1, 2, 3].map(i => S.livePagina + i);
  try {
    const params = p => new URLSearchParams({ tipos_documento: "edital", ordenacao: "-data", pagina: p, tam_pagina: 50, status: "recebendo_proposta", ufs: f.uf, ...(f.qTexto ? { q: f.qTexto } : {}) });
    const resps = await Promise.all(paginas.map(p => getJSON(`${PNCP}/search/?${params(p)}`).catch(() => null)));
    S.livePagina += 3;
    const vistos = new Set(S.vivoBruto.map(e => e.id));
    for (const r of resps) {
      if (!r) continue;
      S.liveTotal = r.total || 0;
      for (const e of r.items || []) {
        if (e.cancelado || vistos.has(e.numero_controle_pncp)) continue;
        vistos.add(e.numero_controle_pncp);
        const doBase = S.base.editais.find(b => b.id === e.numero_controle_pncp);
        S.vivoBruto.push(doBase || editalDaBusca(e));
      }
    }
    S.vivoBruto.forEach(e => enriquecer(e, f.q));
    S.resultados = ordenar(S.vivoBruto.filter(e => passa(e, f)), f.ord);
    status.innerHTML = `${S.resultados.length} editais filtrados · ${nfmt(S.liveTotal)} abertos no PNCP para a busca`;
    S.mostrados = 0;
    renderLista(true);
    enriquecerVivo();
  } catch (err) {
    status.innerHTML = "Não foi possível consultar o PNCP agora (" + esc(err.message) + "). Tente de novo em instantes.";
    $("#opps").innerHTML = "";
  }
}

/* Carrega itens dos editais visíveis (busca ao vivo) para calcular valor e atratividade. */
let enriquecendo = 0;
async function enriquecerVivo() {
  const tok = ++enriquecendo;
  const f = lerFiltros();
  const alvo = S.resultados.slice(0, S.mostrados).filter(e => !e.itens);
  await emLotes(alvo, 4, async ed => {
    if (tok !== enriquecendo) return;
    try { await carregarItens(ed); } catch { ed.itens = null; return; }
    enriquecer(ed, f.q);
    const card = document.querySelector(`[data-card="${CSS.escape(ed.id)}"]`);
    if (card) card.outerHTML = cardHTML(ed);
  });
  if (tok !== enriquecendo || !alvo.length) return;
  // Com itens carregados o score muda: reaplica filtros e ordem
  const vistos = S.mostrados;
  S.resultados = ordenar(S.vivoBruto.filter(e => passa(e, f)), f.ord);
  $("#opps").innerHTML = "";
  S.mostrados = 0;
  while (S.mostrados < Math.min(vistos, S.resultados.length)) renderLista(false);
  if (!S.resultados.length) renderLista(true);
}

function renderAvisoBase() {
  const box = $("#avisoBase");
  if (S.cfg.base && baseAtual()) { box.innerHTML = ""; return; }
  if (S.cfg.base) {
    box.innerHTML = `<div class="callout aviso-base"><span>Não encontramos a cidade <b>${esc(S.cfg.base)}</b>. Escolha uma opção da lista para calcular distâncias.</span>
      <input type="text" id="avisoCidade" list="cidades" placeholder="ex.: Paulínia"><button class="btn sm primary" id="avisoOk">Corrigir</button></div>`;
  } else {
    box.innerHTML = `<div class="callout info aviso-base"><span><b>Defina sua cidade base</b> para o painel calcular a distância até cada órgão, o frete e priorizar o que está perto.</span>
      <input type="text" id="avisoCidade" list="cidades" placeholder="ex.: Paulínia"><button class="btn sm primary" id="avisoOk">Definir</button></div>`;
  }
  $("#avisoOk").onclick = () => {
    const v = $("#avisoCidade").value.trim();
    if (!v) return;
    S.cfg.base = v; store.set("cfg", S.cfg); $("#fBase").value = v;
    renderAvisoBase(); buscar();
  };
}

function atualizarKPIs() {
  renderAvisoBase();
  const r = S.resultados;
  $("#kN").textContent = nfmt(r.length);
  $("#kNs").textContent = r.filter(e => e._score >= 70).length + " com atratividade alta";
  $("#kV").textContent = brlCurto(r.reduce((a, e) => a + (e._valor || 0), 0));
  $("#kMe").textContent = nfmt(r.reduce((a, e) => a + (e._me || 0), 0));
  $("#kU").textContent = nfmt(r.filter(e => { const d = dias(e.encerramento); return d != null && d <= 7; }).length);
}

function anel(score) {
  const cor = score >= 70 ? "var(--green)" : score >= 50 ? "var(--gold)" : "#9aa3b1";
  return `<div class="score" title="Índice de atratividade (0–100): prazo, distância, itens ME/EPP, folga entre teto e preço de mercado, porte">
    <div class="n">${score}</div><div class="k">índice</div><div class="r"><span style="width:${score}%;background:${cor}"></span></div></div>`;
}

/* Faixa didática com as 5 etapas do processo de revenda ao governo. */
const ETAPAS = [
  ["Encontrar", "editais abertos perto de você"],
  ["Analisar", "teto, histórico e quantidade"],
  ["Cotar", "fornecedores sem estoque"],
  ["Decidir", "lance mínimo e margem"],
  ["Propor e entregar", "disputa, empenho, entrega"],
];
function renderJornadas() {
  $$(".jornada[data-etapa]").forEach(el => {
    const atual = +el.dataset.etapa;
    el.innerHTML = ETAPAS.map(([t, s], i) => `<div class="${i + 1 === atual ? "on" : i + 1 < atual ? "ok" : ""}"><i>${i + 1}</i><b>${t}</b><span>${s}</span></div>`).join("");
  });
}

function prazoTag(enc) {
  const d = dias(enc);
  if (d == null) return "";
  if (d < 1) return `<span class="tag red">Encerra hoje</span>`;
  if (d < 3) return `<span class="tag red">Encerra em ${Math.floor(d)} dia(s)</span>`;
  if (d <= 7) return `<span class="tag amber">${Math.floor(d)} dias para propor</span>`;
  return `<span class="tag">${Math.floor(d)} dias para propor</span>`;
}

/* Títulos de edital costumam vir em CAIXA ALTA: converte para frase, preservando siglas. */
const SIGLAS = /\b(sp|mg|pr|rj|me|epp|mei|srp|pe|ti|led|usb|hd|ssd|ram|epi|sus|ubs|cpi|pncp|abnt|nbr|gb|tb|a4|a3|cnpj|cep|inss)\b/gi;
function frase(t) {
  t = String(t || "").trim();
  const letras = t.replace(/[^A-Za-zÀ-ú]/g, "");
  if (!letras || letras.replace(/[^A-ZÀ-Ý]/g, "").length / letras.length < .6) return t;
  t = t.toLowerCase().replace(/(^|[.!?]\s+)([a-zà-ú])/g, (m, p, c) => p + c.toUpperCase());
  return t.replace(SIGLAS, m => m.toUpperCase());
}
/* Nomes de órgãos: "SAO PAULO SECRETARIA DA SEGURANCA" -> "Sao Paulo Secretaria da Seguranca". */
const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "em", "para"]);
function nomeProprio(t) {
  t = String(t || "").trim();
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().split(/\s+/).map((w, i) => i && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ").replace(SIGLAS, m => m.toUpperCase());
}
const plural = (n, um, varios) => `${nfmt(n)} ${n === 1 ? um : varios}`;

function cardHTML(ed) {
  const salvo = !!S.carteira[ed.id];
  const d = dias(ed.encerramento);
  const tags = [];
  if (ed._me) tags.push(`<span class="tag gold">${plural(ed._me, "item exclusivo ME/EPP", "itens exclusivos ME/EPP")}</span>`);
  if (ed._hist) tags.push(`<span class="tag blue">${plural(ed._hist, "item com histórico de preço", "itens com histórico de preço")}</span>`);
  if (ed._valor && ed._valor > limiteRestante()) tags.push(`<span class="tag red">Acima do limite ${esc(S.cfg.porte)}</span>`);
  if (ed.itens?.some(i => ALERTAS[0][0].test(i.d))) tags.push(`<span class="tag red" title="${esc(ALERTAS[0][3])}">Produto para saúde: exige AFE</span>`);
  if (ed.itens && ed.itens.length && ed.itens.every(i => i.s)) tags.push(`<span class="tag">Orçamento sigiloso</span>`);
  if (/registro de pre[cç]o|\bSRP\b/i.test(ed.objeto || "")) tags.push(`<span class="tag">Registro de preços</span>`);
  if (!ed.itens) tags.push(`<span class="tag"><span class="loader" style="width:10px;height:10px"></span> carregando itens</span>`);
  let match = "";
  if (ed._alvo?.length) {
    const ex = ed._alvo.slice(0, 2).map(i => `<b>${esc(frase(i.d).slice(0, 70))}</b> (${nfmt(i.q)} ${esc(i.u)})`).join("; ");
    match = `<div class="match">${plural(ed._alvo.length, "item corresponde", "itens correspondem")} à sua busca: ${ex}${ed._alvo.length > 2 ? "…" : ""}</div>`;
  }
  const prazo = d == null ? "–" : d < 1 ? "hoje" : `${Math.floor(d)} dia${Math.floor(d) === 1 ? "" : "s"}`;
  const corPrazo = d != null && d < 3 ? "var(--red)" : d != null && d <= 7 ? "var(--amber)" : "var(--ink-3)";
  return `<article class="card opp" data-card="${esc(ed.id)}">
    <div class="opp-score">${anel(ed._score)}</div>
    <div class="opp-main">
      <div class="opp-kicker">${esc(ed.modalidade || "")}${ed.itens ? " · " + plural(ed._nItens, "item de material", "itens de material") : ""}</div>
      <h3><a href="#edital=${encodeURIComponent(ed.id)}" data-analisar="${esc(ed.id)}">${esc(frase(ed.objeto || ed.titulo).slice(0, 260))}</a></h3>
      <div class="org">${esc(nomeProprio(ed.orgao))} · ${esc(ed.municipio)}/${esc(ed.uf)}</div>
      ${tags.length ? `<div class="tags">${tags.join("")}</div>` : ""}
      ${match}
    </div>
    <aside class="opp-side">
      <dl>
        <div><dt>Valor estimado</dt><dd class="valor num">${ed._valor ? brlCurto(ed._valor) : ed.itens ? "sigiloso" : "–"}</dd></div>
        <div><dt>Propostas até</dt><dd>${dataHoraBR(ed.encerramento)}<small style="display:block;color:${corPrazo}">${d != null && d >= 1 ? "faltam " : ""}${prazo}</small></dd></div>
        <div><dt>Distância</dt><dd>${ed._dist != null ? "~" + nfmt(ed._dist) + " km" : '<small>defina sua cidade</small>'}</dd></div>
      </dl>
      <div class="opp-actions">
        <button class="btn primary sm" data-analisar="${esc(ed.id)}">Analisar</button>
        <button class="btn sm icon" data-salvar="${esc(ed.id)}" title="${salvo ? "Remover da carteira" : "Salvar na carteira"}">${salvo ? ICON.starOn : ICON.star}</button>
        <a class="btn sm icon" href="${esc(ed.url)}" target="_blank" rel="noopener" title="Abrir no PNCP">${ICON.ext}</a>
      </div>
    </aside>
  </article>`;
}

function renderLista(reset) {
  const box = $("#opps");
  if (reset) { box.innerHTML = ""; S.mostrados = 0; }
  if (!S.resultados.length) {
    box.innerHTML = `<div class="card empty">${ICON.search}<h3>Nenhuma oportunidade com esses filtros</h3><p>Tente aumentar o raio, reduzir o prazo mínimo, desmarcar filtros ou usar a busca ao vivo.</p></div>`;
    atualizarKPIs();
    $("#more").classList.add("hidden");
    return;
  }
  const prox = S.resultados.slice(S.mostrados, S.mostrados + 25);
  box.insertAdjacentHTML("beforeend", prox.map(cardHTML).join(""));
  S.mostrados += prox.length;
  const temMais = S.mostrados < S.resultados.length || (S.fonte === "live" && S.livePagina * 50 < S.liveTotal);
  $("#more").classList.toggle("hidden", !temMais);
  atualizarKPIs();
}

function acharEdital(id) {
  return S.resultados.find(e => e.id === id) || S.vivoBruto.find(e => e.id === id) || S.base.editais.find(e => e.id === id) || (S.atual?.id === id ? S.atual : null) || doCarteira(id);
}
function doCarteira(id) {
  const c = S.carteira[id] || (S.casos || []).find(x => x.edital_id === id)?.edital;
  return c ? { ...c, itens: null } : null;
}

function alternarCarteira(ed) {
  if (S.carteira[ed.id]) { delete S.carteira[ed.id]; toast("Removido da carteira"); }
  else {
    S.carteira[ed.id] = {
      id: ed.id, cnpj: ed.cnpj, ano: ed.ano, seq: ed.seq, objeto: ed.objeto, orgao: ed.orgao, municipio: ed.municipio,
      uf: ed.uf, ibge: ed.ibge, modalidade: ed.modalidade, encerramento: ed.encerramento, url: ed.url, valor: ed._valor || null,
      status: "Analisando", nota: "", salvoEm: new Date().toISOString(),
    };
    toast("Salvo na carteira");
  }
  store.set("carteira", S.carteira);
  $("#cartCount").textContent = Object.keys(S.carteira).length;
}

/* ---------------- ANÁLISE ---------------- */
const STOP = new Set(["de", "da", "do", "das", "dos", "para", "com", "em", "e", "a", "o", "tipo", "uso", "material", "aplicacao"]);
/* Descrições do catálogo vêm como "Nome atributo: valor, atributo: valor".
 * Usa o nome do produto + os dois primeiros valores como termo de busca. */
function termoBusca(desc) {
  const partes = desc.split(/(?<!\d),(?!\d)|;/).map(p => p.trim()).filter(Boolean); // preserva "15,6"
  const primeira = partes[0] || "";
  let nome = primeira, valores = [];
  if (primeira.includes(":")) {
    const [antes, depois] = primeira.split(":");
    nome = antes.trim().split(/\s+/).slice(0, -1).join(" ") || antes; // tira o rótulo do atributo
    valores.push(depois);
  }
  for (const p of partes.slice(1)) if (p.includes(":")) valores.push(p.split(":")[1]);
  const limpo = [nome, ...valores.slice(0, 2)].join(" ").replace(/[()\/.]+/g, " ").replace(/\s+/g, " ").trim();
  const vistas = new Set();
  return limpo.split(" ").filter(w => {
    const k = norm(w);
    if ((w.length < 2 && !/\d/.test(w)) || STOP.has(k) || vistas.has(k)) return false;
    vistas.add(k);
    return true;
  }).slice(0, 6).join(" ");
}
function linksFornecedores(desc) {
  const t = termoBusca(desc), q = encodeURIComponent(t);
  return `<div class="links">
    <a href="https://lista.mercadolivre.com.br/${encodeURIComponent(t.replace(/\s+/g, "-"))}" target="_blank" rel="noopener">Mercado Livre</a>
    <a href="https://www.google.com/search?tbm=shop&q=${q}" target="_blank" rel="noopener">Google Shopping</a>
    <a href="https://www.magazineluiza.com.br/busca/${q}/" target="_blank" rel="noopener">Magalu</a>
    <a href="https://www.amazon.com.br/s?k=${q}" target="_blank" rel="noopener">Amazon</a>
    <a href="https://shopee.com.br/search?keyword=${q}" target="_blank" rel="noopener">Shopee</a>
    <a href="https://www.alibaba.com/trade/search?SearchText=${q}" target="_blank" rel="noopener">Alibaba (fábrica)</a>
    <a href="https://www.google.com/search?q=${encodeURIComponent(t + " atacado distribuidor fabricante")}" target="_blank" rel="noopener">Distribuidores</a>
  </div><div class="small muted" style="margin-top:6px">Termo usado: <code>${esc(t)}</code></div>`;
}

/* Faixa visual: histórico (p25–p75, mediana), teto do edital, seu custo e lance sugerido. */
function faixa(r) {
  const vals = [r.h?.min, r.h?.max, r.teto, r.custo, r.lance].filter(v => v > 0);
  if (!vals.length) return '<span class="muted small">sem referência</span>';
  const lo = Math.min(...vals) * .9, hi = Math.max(...vals) * 1.08, W = 200;
  const x = v => 6 + (v - lo) / (hi - lo) * (W - 12);
  let s = `<svg class="strip" width="${W}" height="34" viewBox="0 0 ${W} 34"><line x1="6" x2="${W - 6}" y1="14" y2="14" stroke="#e3e8f0" stroke-width="2"/>`;
  if (r.h) {
    s += `<line x1="${x(r.h.min)}" x2="${x(r.h.max)}" y1="14" y2="14" stroke="#b8c7de" stroke-width="2"/>`;
    s += `<rect x="${x(r.h.p25)}" y="9" width="${Math.max(2, x(r.h.p75) - x(r.h.p25))}" height="10" rx="2" fill="#9db6dc"/>`;
    s += `<line x1="${x(r.h.med)}" x2="${x(r.h.med)}" y1="7" y2="21" stroke="#163a6b" stroke-width="2.5"/>`;
  }
  if (r.teto) s += `<line x1="${x(r.teto)}" x2="${x(r.teto)}" y1="4" y2="24" stroke="#c0352b" stroke-width="2" stroke-dasharray="3 2"/>`;
  if (r.custo) s += `<circle cx="${x(r.custo)}" cy="14" r="4.5" fill="#fff" stroke="#2563c9" stroke-width="2.5"/>`;
  if (r.lance) s += `<path d="M${x(r.lance) - 5} 30 L${x(r.lance) + 5} 30 L${x(r.lance)} 23 Z" fill="#12805c"/>`;
  return s + "</svg>";
}

/* "01263896000164-1-000755/2026" -> edital mínimo, completado pela API de consulta do PNCP. */
async function editalPorControle(id) {
  const m = /^(\d{14})-\d+-0*(\d+)\/(\d{4})$/.exec(id);
  if (!m) return null;
  const [, cnpj, seq, ano] = m;
  const ed = { id, cnpj, ano, seq, objeto: "Edital " + id, url: `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`, itens: null };
  try {
    const d = await getJSON(`${PNCP}/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`);
    if (d) Object.assign(ed, {
      objeto: d.objetoCompra, orgao: d.orgaoEntidade?.razaoSocial, unidade: d.unidadeOrgao?.nomeUnidade,
      municipio: d.unidadeOrgao?.municipioNome, uf: d.unidadeOrgao?.ufSigla, ibge: d.unidadeOrgao?.codigoIbge,
      modalidade: d.modalidadeNome, encerramento: (d.dataEncerramentoProposta || "").slice(0, 16),
    });
  } catch { /* fica com o mínimo */ }
  return ed;
}

async function abrirAnalise(id) {
  let ed = acharEdital(id) || await editalPorControle(id);
  if (!ed) return toast("Edital não encontrado");
  if (S.atual?.id !== ed.id) S.itFiltro = { q: "", ver: "todos", ord: "num" };
  S.atual = ed;
  irPara("analise");
  history.replaceState(null, "", "#edital=" + encodeURIComponent(id)); // link compartilhável
  const box = $("#analise");
  if (!ed.itens) {
    box.innerHTML = `<div class="card empty"><span class="loader"></span><h3>Carregando itens do edital no PNCP…</h3></div>`;
    try { await carregarItens(ed); } catch (e) { box.innerHTML = `<div class="card empty"><h3>Falha ao carregar itens</h3><p>${esc(e.message)}</p></div>`; return; }
  }
  enriquecer(ed, lerFiltros().q);
  renderAnalise();
  // Preços ao vivo (se houver proxy configurado)
  const faltam = ed.itens.filter(i => i.c && i.m !== "S" && !S.base.precos[i.c] && !(i.c in S.precosVivo));
  if (S.cfg.proxy && faltam.length) {
    $("#precoStatus").innerHTML = `<span class="loader"></span> consultando histórico de ${faltam.length} item(ns)…`;
    await emLotes(faltam, 3, i => buscarPrecoVivo(i.c));
    if (S.atual === ed) renderAnalise();
  }
}

function renderAnalise() {
  const ed = S.atual, box = $("#analise");
  if (!ed) {
    box.innerHTML = `<div class="card empty">${ICON.search}<h3>Nenhum edital selecionado</h3><p>Em <b>Oportunidades</b>, clique em <b>Analisar</b> num edital.</p></div>`;
    return;
  }
  const f = lerFiltros();
  const itens = ed.itens.filter(i => i.m !== "S");
  const servicos = ed.itens.length - itens.length;
  const todos = ed._alvo?.length ? [...ed._alvo, ...itens.filter(i => !ed._alvo.includes(i))] : itens;
  const calc = new Map(todos.map(i => [i, calcular(i, ed)]));
  const F = S.itFiltro;
  const qn = norm(F.q).split(/\s+/).filter(Boolean);
  let ordem = todos.filter(i => {
    const r = calc.get(i);
    if (qn.length && !qn.every(t => norm(i.d).includes(t))) return false;
    if (F.ver === "cotados" && !Cot.lista(r.key).length && r.custoManual == null) return false;
    if (F.ver === "viaveis" && !["go", "ok"].includes(r.veredito)) return false;
    if (F.ver === "me" && !(i.b === 1 || i.b === 3)) return false;
    return true;
  });
  if (F.ord === "valor") ordem = [...ordem].sort((a, b) => b.v * b.q - a.v * a.q);
  if (F.ord === "lucro") ordem = [...ordem].sort((a, b) => (calc.get(b).lucro ?? -1e12) - (calc.get(a).lucro ?? -1e12));
  const { freteP } = taxas(ed);
  const salvo = !!S.carteira[ed.id];

  const linhas = ordem.map(it => {
    const r = calc.get(it);
    const [cls, txt] = VEREDITO[r.veredito];
    const sel = S.sel[r.key] ?? r.veredito !== "no";
    const realce = ed._alvo?.includes(it) ? ' style="box-shadow: inset 3px 0 0 #c99a2e"' : "";
    const benef = it.b === 1 || it.b === 3 ? `<span class="tag gold">${BENEFICIO[it.b]}</span>` : "";
    return `<tr class="item" data-key="${esc(r.key)}"${realce}>
      <td><input type="checkbox" class="sel" ${sel ? "checked" : ""} title="Incluir no resumo"></td>
      <td class="num">${it.n}</td>
      <td class="desc"><div class="d" title="Clique para expandir">${esc(it.d)}</div>
        <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">${benef}${alertasItem(it)}${it.c ? `<span class="tag">CATMAT ${esc(it.c)}</span>` : ""}${r.unidadeSuspeita ? '<span class="tag amber" title="Histórico muito diferente do teto: confira a unidade (caixa x unidade, pacote, etc.)">confira a unidade</span>' : ""}</div></td>
      <td class="r num">${nfmt(it.q, 2)}<div class="small muted">${esc(it.u)}</div></td>
      <td class="r num">${r.teto ? brl(r.teto) + `<div class="tot">total ${brlCurto(r.teto * it.q)}</div>` : '<span class="muted small">sigiloso</span>'}${r.teto && unidadesPorEmbalagem(it.d) ? `<div class="small muted">${brl(r.teto / unidadesPorEmbalagem(it.d), 3)}/un. (emb. ${unidadesPorEmbalagem(it.d)})</div>` : ""}</td>
      <td class="r num"><b>${r.compreAte ? brl(r.compreAte) : "–"}</b>${r.custo != null && r.compreAte ? `<div class="small" style="color:${r.custo <= r.compreAte ? "var(--green)" : "var(--red)"}">${r.custo <= r.compreAte ? "folga " : "excede "}${pct(Math.abs(r.compreAte - r.custo) / r.compreAte)}</div>` : ""}</td>
      <td>${r.h || r.custo ? faixa(r) : ""}<div class="small muted num">${r.h ? `mediana ${brl(r.h.med)} · ${r.h.n} compras` : "sem histórico de compras"}</div></td>
      <td class="r num"><b>${r.lance ? brl(r.lance) : "–"}</b><div class="small muted">${r.chance != null ? "chance ~" + pct(r.chance) : ""}</div></td>
      <td class="r"><input class="cost num" type="number" min="0" step="0.01" placeholder="${r.custo != null ? nfmt(r.custo, 2) : r.custoMax ? "até " + nfmt(r.custoMax, 2) : "R$"}" value="${r.custoManual ?? ""}" title="Custo unitário de compra. Vazio = usa a melhor cotação registrada.">
        ${r.custoManual == null && r.melhorCot ? `<div class="via" ${r.melhorCot.incerto ? 'style="color:var(--amber)" title="Nenhuma cotação confirmada atende à especificação"' : ""}>via cotação${r.melhorCot.incerto ? " (incerta)" : ""}: ${esc(r.melhorCot.forn.slice(0, 22))}</div>${(() => { const alt = Cot.aConfirmar(r.key, it.q); return alt ? `<div class="via" style="color:var(--amber)" title="${esc(alt.forn)}: confirme se atende à especificação">a confirmar: ${brl(alt.efetivo)}</div>` : ""; })()}` : r.custoManual == null ? `<div class="small muted">${Cot.lista(r.key).length ? "cotações sem preço" : "sem cotação"}</div>` : ""}</td>
      <td class="r num">${r.lucro != null ? `<b style="color:${r.lucro >= 0 ? "var(--green)" : "var(--red)"}">${brl(r.lucro, 0)}</b><div class="small muted">${pct(r.margem)}</div>` : "–"}</td>
      <td><span class="verdict ${cls}">${txt}</span></td>
      <td><button class="btn sm tg" title="Cotar fornecedores, ver histórico e estratégia">Cotar ▾</button></td>
    </tr>
    <tr class="detail hidden" data-detail="${esc(r.key)}"><td colspan="12">${detalheHTML(it, r, ed)}</td></tr>`;
  }).join("");

  // Resumo dos itens marcados
  let receita = 0, receitaTotal = 0, custo = 0, lucro = 0, nSel = 0, semCusto = 0;
  for (const it of todos) {
    const r = calc.get(it);
    const sel = S.sel[r.key] ?? r.veredito !== "no";
    if (!sel || r.lance == null) continue;
    nSel++;
    receitaTotal += r.receita;
    if (r.custo != null) { receita += r.receita; custo += r.custo * it.q; lucro += r.lucro; } else semCusto++;
  }
  const comCusto = nSel - semCusto;
  const margem = receita && comCusto ? lucro / receita : null;
  const v0 = v => comCusto ? brl(v, 0) : "–";
  const alertaPorte = receitaTotal > limiteRestante()
    ? `<div class="callout" style="margin:12px 16px 0">A receita potencial dos itens marcados (${brl(receitaTotal, 0)}) passa do limite anual restante do porte <b>${esc(S.cfg.porte)}</b> (${brl(limiteRestante(), 0)}). Desmarque itens ou avalie migrar de porte.</div>` : "";

  box.innerHTML = `
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn sm" id="voltar">← Voltar às oportunidades</button>
      <span class="grow"></span>
      <button class="btn sm" id="anSalvar">${salvo ? ICON.starOn + " Na carteira" : ICON.star + " Salvar na carteira"}</button>
      <a class="btn sm primary" href="${esc(ed.url)}" target="_blank" rel="noopener">${ICON.ext} Abrir edital no PNCP</a>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="an-head">
        <div>
          <div class="tags" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap"><span class="tag blue">${esc(ed.modalidade)}</span>${prazoTag(ed.encerramento)}${/registro de pre[cç]o|SRP/i.test(ed.objeto || "") ? '<span class="tag amber" title="Registro de preços: o órgão compra aos poucos, sem garantia do total. Frete por entrega pesa mais.">Registro de preços (SRP)</span>' : ""}${ed.esfera ? `<span class="tag">${esc(ed.esfera)}</span>` : ""}</div>
          <h2>${esc(frase(ed.objeto || ed.titulo))}</h2>
          <div class="muted">${esc(nomeProprio(ed.orgao))}${ed.unidade && ed.unidade !== ed.orgao ? " · " + esc(nomeProprio(ed.unidade)) : ""}</div>
        </div>
        ${anel(ed._score)}
      </div>
      <div class="facts">
        <div><div class="l">Local de entrega</div><div class="v">${esc(ed.municipio)}/${esc(ed.uf)}</div></div>
        <div><div class="l">Distância da base</div><div class="v">${ed._dist != null ? "~" + nfmt(ed._dist) + " km" : "defina sua cidade"}</div></div>
        <div><div class="l">Propostas até</div><div class="v">${dataHoraBR(ed.encerramento)}</div></div>
        <div><div class="l">Valor estimado (material)</div><div class="v">${brl(itens.reduce((a, i) => a + (i.v > 0 ? i.v * i.q : 0), 0), 0)}</div></div>
        <div><div class="l">Itens</div><div class="v">${itens.length} material${servicos ? ` · ${servicos} serviço` : ""}</div></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-h"><h3>Resultado se você ganhar os itens marcados</h3><span class="muted small" style="margin-left:auto">${nSel} item(ns) marcados${semCusto ? ` · ${semCusto} sem custo (lucro considera só itens com custo)` : ""}</span></div>
      ${!comCusto ? (() => {
        const top = [...todos].sort((a, b) => b.v * b.q - a.v * a.q).slice(0, 5);
        const vTop = top.reduce((a, i) => a + i.v * i.q, 0), vTot = todos.reduce((a, i) => a + (i.v > 0 ? i.v * i.q : 0), 0);
        return `<div class="summary-vazio"><div><div class="l small muted">POTENCIAL</div><div class="big num">${brlCurto(receitaTotal)}</div></div>
          <div class="small">Nenhum item tem custo ainda. Comece pelos <b>5 itens de maior valor</b>, que somam <b>${brlCurto(vTop)}</b> (${pct(vTot ? vTop / vTot : 0)} do edital): abra <b>Cotar</b> em cada um e registre ao menos três cotações. <button class="btn sm" id="verMaiores" style="margin-left:6px">Ordenar por valor</button></div></div>`;
      })() : `<div class="summary">
        <div><div class="l">Receita (itens com custo)</div><div class="v num">${v0(receita)}</div><div class="small muted">potencial de todos os marcados: ${brl(receitaTotal, 0)}</div></div>
        <div><div class="l">Custo de compra</div><div class="v num">${v0(custo)}</div></div>
        <div><div class="l">Impostos + frete + outros</div><div class="v num">${v0(receita - custo - lucro)}</div></div>
        <div><div class="l">Lucro líquido</div><div class="v num ${!comCusto ? "" : lucro >= 0 ? "pos" : "neg"}">${v0(lucro)}</div></div>
        <div><div class="l">Margem</div><div class="v num ${margem == null ? "" : margem >= S.cfg.marg / 100 ? "pos" : "neg"}">${pct(margem)}</div></div>
      </div>`}
      ${alertaPorte}
      ${dias(ed.encerramento) != null && dias(ed.encerramento) < 7 ? `<div class="callout" style="margin:12px 16px 14px">Prazo curto: faltam ${Math.max(0, Math.floor(dias(ed.encerramento)))} dia(s). Para revenda sem estoque, só entre se já tiver cotação firme por escrito.</div>` : ""}
    </div>

    <div class="card">
      <div class="card-h"><h3>Itens do edital</h3><span class="muted small" id="precoStatus" style="margin-left:auto">${f.q.length && ed._alvo?.length ? `${ed._alvo.length} item(ns) da sua busca aparecem primeiro (marcados em dourado)` : ""}</span></div>
      <div class="params">
        <div class="field"><label>Impostos %</label><input type="number" step="0.1" data-p="imp" value="${S.cfg.imp}"></div>
        <div class="field"><label>Frete base %</label><input type="number" step="0.1" data-p="frete" value="${S.cfg.frete}"></div>
        <div class="field"><label>Frete/100 km %</label><input type="number" step="0.1" data-p="dist" value="${S.cfg.dist}"></div>
        <div class="field"><label>Outros custos %</label><input type="number" step="0.1" data-p="out" value="${S.cfg.out}"></div>
        <div class="field"><label>Margem mínima %</label><input type="number" step="0.5" data-p="marg" value="${S.cfg.marg}"></div>
        <div class="small muted" style="flex:1;min-width:220px">Frete aplicado neste edital: <b>${nfmt(freteP, 1)}%</b>. Digite o <b>seu custo unitário</b> de compra (com frete do fornecedor) em cada item — o painel calcula o lance, a chance e o lucro.</div>
      </div>
      <div class="itens-bar">
        <input type="search" id="itQ" placeholder="Filtrar itens (ex.: caneta)" value="${esc(S.itFiltro.q)}">
        <div class="seg mini" id="itVer">${[["todos", "Todos"], ["viaveis", "Viáveis"], ["cotados", "Com cotação"], ["me", "Exclusivos ME/EPP"]].map(([v, l]) => `<button data-v="${v}" class="${S.itFiltro.ver === v ? "active" : ""}">${l}</button>`).join("")}</div>
        <select id="itOrd"><option value="num">Ordem do edital</option><option value="valor" ${S.itFiltro.ord === "valor" ? "selected" : ""}>Maior valor total</option><option value="lucro" ${S.itFiltro.ord === "lucro" ? "selected" : ""}>Maior lucro</option></select>
        <span class="small muted grow" style="text-align:right">${ordem.length} de ${todos.length} itens</span>
      </div>
      <div class="table-wrap">
        <table class="items">
          <thead><tr><th title="Participar">✓</th><th>#</th><th>Item</th><th class="r">Qtd</th><th class="r">Teto unit.</th><th class="r" title="Custo máximo de compra para manter a margem mínima, dando lance no teto">Compre até</th><th>Preços pagos pelo governo</th><th class="r">Lance sugerido</th><th class="r">Seu custo unit.</th><th class="r">Lucro</th><th>Veredito</th><th></th></tr></thead>
          <tbody>${linhas || `<tr><td colspan="12" class="empty">${todos.length ? "Nenhum item com esse filtro." : "Este edital não tem itens de material."}</td></tr>`}</tbody>
        </table>
      </div>
      <div class="legend">
        <span><i style="background:#9db6dc"></i>faixa típica paga (25%–75%)</span>
        <span><i style="background:#13294b"></i>mediana</span>
        <span><i style="background:#a8322a"></i>teto do edital</span>
        <span><i style="background:#fff;border:2px solid #2c5288;border-radius:50%"></i>seu custo</span>
        <span><i style="background:#1d6b4a"></i>lance sugerido</span>
      </div>
    </div>`;
  ligarAnalise();
}

function detalheHTML(it, r, ed) {
  const h = r.h;
  const nCot = Cot.lista(r.key).length;
  const histTab = h ? `<table class="hist"><thead><tr><th>Data</th><th>Órgão</th><th>UF</th><th class="r">Qtd</th><th class="r">Preço unit.</th><th>Fornecedor / marca</th></tr></thead><tbody>
      ${(h.ult || []).map(u => `<tr><td>${dataBR(u.data)}</td><td>${esc((u.orgao || "").slice(0, 38))}</td><td>${esc(u.uf)}</td><td class="r num">${nfmt(u.qtd)}</td><td class="r num"><b>${brl(u.preco)}</b></td><td>${esc((u.forn || "").slice(0, 34))}${u.marca ? " · <span class='muted'>" + esc(u.marca) + "</span>" : ""}</td></tr>`).join("")}
    </tbody></table>
    <p class="small muted">Faixa paga em ${h.n} compras (12 meses): mín. ${brl(h.min)} · 25% ${brl(h.p25)} · mediana ${brl(h.med)} · 75% ${brl(h.p75)} · máx. ${brl(h.max)}. Estes são preços que <b>venceram</b> outras licitações — mostram até onde a concorrência costuma descer.</p>`
    : `<p class="small muted">${it.c ? (S.cfg.proxy ? "Sem compras registradas para este código nos últimos 12 meses." : "Este item ainda não está na base de preços do robô. Configure o proxy em Configurações para consultar ao vivo, ou aguarde a próxima coleta.") : "Item sem código CATMAT — o governo não tem série de preços padronizada. Apoie-se nas cotações de fornecedores."}</p>`;
  const fator = 1 - r.T - r.M;
  const estrat = [];
  if (r.agr != null) estrat.push(`<tr><td><b>Agressivo</b><div class="small muted">alta chance</div></td><td class="r num">${brl(r.agr)}</td><td class="r num"><b>${brl(r.agr * fator)}</b></td></tr>`);
  if (r.equ != null) estrat.push(`<tr><td><b>Equilibrado</b><div class="small muted">mediana do mercado</div></td><td class="r num">${brl(r.equ)}</td><td class="r num"><b>${brl(r.equ * fator)}</b></td></tr>`);
  if (r.con != null) estrat.push(`<tr><td><b>Conservador</b><div class="small muted">pouca chance</div></td><td class="r num">${brl(r.con)}</td><td class="r num"><b>${brl(r.con * fator)}</b></td></tr>`);
  const estrategia = `${estrat.length ? `<table class="hist" style="max-width:520px"><thead><tr><th>Estratégia</th><th class="r">Lance</th><th class="r">Compre por até</th></tr></thead><tbody>${estrat.join("")}</tbody></table>
      <p class="small muted">“Compre por até” desconta impostos (${nfmt(S.cfg.imp, 1)}%), frete (${nfmt(taxas(ed).freteP, 1)}%), outros custos (${nfmt(S.cfg.out, 1)}%) e sua margem mínima (${nfmt(S.cfg.marg, 1)}%).${r.fonteRef === "teto" ? " Sem histórico, os níveis usam deságios típicos de pregão (15–25% abaixo do teto)." : ""}</p>`
      : `<p class="small muted">Sem teto nem histórico: pesquise o preço de mercado e informe seu custo.</p>`}
    ${r.pMin ? `<div class="note small">Com custo de ${brl(r.custo)}, seu <b>preço mínimo</b> para manter ${nfmt(S.cfg.marg, 1)}% de margem é <b>${brl(r.pMin)}</b>. Na disputa, não dê lance abaixo dele.${r.teto && r.pMin > r.teto ? " Está acima do teto do edital: não compensa." : ""}</div>` : ""}`;
  return `<div class="dtabs" data-key="${esc(r.key)}">
      <button data-pane="cot" class="on">1. Cotações de fornecedores${nCot ? ` (${nCot})` : ""}</button>
      <button data-pane="hist">2. Preços pagos pelo governo${h ? ` (${h.n})` : ""}</button>
      <button data-pane="estr">3. Estratégia de lance</button>
      <button data-pane="onde">4. Onde procurar</button>
    </div>
    <div class="dpane" data-pane="cot">${cotacaoHTML(it, r, ed)}</div>
    <div class="dpane hidden" data-pane="hist">${histTab}</div>
    <div class="dpane hidden" data-pane="estr">${estrategia}</div>
    <div class="dpane hidden" data-pane="onde"><h4>Busca pronta nas principais fontes</h4>${linksFornecedores(it.d)}
      <p class="small muted">Dica: além da internet, ligue para 2 ou 3 distribuidores da região (aba <b>Fornecedores</b>). Em lotes grandes o desconto costuma superar o melhor preço online, e o frete local é menor.</p></div>`;
}

function ligarAnalise() {
  const box = $("#analise"), ed = S.atual;
  $("#voltar").onclick = () => irPara("radar");
  $("#anSalvar").onclick = () => { alternarCarteira(ed); renderAnalise(); };
  const refiltrar = () => { renderAnaliseMantendo(); const q = $("#itQ"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); };
  let tq;
  $("#itQ").oninput = e => { S.itFiltro.q = e.target.value; clearTimeout(tq); tq = setTimeout(refiltrar, 250); };
  $$("#itVer button").forEach(b => b.onclick = () => { S.itFiltro.ver = b.dataset.v; renderAnaliseMantendo(); });
  $("#itOrd").onchange = e => { S.itFiltro.ord = e.target.value; renderAnaliseMantendo(); };
  $("#verMaiores")?.addEventListener("click", () => { S.itFiltro.ord = "valor"; renderAnaliseMantendo(); $(".items").scrollIntoView({ behavior: "smooth" }); });
  $$(".params input", box).forEach(inp => inp.addEventListener("change", () => {
    S.cfg[inp.dataset.p] = parseFloat(inp.value) || 0;
    store.set("cfg", S.cfg);
    renderAnalise();
  }));
  $$("tr.item", box).forEach(tr => {
    const key = tr.dataset.key;
    $(".d", tr).onclick = e => e.currentTarget.classList.toggle("open");
    $(".tg", tr).onclick = () => {
      const det = box.querySelector(`[data-detail="${CSS.escape(key)}"]`);
      det.classList.toggle("hidden");
      tr.classList.toggle("aberto", !det.classList.contains("hidden"));
      $(".tg", tr).textContent = det.classList.contains("hidden") ? "Cotar ▾" : "Fechar ▴";
    };
    $(".sel", tr).onchange = e => { S.sel[key] = e.target.checked; store.set("sel", S.sel); renderAnaliseMantendo(); };
    $(".cost", tr).onchange = e => {
      const v = parseFloat(e.target.value);
      if (v > 0) S.custos[key] = v; else delete S.custos[key];
      delete S.sel[key]; // volta a seguir o veredito
      store.set("custos", S.custos); store.set("sel", S.sel);
      renderAnaliseMantendo(key);
    };
  });

  // Painel de detalhe: abas, cotações, agente de IA, pedido de cotação
  const itemPorKey = k => ed.itens.find(i => ed.id + "#" + i.n === k);
  $$("tr.detail", box).forEach(det => {
    const key = det.dataset.detail, it = itemPorKey(key);
    $$(".dtabs button", det).forEach(b => b.onclick = () => {
      $$(".dtabs button", det).forEach(x => x.classList.toggle("on", x === b));
      $$(".dpane", det).forEach(p => p.classList.toggle("hidden", p.dataset.pane !== b.dataset.pane));
      S.abaDetalhe = b.dataset.pane;
    });
    $(".cot-form", det)?.addEventListener("submit", ev => {
      ev.preventDefault();
      const f = new FormData(ev.target), n = k => parseFloat(f.get(k)) || 0;
      Cot.adicionar(key, { forn: f.get("forn").trim(), tipo: f.get("tipo"), cidade: f.get("cidade").trim(), preco: n("preco"), frete: n("frete"), lote: n("lote"), prazo: f.get("prazo").trim(), link: f.get("link").trim(), atende: f.get("atende"), fonte: "manual" });
      renderAnaliseMantendo();
    });
    det.addEventListener("click", ev => {
      const t = ev.target.closest("button, a");
      if (!t) return;
      if (t.dataset.rmcot) { Cot.remover(key, t.dataset.rmcot); renderAnaliseMantendo(); }
      else if (t.dataset.importar) { importarPesquisa(ed, it, key); renderAnaliseMantendo(); }
      else if (t.dataset.ia) pesquisarComIA(it, ed, key, $(`[data-iaout="${CSS.escape(key)}"]`, det));
      else if (t.dataset.pedido) { const o = $(`[data-pedidoout="${CSS.escape(key)}"]`, det); o.innerHTML = o.innerHTML ? "" : pedidoHTML(it, ed); }
      else if (t.hasAttribute("data-copiar")) { navigator.clipboard?.writeText($("textarea", det).value).then(() => toast("Texto copiado"), () => toast("Selecione e copie o texto")); }
    });
  });
}

/* Re-renderiza preservando rolagem, detalhes abertos e aba ativa. */
function renderAnaliseMantendo(focoKey) {
  const abertos = $$("tr.detail:not(.hidden)").map(t => [t.dataset.detail, $(".dtabs button.on", t)?.dataset.pane]);
  const y = window.scrollY;
  renderAnalise();
  abertos.forEach(([k, aba]) => {
    const det = $(`[data-detail="${CSS.escape(k)}"]`);
    if (!det) return;
    det.classList.remove("hidden");
    $(`.dtabs button[data-pane="${aba}"]`, det)?.click();
    const tr = $(`tr.item[data-key="${CSS.escape(k)}"]`);
    if (tr) { tr.classList.add("aberto"); $(".tg", tr).textContent = "Fechar ▴"; }
  });
  window.scrollTo(0, y);
  if (focoKey) {
    const linhas = $$("tr.item"), i = linhas.findIndex(t => t.dataset.key === focoKey);
    $(".cost", linhas[i + 1])?.focus();
  }
}

/* ---------------- CARTEIRA ---------------- */
const STATUS = ["Analisando", "Cotando fornecedor", "Proposta enviada", "Ganhou", "Perdeu", "Desistiu"];
function renderCarteira() {
  const lista = Object.values(S.carteira).sort((a, b) => String(a.encerramento).localeCompare(String(b.encerramento)));
  $("#cartCount").textContent = lista.length;
  const box = $("#carteira");
  if (!lista.length) {
    box.innerHTML = `<div class="empty">${ICON.star.replace('width="15" height="15"', "")}<h3>Sua carteira está vazia</h3><p>Use <b>Salvar</b> nas oportunidades para acompanhar editais aqui.</p></div>`;
    return;
  }
  box.innerHTML = `<div class="table-wrap"><table class="cart"><thead><tr><th>Edital</th><th>Local</th><th>Encerra</th><th>Valor</th><th>Status</th><th>Anotações</th><th></th></tr></thead><tbody>
    ${lista.map(c => `<tr data-id="${esc(c.id)}">
      <td style="max-width:420px"><b>${esc(frase(c.objeto || "").slice(0, 120))}</b><div class="small muted">${esc(nomeProprio(c.orgao))}</div></td>
      <td>${esc(c.municipio)}/${esc(c.uf)}</td>
      <td>${dataHoraBR(c.encerramento)}<div>${prazoTag(c.encerramento)}</div></td>
      <td class="num">${c.valor ? brlCurto(c.valor) : "–"}</td>
      <td><select class="st">${STATUS.map(s => `<option ${s === c.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      <td><input type="text" class="nt" value="${esc(c.nota)}" placeholder="fornecedor, prazo de entrega…"></td>
      <td style="white-space:nowrap"><button class="btn sm primary an">Analisar</button> <a class="btn sm" href="${esc(c.url)}" target="_blank" rel="noopener">PNCP</a> <button class="btn sm ghost rm" title="Remover">✕</button></td>
    </tr>`).join("")}</tbody></table></div>`;
  $$("tr[data-id]", box).forEach(tr => {
    const id = tr.dataset.id;
    $(".st", tr).onchange = e => { S.carteira[id].status = e.target.value; store.set("carteira", S.carteira); };
    $(".nt", tr).onchange = e => { S.carteira[id].nota = e.target.value; store.set("carteira", S.carteira); };
    $(".an", tr).onclick = () => abrirAnalise(id);
    $(".rm", tr).onclick = () => { delete S.carteira[id]; store.set("carteira", S.carteira); renderCarteira(); };
  });
}
function exportarCsv() {
  const lista = Object.values(S.carteira);
  const cab = ["Objeto", "Órgão", "Município", "UF", "Encerramento", "Valor estimado", "Status", "Anotações", "Link"];
  const linhas = lista.map(c => [c.objeto, c.orgao, c.municipio, c.uf, c.encerramento, c.valor ?? "", c.status, c.nota, c.url]);
  const csv = [cab, ...linhas].map(l => l.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  baixar("carteira-licitacoes.csv", "﻿" + csv, "text/csv");
}
function baixar(nome, conteudo, tipo) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- CASOS REAIS ---------------- */
const DECISAO_ROTULO = { ENTRAR: "Entrar", AVALIAR: "Avaliar com cautela", "NAO ENTRAR": "Não entrar" };
function renderCasos() {
  const box = $("#view-casos");
  const casos = S.casos || [];
  const cab = `<div class="section-title"><span class="eyebrow">Estudos de caso</span></div>
    <div class="section-title"><h2>Casos reais de revenda sem estoque</h2></div>
    <p class="lede">Editais abertos na região de Campinas analisados do início ao fim: leitura dos itens, cotação em marketplaces, atacados, fábricas e distribuidores locais, cálculo do preço mínimo e a decisão final. Use como roteiro para os seus próprios editais.</p>`;
  if (!casos.length) { box.innerHTML = cab + `<div class="card empty"><h3>Nenhum estudo publicado ainda</h3></div>`; return; }
  box.innerHTML = cab + `<div class="casos">${casos.map((c, ci) => {
    const dec = c.decisao_classe;
    const conta = d => c.itens.filter(i => i.decisao === d).length;
    const vEntra = c.itens.filter(i => i.decisao === "ENTRAR").reduce((a, i) => a + (i.lance_sugerido || 0) * (i.qtd || 0), 0);
    const fontes = c.itens.reduce((a, i) => a + i.cotacoes.length, 0);
    const linhas = c.itens.map(i => {
      const precos = i.cotacoes.filter(q => q.preco_unit > 0).map(q => q.preco_unit);
      const escala = Math.max(i.teto || 0, i.preco_minimo_viavel || 0, i.melhor_custo_unit || 0) * 1.05 || 1;
      const barra = i.melhor_custo_unit && i.teto ? `<div class="ct" title="Barra: melhor custo · traço: teto do edital"><div class="c ${i.preco_minimo_viavel > i.teto ? "over" : ""}" style="width:${i.melhor_custo_unit / escala * 100}%"></div><div class="t" style="left:${i.teto / escala * 100}%"></div></div>` : "";
      return `<tr><td class="num">${esc(i.n)}</td>
        <td>${esc(i.descricao_curta)}<div class="small muted">${nfmt(i.qtd)} ${esc(i.unidade)} · ${plural(i.cotacoes.length, "fonte consultada", "fontes consultadas")}${precos.length > 1 ? ` · cotado de ${brl(Math.min(...precos))} a ${brl(Math.max(...precos))}` : ""}</div>
          <details class="motivo"><summary>Por quê</summary><p>${esc(i.motivo)}</p></details></td>
        <td class="r num">${brl(i.teto)}</td>
        <td class="r num">${i.melhor_custo_unit ? brl(i.melhor_custo_unit) : "–"}${barra}</td>
        <td class="r num">${i.preco_minimo_viavel ? brl(i.preco_minimo_viavel) : "–"}</td>
        <td><span class="verdict ${i.decisao === "ENTRAR" ? "v-go" : i.decisao === "AVALIAR" ? "v-tight" : "v-no"}">${DECISAO_ROTULO[i.decisao] || esc(i.decisao)}</span></td></tr>`;
    }).join("");
    const riscos = c.riscos || [];
    return `<article class="card">
      <div class="caso-h">
        <div><span class="eyebrow">Caso ${ci + 1} · ${esc(c.edital.municipio)}/${esc(c.edital.uf)} · ${esc(c.edital.modalidade || "")}</span>
          <h3>${esc(frase(c.edital.objeto))}</h3>
          <div class="small muted">${esc(nomeProprio(c.edital.orgao))} · propostas até ${dataHoraBR(c.edital.encerramento)} · perfil: ${esc(c.persona.split(/[,:(]/)[0].slice(0, 80))}</div></div>
        <div class="decisao ${dec}">${esc(c.decisao_titulo)}</div>
      </div>
      <div class="caso-kpis">
        <div><span>Itens analisados</span><b>${c.itens.length}</b></div>
        <div><span>Entrar · avaliar · não</span><b>${conta("ENTRAR")} · ${conta("AVALIAR")} · ${conta("NAO ENTRAR")}</b></div>
        <div><span>Receita dos itens “entrar”</span><b class="num">${vEntra ? brlCurto(vEntra) : "–"}</b></div>
        <div><span>Cotações pesquisadas</span><b>${fontes}</b></div>
      </div>
      <div class="caso-b">
        <div>
          <p style="margin-top:0">${esc(c.resumo)}</p>
          <div class="table-wrap"><table class="hist"><thead><tr><th>#</th><th>Item</th><th class="r">Teto</th><th class="r">Melhor custo</th><th class="r">Preço mínimo</th><th>Decisão</th></tr></thead><tbody>${linhas}</tbody></table></div>
        </div>
        <div>
          <h4 class="eyebrow" style="margin:0 0 4px">Lição</h4>
          <p style="margin:4px 0 14px;font-family:var(--serif);font-size:15px;color:var(--navy)">${esc(c.licao)}</p>
          <h4 class="eyebrow" style="margin:0 0 4px">Riscos e cuidados</h4>
          <ul>${riscos.slice(0, 3).map(r => `<li>${esc(r)}</li>`).join("")}</ul>
          ${riscos.length > 3 ? `<details class="motivo" style="margin:-6px 0 12px"><summary>Mais ${riscos.length - 3} cuidado(s)</summary><ul>${riscos.slice(3).map(r => `<li>${esc(r)}</li>`).join("")}</ul></details>` : ""}
          ${c.exigencias?.length ? `<details class="motivo" style="margin-bottom:12px"><summary>Exigências regulatórias (${c.exigencias.length})</summary><ul>${c.exigencias.map(r => `<li>${esc(r)}</li>`).join("")}</ul></details>` : ""}
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn sm primary" data-caso="${esc(c.edital_id)}">Abrir análise com cotações</button>
            <a class="btn sm" href="${esc(c.edital.url)}" target="_blank" rel="noopener">Edital no PNCP</a>
          </div>
        </div>
      </div>
    </article>`;
  }).join("")}</div>`;
  $$("[data-caso]", box).forEach(b => b.onclick = () => abrirAnalise(b.dataset.caso));
}

/* ---------------- FORNECEDORES ---------------- */
function renderFornecedores() {
  const box = $("#view-fornecedores");
  const lista = S.fornecedores || [];
  const segs = [...new Set(lista.map(f => f.segmento))].sort();
  box.innerHTML = `<div class="section-title"><span class="eyebrow">Rede de fornecedores</span></div>
    <div class="section-title"><h2>Onde comprar para revender</h2></div>
    <p class="lede">Distribuidores, atacados e fábricas identificados nas pesquisas de cotação. Na revenda sem estoque, o melhor preço costuma vir de um distribuidor da região comprando o lote inteiro — peça cotação por escrito com frete até o órgão e validade de 60 dias.</p>
    <div class="toolbar">
      <input type="search" id="fornQ" placeholder="Buscar por nome, cidade ou produto" style="max-width:320px">
      <select id="fornSeg"><option value="">Todos os segmentos</option>${segs.map(s => `<option>${esc(s)}</option>`).join("")}</select>
      <span class="status-line grow" id="fornN"></span>
    </div>
    <div class="card"><div class="table-wrap"><table class="cart"><thead><tr><th>Fornecedor</th><th>Tipo</th><th>Cidade</th><th>Segmento</th><th>Contato / site</th></tr></thead><tbody id="fornBody"></tbody></table></div></div>`;
  const pinta = () => {
    const q = norm($("#fornQ").value), sg = $("#fornSeg").value;
    const base = achaMunicipio(S.cfg.base, S.cfg.uf);
    const f = lista.filter(x => (!sg || x.segmento === sg) && (!q || norm([x.nome, x.cidade, x.segmento, x.produtos].join(" ")).includes(q)))
      .map(x => ({ ...x, _d: distanciaKm(base, achaMunicipio((x.cidade || "").split("/")[0], (x.cidade || "").split("/")[1]?.trim() || "SP")) }))
      .sort((a, b) => (a._d ?? 1e9) - (b._d ?? 1e9));
    $("#fornN").textContent = `${f.length} fornecedores · ordenados pela distância de ${S.cfg.base || "sua cidade"}`;
    $("#fornBody").innerHTML = f.map(x => `<tr><td><b>${esc(x.nome)}</b>${x.produtos ? `<div class="small muted">${esc(x.produtos)}</div>` : ""}</td>
      <td><span class="tag">${esc(TIPOS_FORNECEDOR[x.tipo] || x.tipo || "–")}</span></td>
      <td>${esc(x.cidade || "–")}${x._d != null ? `<div class="small muted">~${nfmt(x._d)} km</div>` : ""}</td><td>${esc(x.segmento)}</td>
      <td class="small">${/^https?:/.test(x.contato || "") ? `<a href="${esc(x.contato)}" target="_blank" rel="noopener">${esc(x.contato.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40))}</a>` : esc(x.contato || "–")}</td></tr>`).join("")
      || `<tr><td colspan="5" class="empty">Nenhum fornecedor com esse filtro.</td></tr>`;
  };
  $("#fornQ").oninput = pinta; $("#fornSeg").onchange = pinta;
  pinta();
}

/* ---------------- GUIA ---------------- */
function renderGuia() {
  $("#view-guia").innerHTML = `
  <div class="section-title"><h2>Guia de licitações para pequenas empresas</h2><span class="muted">O essencial para começar a fornecer ao governo revendendo produtos.</span></div>
  <div class="callout" style="margin-bottom:16px"><b>Atenção ao tamanho do contrato.</b> O MEI pode faturar no máximo <b>R$ 81 mil por ano</b> (valor vigente na última atualização deste guia — confirme com seu contador, há projetos de lei para elevar). Um edital de 1.000 cadeiras a R$ 700 soma R$ 700 mil: não cabe num MEI. Para contratos maiores, o caminho é <b>ME</b> (até R$ 360 mil/ano) ou <b>EPP</b> (até R$ 4,8 milhões/ano) — que mantêm as vantagens da Lei Complementar 123.</div>
  <div class="card" style="margin-bottom:18px"><div class="card-h"><span class="eyebrow">Modelo de negócio</span><h3>Revenda sem estoque: como funciona</h3></div><div class="card-b">
    <div class="jornada" style="margin-bottom:14px">
      <div><i>1</i><b>Ganhar</b><span>Você disputa com o preço de um fornecedor já cotado, sem comprar nada.</span></div>
      <div><i>2</i><b>Empenho</b><span>O órgão emite a nota de empenho / ordem de fornecimento.</span></div>
      <div><i>3</i><b>Comprar</b><span>Só então você fecha o pedido com o fornecedor cotado.</span></div>
      <div><i>4</i><b>Entregar</b><span>Entrega direta no órgão (ou via transportadora), com sua nota fiscal.</span></div>
      <div><i>5</i><b>Receber</b><span>Pagamento em até ~30 dias após o aceite — planeje o capital de giro.</span></div>
    </div>
    <div class="guide">
      <div><h4 class="eyebrow">O que aprendemos nos casos reais</h4><ul class="small">
        <li><b>Marketplace é referência, não fornecedor.</b> Mercado Livre e afins servem para balizar preço; o melhor custo para lote veio de atacados B2B e distribuidores.</li>
        <li><b>Distribuidores da região quase nunca publicam preço.</b> O caminho é o pedido de cotação por WhatsApp/e-mail (o painel gera o texto pronto).</li>
        <li><b>Atas e resultados de outras licitações</b> mostram quem é o fabricante e a que preço ele vende ao governo — ótima pista para negociar.</li>
        <li><b>Teto baixo é comum:</b> em papel A4 o teto (R$ 25) ficou abaixo do custo de mercado. Não entre só porque o volume é grande.</li>
        <li><b>Produto para saúde exige AFE da Anvisa.</b> Sem a autorização, nem adianta cotar.</li>
      </ul></div>
      <div><h4 class="eyebrow">Regras de ouro</h4><ul class="small">
        <li>Cotação <b>por escrito</b>, com frete até o órgão, prazo e validade de 60 dias.</li>
        <li>Fornecedor precisa ter <b>estoque ou prazo garantido</b> — você responde pelo atraso.</li>
        <li>Confira <b>unidade</b> (caixa x unidade), <b>marca/modelo</b> e exigência de <b>amostra</b>.</li>
        <li>Em <b>registro de preços (SRP)</b> o órgão pede aos poucos: o frete de cada entrega pesa mais.</li>
        <li>Nunca dê lance abaixo do <b>preço mínimo</b> que o painel calcula.</li>
      </ul></div>
    </div>
  </div></div>
  <div class="guide">
    <div class="card"><div class="card-h"><h3>Porte da empresa</h3></div><div class="card-b">
      <table class="simple"><thead><tr><th>Porte</th><th>Faturamento/ano</th><th>Para licitação</th></tr></thead><tbody>
        <tr><td><b>MEI</b></td><td>até R$ 81 mil</td><td>Bom para começar com dispensas e itens pequenos. Imposto fixo (DAS).</td></tr>
        <tr><td><b>ME</b></td><td>até R$ 360 mil</td><td>Mesmos benefícios ME/EPP, comporta contratos médios. Simples Nacional.</td></tr>
        <tr><td><b>EPP</b></td><td>até R$ 4,8 mi</td><td>Ideal para revenda em escala; ainda disputa itens exclusivos.</td></tr>
      </tbody></table>
      <p class="small"><b>Benefícios ME/EPP/MEI (LC 123/2006):</b> itens de até R$ 80 mil são <b>exclusivos</b> para pequenas; cota reservada de até 25% em itens divisíveis; empate ficto (se seu lance ficar até 5% acima do de uma grande, você pode cobrir); prazo extra para regularizar certidões fiscais.</p>
    </div></div>

    <div class="card"><div class="card-h"><h3>CNAEs para revenda (comércio)</h3></div><div class="card-b">
      <p class="small" style="margin-top:0">O objeto da licitação precisa ser compatível com as atividades do seu CNPJ. Escolha 1 principal + secundárias conforme os produtos que vai vender:</p>
      <table class="simple"><tbody>
        <tr><td><code>4754-7/01</code></td><td>Comércio varejista de móveis (cadeiras, mesas, armários)</td></tr>
        <tr><td><code>4751-2/01</code></td><td>Equipamentos e suprimentos de informática</td></tr>
        <tr><td><code>4761-0/03</code></td><td>Artigos de papelaria (material de escritório)</td></tr>
        <tr><td><code>4753-9/00</code></td><td>Eletrodomésticos e equipamentos de áudio e vídeo</td></tr>
        <tr><td><code>4744-0/99</code></td><td>Materiais de construção em geral</td></tr>
        <tr><td><code>4789-0/05</code></td><td>Produtos saneantes domissanitários (limpeza)</td></tr>
        <tr><td><code>4781-4/00</code></td><td>Vestuário e acessórios (uniformes)</td></tr>
        <tr><td><code>4789-0/99</code></td><td>Outros produtos não especificados</td></tr>
      </tbody></table>
      <p class="small muted">MEI só pode usar ocupações da lista permitida do Portal do Empreendedor (1 principal + até 15 secundárias). Para ME/EPP há também os CNAEs de <b>atacado</b> (grupo 46), mais adequados para volumes grandes. Valide com seu contador antes de abrir.</p>
    </div></div>

    <div class="card"><div class="card-h"><h3>Documentos de habilitação (checklist)</h3></div><div class="card-b"><ul class="small">
      <li>Cadastro no <b>Compras.gov.br / SICAF</b> (federal e muitos municípios) e nas plataformas usadas pelos órgãos da região (BLL, BNC, Licitanet, Portal de Compras Públicas, BEC-SP).</li>
      <li>Certificado digital e-CNPJ (A1 ou A3).</li>
      <li>CNPJ ativo + contrato social / CCMEI.</li>
      <li>Certidões: Federal e Dívida Ativa da União, FGTS (CRF), Trabalhista (CNDT), Estadual e Municipal.</li>
      <li>Certidão negativa de falência (para ME/EPP).</li>
      <li>Atestado de capacidade técnica (quando exigido) — comece por contratos pequenos para gerar atestados.</li>
      <li>Catálogo/ficha técnica do produto e marca/modelo que vai entregar.</li>
    </ul></div></div>

    <div class="card"><div class="card-h"><h3>Passo a passo da revenda</h3></div><div class="card-b"><ol class="small">
      <li><b>Filtre</b> por raio de entrega e itens exclusivos ME/EPP — menos concorrência grande.</li>
      <li><b>Leia o termo de referência</b>: especificação exata, prazo de entrega, local, garantia e amostra.</li>
      <li><b>Cote 3 fornecedores</b> (fábrica, distribuidor, atacado) com frete até o órgão. Peça a cotação por escrito.</li>
      <li><b>Digite o custo</b> no painel: ele mostra o preço mínimo, o lance sugerido e o lucro.</li>
      <li><b>Dispute</b> sem descer abaixo do preço mínimo. Em pregão, os lances baixam em poucos minutos — defina o piso antes.</li>
      <li><b>Ganhou?</b> Confirme o pedido com o fornecedor só após a homologação / nota de empenho.</li>
      <li><b>Entregue no prazo</b> e emita a nota fiscal. Pagamento público costuma levar até 30 dias após o aceite — planeje o capital de giro.</li>
    </ol></div></div>

    <div class="card"><div class="card-h"><h3>Como o painel decide</h3></div><div class="card-b small">
      <p style="margin-top:0"><b>Preço de referência</b>: preços unitários homologados em compras públicas dos últimos 12 meses do mesmo código CATMAT (fonte: Compras.gov.br). O lance <i>agressivo</i> é o percentil 25%, o <i>equilibrado</i> a mediana e o <i>conservador</i> o percentil 75% — sempre limitados ao teto do edital.</p>
      <p><b>Preço mínimo viável</b> = custo ÷ (1 − impostos − frete − outros − margem mínima).</p>
      <p><b>Veredito</b>: <span class="verdict v-go">Entrar forte</span> preço mínimo ≤ lance agressivo · <span class="verdict v-ok">Viável</span> ≤ mediana · <span class="verdict v-tight">Margem apertada</span> ≤ teto · <span class="verdict v-no">Não compensa</span> acima do teto.</p>
      <p><b>Chance</b> é uma estimativa baseada em quantas compras anteriores fecharam acima do seu lance — use como referência, não como garantia.</p>
      <p style="margin-bottom:0"><b>Atratividade (score)</b> soma: prazo para propor, distância, itens exclusivos ME/EPP, folga entre teto e preço de mercado, cobertura de preços e se cabe no seu porte.</p>
    </div></div>

    <div class="card"><div class="card-h"><h3>Armadilhas comuns</h3></div><div class="card-b"><ul class="small">
      <li><b>Unidade diferente</b>: “caixa com 10” vs “unidade” — o painel alerta quando o histórico destoa muito do teto.</li>
      <li><b>Especificação fechada</b>: produto parecido não serve; o pregoeiro pode recusar.</li>
      <li><b>Amostra</b> exigida em poucos dias — tenha o produto em mãos ou fornecedor ágil.</li>
      <li><b>Ata de registro de preço (SRP)</b>: o órgão pode comprar menos do que o total. Não compre estoque antes do pedido.</li>
      <li><b>Frete e entrega fracionada</b> em vários endereços aumentam o custo.</li>
      <li><b>Multas por atraso</b> e impedimento de licitar se não entregar.</li>
    </ul></div></div>
  </div>`;
}

/* ---------------- CONFIG ---------------- */
function preencherConfig() {
  const c = S.cfg;
  $("#cEmpresa").value = c.empresa || ""; $("#cChave").value = c.chaveIA || "";
  $("#cPorte").value = c.porte; $("#cUf").value = c.uf; $("#cBase").value = c.base; $("#cFat").value = c.fat || "";
  $("#cImp").value = c.imp; $("#cFrete").value = c.frete; $("#cOut").value = c.out; $("#cMarg").value = c.marg; $("#cDist").value = c.dist;
  $("#cProxy").value = c.proxy || "";
}
function salvarConfig() {
  const n = id => parseFloat($(id).value) || 0;
  Object.assign(S.cfg, {
    empresa: $("#cEmpresa").value.trim(), chaveIA: $("#cChave").value.trim(),
    porte: $("#cPorte").value, uf: $("#cUf").value, base: $("#cBase").value.trim(), fat: n("#cFat"),
    imp: n("#cImp"), frete: n("#cFrete"), out: n("#cOut"), marg: n("#cMarg"), dist: n("#cDist"), proxy: $("#cProxy").value.trim(),
  });
  store.set("cfg", S.cfg);
  $("#fUf").value = S.cfg.uf; $("#fBase").value = S.cfg.base;
  preencherCidades();
  toast("Configurações salvas");
}

/* ---------------- navegação ---------------- */
function irPara(v) {
  $$("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  $$("main section[id^=view-]").forEach(s => s.classList.toggle("hidden", s.id !== "view-" + v));
  if (v === "analise" && !S.atual) renderAnalise();
  if (v === "carteira") renderCarteira();
  if (v === "config") preencherConfig();
  if (v === "casos") renderCasos();
  if (v === "fornecedores") renderFornecedores();
  if (location.hash !== "#" + v) history.replaceState(null, "", "#" + v);
  window.scrollTo(0, 0);
}
function setFonte(v) {
  S.fonte = v;
  $$("#fonte button").forEach(b => b.classList.toggle("active", b.dataset.v === v));
}
function preencherCidades() {
  const uf = $("#fUf").value;
  const nomes = [...S.mun.porNome.values()].filter(m => m.uf === uf).map(m => `<option value="${esc(m.nome)}">`);
  $("#cidades").innerHTML = nomes.join("");
}

/* ---------------- início ---------------- */
async function iniciar() {
  const opts = UFS.map(u => `<option>${u}</option>`).join("");
  $("#fUf").innerHTML = opts; $("#cUf").innerHTML = opts;
  $("#fUf").value = S.cfg.uf; $("#fBase").value = S.cfg.base;
  $("#cartCount").textContent = Object.keys(S.carteira).length;
  renderGuia();
  renderJornadas();

  $$("#tabs button").forEach(b => b.onclick = () => irPara(b.dataset.view));
  $$("#fonte button").forEach(b => b.onclick = () => { setFonte(b.dataset.v); buscar(); });
  $("#fBuscar").onclick = () => buscar();
  $("#fQ").addEventListener("keydown", e => { if (e.key === "Enter") buscar(); });
  ["#fRaio", "#fPrazo", "#fMe", "#fHist", "#fPorte", "#fDisp", "#fOrd"].forEach(s => $(s).addEventListener("change", () => S.fonte === "base" ? buscar() : refiltrarVivo()));
  $("#fUf").addEventListener("change", () => { preencherCidades(); buscar(); });
  $("#fBase").addEventListener("change", () => { S.cfg.base = $("#fBase").value.trim(); store.set("cfg", S.cfg); S.fonte === "base" ? buscar() : refiltrarVivo(); });
  $("#fReset").onclick = () => {
    $("#fQ").value = ""; $("#fRaio").value = "150"; $("#fPrazo").value = "2";
    $("#fMe").checked = false; $("#fHist").checked = false; $("#fPorte").checked = true; $("#fDisp").checked = true;
    buscar();
  };
  $("#more").onclick = () => {
    if (S.mostrados < S.resultados.length) { renderLista(false); if (S.fonte === "live") enriquecerVivo(); }
    else if (S.fonte === "live") buscar(true);
  };
  $("#opps").addEventListener("click", e => {
    const a = e.target.closest("[data-analisar]"), s = e.target.closest("[data-salvar]");
    if (a) { e.preventDefault(); abrirAnalise(a.dataset.analisar); }
    if (s) { const ed = acharEdital(s.dataset.salvar); alternarCarteira(ed); s.innerHTML = S.carteira[ed.id] ? ICON.starOn : ICON.star; }
  });
  $("#cSave").onclick = salvarConfig;
  $("#cartCsv").onclick = exportarCsv;
  $("#bkExport").onclick = () => baixar("radar-backup.json", JSON.stringify({ cfg: { ...S.cfg, chaveIA: "" }, custos: S.custos, sel: S.sel, carteira: S.carteira, cotacoes: Cot.todas }, null, 1), "application/json");
  $("#bkImport").onchange = async e => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      for (const k of ["cfg", "custos", "sel", "carteira"]) if (d[k]) { S[k] = d[k]; store.set(k, d[k]); }
      if (d.cotacoes) { Cot.todas = d.cotacoes; Cot.salvar(); }
      preencherConfig(); toast("Backup restaurado");
      $("#cartCount").textContent = Object.keys(S.carteira).length;
    } catch { toast("Arquivo inválido"); }
  };

  // Dados locais (gerados pelo robô)
  const [mun, editais, precos, meta, casos, fornecedores] = await Promise.all(
    ["data/municipios.json", "data/editais.json", "data/precos.json", "data/meta.json", "data/casos.json", "data/fornecedores.json"].map(u => getJSON(u).catch(() => null)));
  S.casos = casos || [];
  S.fornecedores = fornecedores || [];
  for (const [ibge, nome, uf, lat, lon] of mun || []) {
    const m = { ibge, nome, uf, lat, lon };
    S.mun.porIbge.set(ibge, m);
    S.mun.porNome.set(norm(nome) + "|" + uf, m);
  }
  preencherCidades();
  S.base = { editais: editais || [], precos: precos || {}, meta };
  $("#metaInfo").innerHTML = meta
    ? `Base do robô: <b>${nfmt(meta.editais)}</b> editais (${esc(meta.ufs.join(", "))}) · <b>${nfmt(meta.codigos_preco)}</b> itens com preço · atualizada ${dataHoraBR(meta.coletado_em)}`
    : "Base do robô indisponível — usando PNCP ao vivo";
  if (!S.base.editais.length) setFonte("live");

  const v = location.hash.slice(1);
  irPara(["radar", "casos", "fornecedores", "carteira", "guia", "config"].includes(v) ? v : "radar");
  buscar();
  if (v.startsWith("edital=")) abrirAnalise(decodeURIComponent(v.slice(7)));
}

/* Na busca ao vivo, mudar filtros não precisa nova consulta: refiltra o que já veio. */
function refiltrarVivo() {
  const f = lerFiltros();
  S.vivoBruto.forEach(e => enriquecer(e, f.q));
  S.resultados = ordenar(S.vivoBruto.filter(e => passa(e, f)), f.ord);
  $("#status").textContent = `${S.resultados.length} editais filtrados · ${nfmt(S.liveTotal)} abertos no PNCP para a busca`;
  renderLista(true);
  enriquecerVivo();
}

iniciar();
