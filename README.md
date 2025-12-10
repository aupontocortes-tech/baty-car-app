# Baty Car App — Plate Recognizer

Aplicativo React com funções serverless para leitura de placas usando exclusivamente Plate Recognizer no deploy (Vercel). Para desenvolvimento local, você pode usar o servidor Node local como apoio.

## Instalação

```
npm install
```

## Desenvolvimento

1) Configure `.env` na raiz do projeto:
```
PLATERECOGNIZER_BASE_URL=https://api.platerecognizer.com
PLATERECOGNIZER_API_KEY=SEU_TOKEN_AQUI
ALPR_REGION=br
```

2) Suba o backend local (porta 5000):
```
npm run server
```

3) Suba o frontend (porta 3000):
```
cd client
npm start
```

- Backend: `http://localhost:5000`
- Frontend: `http://localhost:3000`

Se a porta 3000 estiver ocupada, finalize o processo atual ou altere a porta do cliente.

## Build

```
npm run build
```

## API no deploy (Vercel)

- Funções expostas no mesmo domínio do frontend:
  - `POST /api/recognize-bytes` (envia `application/octet-stream` do frame e usa `v1/recognize-bytes`)
  - `POST /api/recognize` (envia `multipart/form-data` e faz fallback via `v1/plate-reader`)
- Variáveis de ambiente (defina no projeto Vercel):
  - `PLATERECOGNIZER_BASE_URL` = `https://api.platerecognizer.com`
  - `PLATERECOGNIZER_API_KEY` = `SUA_CHAVE`

## Configuração do cliente

O cliente chama rotas `/api/*` no mesmo domínio. Não é necessário configurar FastAPI nem `REACT_APP_API_BASE` para o deploy.

Para testes custom locais, é possível usar `?fastapi=` para apontar um endpoint alternativo (opcional), mas não é usado no deploy.

> Nota: Em produção (Vercel), o cliente não tenta FastAPI por padrão. A integração FastAPI só é acionada se você passar `?fastapionly=1` na URL e fornecer um endpoint via `?fastapi=`.

## Teste rápido da API local

Com o backend rodando em `http://localhost:5000`, você pode validar com um arquivo local:
```
# Exemplo no PowerShell
powershell -File .\test_api.ps1 -BaseUrl 'http://localhost:5000/api' -ImagePath 'C:\caminho\para\imagem.jpg' -Region 'br'
```

## Troubleshooting

- Permissão da câmera: aceite o prompt do navegador; teste também em aba anônima.
- DevTools > Network: confirme `POST /api/recognize` ou `POST /api/recognize-bytes` sem bloqueio.
- Erros `missing_api_key`: crie `.env` local com `PLATERECOGNIZER_API_KEY` e reinicie o backend.
- Em produção, defina as variáveis no projeto Vercel.
- Performance de leitura: mantenha boa iluminação e estabilidade; a UI já solicita 1280x720 e ajusta o frame.

