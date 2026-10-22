# Radar de Licitações

Painel para encontrar licitações abertas perto de você, comparar o teto do edital com o
preço que o governo realmente paga e decidir se vale revender o produto — com lance
sugerido, chance estimada e lucro.

Roda 100% no GitHub (GitHub Pages + GitHub Actions), sem servidor e sem custo.

## Como funciona

| Parte | O que faz |
|---|---|
| `index.html` + `assets/` | O painel (abre em qualquer navegador). |
| `scripts/coletar.py` | Robô que baixa editais abertos do **PNCP** e o histórico de preços homologados do **Compras.gov.br**. |
| `.github/workflows/coletar.yml` | Roda o robô 3x por dia e salva os dados em `data/`. |
| `config.json` | Estados que o robô cobre e limites da coleta. |
| `proxy/cloudflare-worker.js` | (Opcional) permite consultar preços ao vivo de editais fora da base. |

O painel tem duas fontes:

- **Base do robô** — rápida e completa (itens, valores, histórico de preços) para os estados do `config.json`.
- **Ao vivo (PNCP)** — busca em qualquer estado na hora; os itens são carregados direto do PNCP.

## Publicar no GitHub (uma vez)

1. Crie um repositório no GitHub (ex.: `radar-licitacoes`) e envie esta pasta:
   ```bash
   git init
   git add .
   git commit -m "Radar de Licitações"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/radar-licitacoes.git
   git push -u origin main
   ```
2. No repositório: **Settings → Pages → Source: Deploy from a branch → main / (root)** → Save.
3. **Settings → Actions → General → Workflow permissions → Read and write** → Save.
4. **Actions → Coletar licitações → Run workflow** para a primeira coleta (leva de 20 a 60 min).
5. Acesse `https://SEU-USUARIO.github.io/radar-licitacoes/`.

## Ajustes

- **Mais estados**: edite `config.json` → `"ufs": ["SP", "MG", "PR"]`. Cada estado aumenta o tempo da coleta.
- **Custos, porte e cidade base**: na aba *Configurações* do painel.
- **Testar localmente**: `python -m http.server 8000` nesta pasta e abra `http://localhost:8000`.

## Limitações conhecidas

- O histórico de preços usa o código CATMAT do item. Itens sem código (comuns em prefeituras
  que usam catálogo próprio) não têm série histórica — use os links de fornecedores.
- Preço de varejo (Mercado Livre, Amazon etc.) não é consultado automaticamente: essas lojas
  bloqueiam robôs. O painel abre a busca pronta e você digita o custo encontrado.
- Carteira e custos digitados ficam no navegador de quem usa. Use *Configurações → Baixar backup*.
- Se o GitHub Actions for bloqueado pelos portais do governo, rode `python scripts/coletar.py`
  no seu computador e faça `git push` da pasta `data/`.
