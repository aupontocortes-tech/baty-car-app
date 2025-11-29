from fastapi import FastAPI, UploadFile, File
import subprocess
import tempfile
import json

app = FastAPI()

@app.get("/")
def root():
    return {"ok": True}

@app.get("/health")
def health():
    return {"ok": True, "alpr_version": "local"}

@app.post("/read-plate")
async def read_plate(file: UploadFile = File(...), region: str = "br"):
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
    content = await file.read()
    tmp.write(content)
    tmp.close()

    cmd = [
        "alpr",
        "-c", region,
        tmp.name
    ]

    out = subprocess.run(cmd, capture_output=True, text=True)
    try:
        data = json.loads(out.stdout)
    except:
        data = {"raw": out.stdout}

    return {"results": data.get("results", []), "raw": data}
