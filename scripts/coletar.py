"""
Robô coletor do Radar de Licitações.

Roda no GitHub Actions (ou local) e gera os arquivos que o painel lê:
  data/editais.json  -> editais abertos (recebendo proposta) com seus itens
  data/precos.json   -> histórico de preços homologados por código CATMAT
  data/meta.json     -> data da coleta e parâmetros

Fontes (dados abertos, sem login):
  - PNCP (Portal Nacional de Contratações Públicas)
  - Compras.gov.br - módulo Pesquisa de Preço

Uso:  python scripts/coletar.py            (usa config.json)
      UFS=SP,MG MAX_EDITAIS=300 python scripts/coletar.py
Só usa a biblioteca padrão do Python.
"""
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DADOS = os.path.join(RAIZ, "data")

PNCP_BUSCA = "https://pncp.gov.br/api/search/"
PNCP_ITENS = "https://pncp.gov.br/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens"
PRECOS = "https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial"

# Modalidades que interessam para revenda de bens (ids do PNCP)
MODALIDADES_OK = {"4", "5", "6", "7", "8"}  # concorrência, pregão, dispensa


def carregar_config():
    cfg = {"ufs": ["SP"], "max_editais": 600, "paginas_por_uf": 20,
           "meses_historico": 12, "threads": 8, "threads_precos": 3}
    caminho = os.path.join(RAIZ, "config.json")
    if os.path.exists(caminho):
        with open(caminho, encoding="utf-8") as f:
            cfg.update(json.load(f))
    if os.environ.get("UFS"):
        cfg["ufs"] = [u.strip().upper() for u in os.environ["UFS"].split(",") if u.strip()]
    if os.environ.get("MAX_EDITAIS"):
        cfg["max_editais"] = int(os.environ["MAX_EDITAIS"])
    if os.environ.get("PAGINAS_POR_UF"):
        cfg["paginas_por_uf"] = int(os.environ["PAGINAS_POR_UF"])
    return cfg


FALHA = object()  # distingue "sem dados" de "erro de rede"
# O PNCP derruba conexões com User-Agent de robô; usamos o de um navegador comum.
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def get_json(url, params=None, tentativas=5):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.status == 204:
                    return None
                corpo = r.read()
                return json.loads(corpo) if corpo else None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            erro = e
            espera = 8 * (i + 1) if e.code == 429 else 2 * (i + 1)
        except Exception as e:  # noqa: BLE001 - rede instável é esperado
            erro, espera = e, 2 * (i + 1)
        if i == tentativas - 1:
            print(f"  ! falhou {url[:120]}: {erro}", file=sys.stderr)
            return FALHA
        time.sleep(espera)


def buscar_editais(uf, paginas):
    editais = []
    agora = datetime.now().strftime("%Y-%m-%dT%H:%M")
    for p in range(1, paginas + 1):
        d = get_json(PNCP_BUSCA, {"tipos_documento": "edital", "ordenacao": "-data", "pagina": p,
                                  "tam_pagina": 50, "status": "recebendo_proposta", "ufs": uf})
        if d is FALHA or not d or not d.get("items"):
            break
        for e in d["items"]:
            if e.get("cancelado") or e.get("modalidade_licitacao_id") not in MODALIDADES_OK:
                continue
            fim = e.get("data_fim_vigencia") or ""
            if fim and fim[:16] < agora:
                continue
            editais.append(e)
        print(f"  {uf} página {p}: {len(d['items'])} (total {d.get('total')})")
    return editais


def itens_do_edital(e):
    cnpj, ano, seq = e["orgao_cnpj"], e["ano"], e["numero_sequencial"]
    itens, pagina = [], 1
    while True:
        d = get_json(PNCP_ITENS.format(cnpj=cnpj, ano=ano, seq=seq),
                     {"pagina": pagina, "tamanhoPagina": 100})
        if d is FALHA or not d:
            break
        itens.extend(d)
        if len(d) < 100:
            break
        pagina += 1
    out = []
    for it in itens:
        cat = (it.get("catalogo") or {}).get("id")
        out.append({
            "n": it.get("numeroItem"),
            "d": (it.get("descricao") or "").strip()[:400],
            "q": it.get("quantidade") or 0,
            "u": it.get("unidadeMedida") or "",
            "v": it.get("valorUnitarioEstimado") or 0,
            "s": bool(it.get("orcamentoSigiloso")),
            "b": it.get("tipoBeneficio"),
            "m": it.get("materialOuServico"),
            "c": str(it["catalogoCodigoItem"]) if cat == 1 and it.get("catalogoCodigoItem") else None,
            "r": it.get("temResultado", False),
        })
    return out


def resumo_edital(e, itens):
    return {
        "id": e["numero_controle_pncp"],
        "cnpj": e["orgao_cnpj"], "ano": e["ano"], "seq": e["numero_sequencial"],
        "titulo": e.get("title"),
        "objeto": (e.get("description") or "").strip(),
        "orgao": e.get("orgao_nome"), "unidade": e.get("unidade_nome"),
        "municipio": e.get("municipio_nome"), "ibge": e.get("codigo_ibge"), "uf": e.get("uf"),
        "esfera": e.get("esfera_nome"), "modalidade": e.get("modalidade_licitacao_nome"),
        "publicacao": (e.get("data_publicacao_pncp") or "")[:16],
        "abertura": (e.get("data_inicio_vigencia") or "")[:16],
        "encerramento": (e.get("data_fim_vigencia") or "")[:16],
        "url": "https://pncp.gov.br/app/editais/" + e["orgao_cnpj"] + "/" + e["ano"] + "/" + e["numero_sequencial"],
        "itens": itens,
    }


def historico_precos(codigo, inicio, fim):
    d = get_json(PRECOS, {"pagina": 1, "tamanhoPagina": 500, "tipo": "codigoItemCatalogo",
                          "codigo": codigo, "dataCompraInicio": inicio, "dataCompraFim": fim})
    if d is FALHA:
        return FALHA
    if not d or not d.get("resultado"):
        return None
    regs = [r for r in d["resultado"] if (r.get("precoUnitario") or 0) > 0]
    if not regs:
        return None
    precos = sorted(float(r["precoUnitario"]) for r in regs)
    # Remove extremos absurdos (erros de unidade) com cerca de Tukey
    if len(precos) >= 8:
        q1, _, q3 = statistics.quantiles(precos, n=4)
        iqr = q3 - q1
        precos_f = [p for p in precos if q1 - 3 * iqr <= p <= q3 + 3 * iqr] or precos
    else:
        precos_f = precos

    def pct(lst, p):
        if len(lst) == 1:
            return lst[0]
        k = (len(lst) - 1) * p
        f = int(k)
        return lst[f] + (lst[min(f + 1, len(lst) - 1)] - lst[f]) * (k - f)

    regs.sort(key=lambda r: r.get("dataResultado") or r.get("dataCompra") or "", reverse=True)
    ult = [{
        "data": r.get("dataResultado") or r.get("dataCompra"),
        "preco": round(float(r["precoUnitario"]), 2),
        "qtd": r.get("quantidade"),
        "uf": r.get("estado"), "mun": r.get("municipio"),
        "orgao": r.get("nomeUasg") or r.get("nomeOrgao"),
        "forn": r.get("nomeFornecedor"), "marca": r.get("marca"),
        "un": r.get("nomeUnidadeFornecimento") or r.get("siglaUnidadeMedida"),
    } for r in regs[:12]]
    return {
        "desc": (regs[0].get("descricaoItem") or "")[:200],
        "n": len(precos_f), "total": d.get("totalRegistros", len(regs)),
        "min": round(precos_f[0], 2), "p25": round(pct(precos_f, .25), 2),
        "med": round(pct(precos_f, .5), 2), "p75": round(pct(precos_f, .75), 2),
        "max": round(precos_f[-1], 2), "ult": ult,
    }


def main():
    cfg = carregar_config()
    os.makedirs(DADOS, exist_ok=True)
    print("Config:", cfg)

    brutos = []
    for uf in cfg["ufs"]:
        brutos.extend(buscar_editais(uf, cfg["paginas_por_uf"]))
    vistos, unicos = set(), []
    for e in brutos:
        if e["numero_controle_pncp"] not in vistos:
            vistos.add(e["numero_controle_pncp"])
            unicos.append(e)
    unicos = unicos[: cfg["max_editais"]]
    print(f"Editais a detalhar: {len(unicos)}")

    with ThreadPoolExecutor(cfg["threads"]) as ex:
        lista_itens = list(ex.map(itens_do_edital, unicos))
    editais = [resumo_edital(e, it) for e, it in zip(unicos, lista_itens)]
    # Só interessa quem tem material (bens para revenda)
    editais = [e for e in editais if any(i["m"] == "M" for i in e["itens"])]
    print(f"Editais com material: {len(editais)}")

    # Reaproveita histórico já coletado (válido por 7 dias) para economizar chamadas
    caminho_precos = os.path.join(DADOS, "precos.json")
    precos = {}
    if os.path.exists(caminho_precos):
        with open(caminho_precos, encoding="utf-8") as f:
            precos = json.load(f)
    limite = (date.today() - timedelta(days=7)).isoformat()
    precos = {k: v for k, v in precos.items() if v and v.get("em", "") >= limite}

    codigos = sorted({i["c"] for e in editais for i in e["itens"] if i["c"] and i["m"] == "M"} - set(precos))
    fim = date.today().isoformat()
    inicio = (date.today() - timedelta(days=30 * cfg["meses_historico"])).isoformat()
    print(f"Códigos CATMAT a consultar: {len(codigos)} (em cache: {len(precos)})")

    def tarefa(c):
        h = historico_precos(c, inicio, fim)
        if h and h is not FALHA:
            h["em"] = fim
        return c, h

    # A API de preços limita requisições (HTTP 429): poucas threads em paralelo
    with ThreadPoolExecutor(cfg["threads_precos"]) as ex:
        for i, (c, h) in enumerate(ex.map(tarefa, codigos), 1):
            if h is FALHA:
                continue  # tenta de novo na próxima coleta
            precos[c] = h or {"n": 0, "em": fim}
            if i % 100 == 0:
                print(f"  preços {i}/{len(codigos)}")

    # Mantém só códigos usados pelos editais atuais
    usados = {i["c"] for e in editais for i in e["itens"] if i["c"]}
    precos = {k: v for k, v in precos.items() if k in usados}

    with open(os.path.join(DADOS, "editais.json"), "w", encoding="utf-8") as f:
        json.dump(editais, f, ensure_ascii=False, separators=(",", ":"))
    with open(caminho_precos, "w", encoding="utf-8") as f:
        json.dump(precos, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DADOS, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({"coletado_em": datetime.now().strftime("%Y-%m-%dT%H:%M"), "ufs": cfg["ufs"],
                   "editais": len(editais), "codigos_preco": sum(1 for v in precos.values() if v.get("n")),
                   "historico_desde": inicio}, f, ensure_ascii=False)
    print("Pronto.")


if __name__ == "__main__":
    main()
