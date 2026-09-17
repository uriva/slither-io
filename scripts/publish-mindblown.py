import os
import sys
import json
import time
import shutil
import urllib.request
import urllib.error
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT_DIR / "out"
CREDS_PATH = Path(os.path.expanduser("~/.config/mindblown/credentials.json"))
MINDBLOWN_META = ROOT_DIR / "mindblown.json"

def prepare_static_export():
    if not OUT_DIR.exists():
        print("ERROR: out/ directory does not exist. Run 'next build' first.")
        sys.exit(1)

    # Remove internal Next.js server metadata files
    for f in list(OUT_DIR.glob("__next*")):
        if f.is_file():
            f.unlink()

    for f in list(OUT_DIR.glob("_not-found*")):
        if f.is_dir():
            shutil.rmtree(f)
        elif f.is_file():
            f.unlink()

    index_txt = OUT_DIR / "index.txt"
    if index_txt.exists():
        index_txt.unlink()

    # Mindblown & Cloudflare block paths starting with underscore '_', so rename _next to next
    src_next = OUT_DIR / "_next"
    dst_next = OUT_DIR / "next"
    if src_next.exists():
        if dst_next.exists():
            shutil.rmtree(dst_next)
        src_next.rename(dst_next)

    # Rename any leftover internal files starting with underscore
    for p in list(OUT_DIR.rglob("_*")):
        if p.is_file():
            p.rename(p.parent / p.name.lstrip("_"))

    # Update relative links and paths in all text assets
    text_exts = {".html", ".js", ".css", ".txt", ".json", ".svg"}
    for p in OUT_DIR.rglob("*"):
        if p.is_file() and p.suffix in text_exts:
            try:
                content = p.read_text(encoding="utf-8")
                changed = False
                if "_next" in content:
                    content = content.replace("_next", "next")
                    changed = True
                if "href=\"/favicon.ico" in content:
                    content = content.replace("href=\"/favicon.ico", "href=\"./favicon.ico")
                    changed = True
                if "_buildManifest" in content:
                    content = content.replace("_buildManifest", "buildManifest")
                    changed = True
                if "_ssgManifest" in content:
                    content = content.replace("_ssgManifest", "ssgManifest")
                    changed = True
                if "_clientMiddlewareManifest" in content:
                    content = content.replace("_clientMiddlewareManifest", "clientMiddlewareManifest")
                    changed = True
                if changed:
                    p.write_text(content, encoding="utf-8")
            except Exception as e:
                print(f"Warning processing {p}: {e}")

    print("Static export directory prepared and validated.")

def refresh_token(creds):
    ref_token = creds.get("refresh_token")
    if not ref_token:
        print("ERROR: No refresh_token to refresh.")
        return None
    req = urllib.request.Request(
        "https://api.mindblown.ai/auth/device/refresh",
        data=json.dumps({"refresh_token": ref_token}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            creds["access_token"] = data["access_token"]
            creds["refresh_token"] = data.get("refresh_token", ref_token)
            with open(CREDS_PATH, "w") as f:
                json.dump(creds, f, indent=2)
            print("Access token refreshed successfully.")
            return creds["access_token"]
    except Exception as e:
        print(f"Failed to refresh token: {e}")
        return None

def create_multipart_payload(fields, files, boundary):
    crlf = b"\r\n"
    body = bytearray()
    
    for k, v in fields.items():
        body.extend(b"--" + boundary.encode("utf-8") + crlf)
        body.extend(f'Content-Disposition: form-data; name="{k}"'.encode("utf-8") + crlf + crlf)
        body.extend(str(v).encode("utf-8") + crlf)
        
    for field_name, file_path, rel_path in files:
        with open(file_path, "rb") as f:
            content = f.read()
            
        body.extend(b"--" + boundary.encode("utf-8") + crlf)
        body.extend(f'Content-Disposition: form-data; name="{field_name}"; filename="{rel_path}"'.encode("utf-8") + crlf)
        body.extend(b"Content-Type: application/octet-stream" + crlf + crlf)
        body.extend(content + crlf)
        
    body.extend(b"--" + boundary.encode("utf-8") + b"--" + crlf)
    return bytes(body)

def main():
    prepare_static_export()

    if not CREDS_PATH.exists():
        print(f"ERROR: Credentials file not found at {CREDS_PATH}")
        sys.exit(1)
        
    with open(CREDS_PATH, "r") as f:
        creds = json.load(f)
        
    token = creds.get("access_token")
    if not token:
        print("ERROR: No access_token in credentials.json")
        sys.exit(1)

    page_id = None
    if MINDBLOWN_META.exists():
        with open(MINDBLOWN_META, "r") as f:
            page_id = json.load(f).get("page_id")

    file_list = []
    for path in sorted(OUT_DIR.rglob("*")):
        if path.is_file():
            rel_path = path.relative_to(OUT_DIR).as_posix()
            file_list.append(("files", str(path), rel_path))
            
    print(f"Uploading {len(file_list)} files to mindblown.ai ...")
    
    boundary = "----MindblownUploadBoundary" + hex(int(time.time() * 1000))[2:]
    fields = {
        "title": "Slither.io — Cyber Serpent Arena",
        "entry": "index.html",
    }
    if page_id:
        fields["page_id"] = page_id
    else:
        fields["slug"] = "slither"
    
    payload = create_multipart_payload(fields, file_list, boundary)
    
    def try_upload(tok):
        req = urllib.request.Request(
            "https://api.mindblown.ai/publish",
            data=payload,
            headers={
                "Authorization": f"Bearer {tok}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            }
        )
        return urllib.request.urlopen(req)

    try:
        resp = try_upload(token)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print("Token expired. Refreshing token...")
            new_tok = refresh_token(creds)
            if new_tok:
                resp = try_upload(new_tok)
                token = new_tok
            else:
                sys.exit(1)
        else:
            print(f"HTTP Error {e.code}: {e.read().decode('utf-8')}")
            sys.exit(1)
            
    data = json.loads(resp.read().decode("utf-8"))
    job_id = data.get("job_id")
    status_url = data.get("status_url") or f"/publish/{job_id}"
    if not status_url.startswith("http"):
        status_url = f"https://api.mindblown.ai{status_url}"
        
    poll_interval = data.get("poll_after_seconds", 5)
    print(f"Publish job submitted ({job_id}). Waiting for render gate...")
    
    for _ in range(60):
        time.sleep(poll_interval)
        poll_req = urllib.request.Request(
            status_url,
            headers={"Authorization": f"Bearer {token}"}
        )
        try:
            with urllib.request.urlopen(poll_req) as resp:
                status_data = json.loads(resp.read().decode("utf-8"))
                state = status_data.get("state")
                if state == "done":
                    result = status_data.get("result", {})
                    print(f"\nPublished successfully! URL: {result.get('url')}")
                    with open(MINDBLOWN_META, "w") as f:
                        json.dump(result, f, indent=2)
                    return
                elif state == "failed":
                    print(f"\nPublish failed: {json.dumps(status_data, indent=2)}")
                    sys.exit(1)
                poll_interval = status_data.get("poll_after_seconds", 5)
        except urllib.error.HTTPError as e:
            print(f"Poll Error {e.code}: {e.read().decode('utf-8')}")
            sys.exit(1)

if __name__ == "__main__":
    main()
