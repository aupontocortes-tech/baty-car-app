from fastapi import FastAPI, UploadFile, File, Request
from fastapi.responses import JSONResponse
import base64, os, tempfile, subprocess, json

app = FastAPI()

def save_temp_bytes(b: bytes) -> str:
    fd, path = tempfile.mkstemp(suffix=".jpg")
    os.write(fd, b)
    os.close(fd)
    return path

def run_alpr(image_path: str, region: str) -> dict:
    cmd = ["alpr", "-j", "-c", region, image_path]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise Exception(p.stderr or p.stdout)
    return json.loads(p.stdout)

def extract_best(result: dict) -> dict:
    arr = result.get("results") or []
    best = None
    for r in arr:
        conf = r.get("confidence")
        plate = r.get("plate")
        if plate is None:
            continue
        if best is None or (isinstance(conf, (int,float)) and conf > best.get("confidence", 0)):
            best = {"plate": plate, "confidence": float(conf or 0)}
    return best or {"plate": "", "confidence": 0.0}

@app.post("/read-plate")
async def read_plate(request: Request, file: UploadFile | None = File(default=None)):
    region = (request.query_params.get("region") or "us").lower()
    body = None
    ct = (request.headers.get("content-type") or "").lower()
    if file is not None:
        body = await file.read()
    elif "application/octet-stream" in ct:
        body = await request.body()
    else:
        try:
            j = await request.json()
            raw = str(j.get("image") or "")
            raw = raw.split(",")[-1]
            body = base64.b64decode(raw)
        except Exception:
            body = None
    if not body:
        return JSONResponse({"error": "missing_image"}, status_code=400)
    path = save_temp_bytes(body)
    try:
        result = run_alpr(path, region)
        best = extract_best(result)
        return JSONResponse({"plate": best["plate"], "confidence": best["confidence"], "raw": result})
    except Exception as e:
        return JSONResponse({"error": "alpr_failed", "detail": str(e)}, status_code=500)
    finally:
        try:
            os.remove(path)
        except Exception:
            pass

