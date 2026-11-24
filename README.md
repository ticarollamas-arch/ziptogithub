<p align="center"><img src="assets/banner.svg" alt="ZipToGit — publica ZIPs no GitHub e analisa arquitetura clean-room" width="100%"></p>

# ZipToGit — publicação de ZIP no GitHub e análise de arquitetura clean-room

Aplicação full-stack (**React + Vite** no front-end e **Express** no back-end) que **publica o conteúdo de arquivos compactados direto num repositório do GitHub**, pelo navegador, e faz uma **análise técnica clean-room** de pacotes como ZIP e APK. Com um modelo de linguagem, ela gera um relatório de arquitetura e uma especificação para reimplementar o projeto de forma independente, sem copiar código, design ou marcas de terceiros.

## Recursos

- **Envio de pacotes**: arrastar e soltar, com identificação do formato por *magic bytes* (ZIP, TAR.GZ, RAR, 7z, APK, executáveis).
- **Árvore de arquivos** com pré-visualização e filtro de pastas como `node_modules`, `.git` e builds.
- **Publicação no GitHub** com token pessoal:
  - cria ou atualiza o repositório e a branch escolhidos;
  - pipeline de envio com progresso;
  - arquivos acima de 25 MB ficam de fora, por causa do limite da API.
- **Análise de arquitetura** (`POST /api/analyze-architecture`): relatório técnico e especificação clean-room gerados por IA.
- **Validação do pacote** (`POST /api/validate-package`) antes do envio.
- **Padronização de README** (`POST /api/rebrand-readme`): atualiza o nome do projeto e gera um README profissional, com comparação lado a lado.
- **Auditoria de prompts**: move prompts fixos no código para variáveis de ambiente e cria stubs para testar offline com LLMs locais.
- **Proteções de segurança**:
  - bloqueio de *Zip Slip* (caminhos `..` e absolutos);
  - limite de 2 GB descompactados contra zip bomb;
  - no máximo 3 níveis de arquivos aninhados.
- **Vários provedores de IA**: NVIDIA NIM, OpenAI, DeepSeek, Groq, Gemini ou Ollama local.

## Instalação

Requisitos: **Node.js 20+** e npm.

```bash
git clone https://github.com/ticarollamas-arch/ziptogithub.git
cd ziptogithub
npm install
cp .env.example .env
```

| Variável | Uso |
|---|---|
| `NVIDIA_API_KEY` | NVIDIA NIM (Llama 3.3, Mistral, DeepSeek) |
| `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` | Outros provedores (opcionais) |
| `OLLAMA_BASE_URL` | Ollama local, sem chave (padrão `http://localhost:11434/v1`) |
| `PORT` | Porta do servidor (padrão `3000`) |

## Como usar

```bash
npm run dev        # servidor Express + Vite em http://localhost:3000
npm run build      # build de produção do front-end
npm run lint       # checagem de tipos
```

1. Envie um arquivo compactado e confira a árvore de arquivos.
2. Para publicar, informe um token do GitHub com permissão de escrita em *Contents*, o repositório e a branch.
3. Para analisar, escolha o provedor de IA e gere o relatório e a especificação clean-room.

## Uso responsável

Analise apenas pacotes próprios ou com autorização do titular. A especificação gerada serve para uma implementação original: não remova créditos, avisos de licença ou direitos autorais de código de terceiros.

## Tecnologias

TypeScript · React 19 · Vite · Tailwind CSS v4 · Motion · Express · JSZip · GitHub REST API · NVIDIA NIM · OpenAI · DeepSeek · Groq · Gemini · Ollama

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).

## Publicação no portfólio (`/zip-to-git/`)

Este ramo (`integracao-portfolio`) prepara o app para rodar dentro do domínio do portfólio, sem mudar a interface:

- `app.ts` concentra as rotas Express; `server.ts` continua sendo o servidor local (`npm run dev`).
- `api/index.ts` expõe as mesmas rotas como função serverless da Vercel.
- `npm run build:portfolio` gera o front-end com base `/zip-to-git/`.
- **Modo demonstração pública** (ativo automaticamente na Vercel): ignora URL base enviada pelo navegador (evita SSRF), bloqueia provedores locais e não usa as chaves do servidor, a menos que `DEMO_USE_SERVER_KEYS=true`. O visitante usa o próprio token do GitHub e, se quiser, a própria chave de IA; sem chave, a análise local de fallback continua funcionando.
- Correção de segurança: o `vite.config.ts` deixava variáveis `NVIDIA_*` irem para o JavaScript público. Agora só `VITE_*` vai para o navegador.

Deploy: importe o repositório na Vercel escolhendo o ramo `integracao-portfolio` (ou faça merge na `main`). O `vercel.json` já define build, saída e rotas.
