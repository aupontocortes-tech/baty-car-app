# OpenALPR FastAPI Backend

Backend FastAPI que expõe:

- GET `/`  
- GET `/health`  
- POST `/read-plate`

Ele usa o binário `alpr` (OpenALPR) via linha de comando.

## Como construir e executar com Docker

1. Construa a imagem:
   - Na raiz do projeto, rode:  
     `docker build -t openalpr-fastapi ./openalpr-fastapi`

2. Execute o container:
   - `docker run --rm -p 8000:8000 openalpr-fastapi`

3. Teste os endpoints:
   - Saúde: `http://localhost:8000/health`
   - Leitura de placa (multipart/form-data): `POST http://localhost:8000/read-plate` com o arquivo de imagem no campo `file` e opcional `region` (`br`, `eu`, `us`, etc.).

## Observações
- O Dockerfile agora compila o OpenALPR a partir do código-fonte em `ubuntu:20.04`, evitando links quebrados de binários pré-compilados.
- O aviso do pip sobre rodar como root em Docker é esperado; o ambiente do container é isolado.

