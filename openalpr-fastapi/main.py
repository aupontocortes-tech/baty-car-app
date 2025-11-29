from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import subprocess
import tempfile
import json

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"status": "ok"}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/read-plate")
async def read_plate(file: UploadFile = File(...), region: str = "br"):
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
    content = await file.read()
    tmp.write(content)
    tmp.close()

    region = (region or "br").lower()
    if region == "br":
        region = "eu"
    cmd = [
        "alpr",
        "-c", region,
        "-j",
        tmp.name
    ]

    out = subprocess.run(cmd, capture_output=True, text=True)
    try:
        data = json.loads(out.stdout)
    except:
        data = {"raw": out.stdout}

    return {"results": data.get("results", []), "raw": data}
