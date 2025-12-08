# Baty Car App — Plate Recognizer

Aplicativo React com funções serverless para leitura de placas usando exclusivamente Plate Recognizer no deploy (Vercel). Para desenvolvimento local, você pode usar o servidor Node local como apoio.

## Instalação

```
npm install
```

## Desenvolvimento

```
npm run dev
```

- Servidor local: `http://localhost:5000`
- Cliente: `http://localhost:3000`

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

## Troubleshooting

- Verifique no DevTools as chamadas para `/api/recognize-bytes` e `/api/recognize`.
- Erros de autenticação: defina `PLATERECOGNIZER_API_KEY` na Vercel.
- Performance de leitura: teste com quadro inteiro vs. recorte central no cliente.

