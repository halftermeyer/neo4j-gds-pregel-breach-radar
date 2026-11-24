#!/usr/bin/env python3
"""Optional last step of the demo-video skill: upload dist/demo.mp4 to YouTube as UNLISTED, add the SRT captions,
and link it from the README.

Title, description and tags come from the ```scene-config block of the demo script (title, subtitle,
youtube_description, youtube_tags) unless overridden on the command line.

Privacy is hardcoded to "unlisted" on purpose: this script never publishes a public video.

One-time setup (you):
  1. Google Cloud project -> enable "YouTube Data API v3".
  2. OAuth consent screen (External, add yourself as a test user) -> create an OAuth client of type "Desktop app".
  3. Download its JSON to  video/.yt/client_secret.json   (gitignored).
  4. pip install google-api-python-client google-auth-oauthlib
  5. python3 video/tools/youtube_upload.py     (a browser opens once to approve; the token is cached in video/.yt/token.json)

Notes: an unverified API project may only upload private videos until it passes a YouTube API audit; if the video
comes out private, switch it to unlisted in YouTube Studio once. Uploading costs about 1,600 quota units (default 10,000/day).
A second upload creates a second video, so the script refuses to run again unless you pass --new.
"""
import argparse, json, pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
YT = ROOT / "video" / ".yt"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"]
START, END = "<!-- demo-video:start -->", "<!-- demo-video:end -->"


def scene_config(script):
    """Minimal read of the scene-config block: top-level `key: value` lines."""
    m = re.search(r"```scene-config\n(.*?)```", script.read_text(), re.S) if script.exists() else None
    cfg = {}
    for line in (m.group(1).splitlines() if m else []):
        k, _, v = line.partition(":")
        if v.strip() and not line.startswith((" ", "#")):
            cfg[k.strip()] = v.split("  #")[0].strip().strip('"')
    return cfg


def credentials():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    secret, token = YT / "client_secret.json", YT / "token.json"
    if not secret.exists():
        sys.exit(f"missing {secret}\nSee the docstring of this file for the one-time OAuth setup.")
    creds = Credentials.from_authorized_user_file(token, SCOPES) if token.exists() else None
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            creds = InstalledAppFlow.from_client_secrets_file(secret, SCOPES).run_local_server(port=0)
        token.write_text(creds.to_json())
    return creds


def upload(a):
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    yt = build("youtube", "v3", credentials=credentials())
    body = {
        "snippet": {"title": a.title, "description": a.description, "categoryId": "28", "tags": a.tags},
        "status": {"privacyStatus": "unlisted", "selfDeclaredMadeForKids": False},
    }
    media = MediaFileUpload(str(a.video), mimetype="video/mp4", chunksize=8 * 1024 * 1024, resumable=True)
    req = yt.videos().insert(part="snippet,status", body=body, media_body=media)
    resp = None
    while resp is None:
        status, resp = req.next_chunk()
        if status:
            print(f"  uploaded {int(status.progress() * 100)}%")
    vid = resp["id"]
    print(f"✔ uploaded, privacy={resp['status']['privacyStatus']}  https://youtu.be/{vid}")
    if resp["status"]["privacyStatus"] != "unlisted":
        print("  ! YouTube kept it private (unverified API project): set it to Unlisted in YouTube Studio.")
    if a.srt.exists():
        yt.captions().insert(
            part="snippet",
            body={"snippet": {"videoId": vid, "language": "en", "name": "English", "isDraft": False}},
            media_body=MediaFileUpload(str(a.srt), mimetype="application/octet-stream"),
        ).execute()
        print("✔ captions added")
    return vid


def update_readme(vid, thumb):
    readme = ROOT / "README.md"
    block = f"{START}\n[![Demo video (YouTube, unlisted)]({thumb})](https://youtu.be/{vid})\n{END}"
    text = readme.read_text()
    if START in text and END in text:
        text = re.sub(re.escape(START) + r".*?" + re.escape(END), block, text, flags=re.S)
    else:
        text = text.rstrip() + f"\n\n## Demo video\n\n{block}\n"
    readme.write_text(text)
    print(f"✔ README.md links https://youtu.be/{vid}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", type=pathlib.Path, default=ROOT / "dist" / "demo.mp4")
    ap.add_argument("--srt", type=pathlib.Path, default=ROOT / "dist" / "demo.srt")
    ap.add_argument("--script", type=pathlib.Path, default=ROOT / "demo-script.md")
    ap.add_argument("--title"); ap.add_argument("--description"); ap.add_argument("--tags", help="comma separated")
    ap.add_argument("--thumb-frame", type=pathlib.Path, help="default: the middle scene frame of dist/frames")
    ap.add_argument("--thumb-out", default="docs/demo-thumb.png", help="where the README thumbnail is written (relative to the project)")
    ap.add_argument("--dry-run", action="store_true", help="no auth, no upload: print what would be sent and refresh the README with a fake id")
    ap.add_argument("--new", action="store_true", help="upload again even though a video was already uploaded")
    ap.add_argument("--readme-only", action="store_true", help="skip the upload, only refresh the README link from the saved id")
    a = ap.parse_args()

    cfg = scene_config(a.script)
    a.title = a.title or cfg.get("title", "Demo")
    a.description = a.description or cfg.get("youtube_description") or cfg.get("subtitle", "")
    a.tags = [t.strip() for t in (a.tags or cfg.get("youtube_tags", "")).split(",") if t.strip()]
    YT.mkdir(parents=True, exist_ok=True)
    state = YT / "last_upload.json"
    thumb = a.thumb_out
    frames = sorted((ROOT / "dist" / "frames").glob("*__mid.png"))
    frame = a.thumb_frame or (frames[len(frames) // 2] if frames else None)
    if frame and frame.exists():
        (ROOT / thumb).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(frame, ROOT / thumb)
    if a.readme_only:
        update_readme(json.loads(state.read_text())["id"], thumb)
        return
    if not a.video.exists():
        sys.exit(f"{a.video} not found: run `make video` first")
    if state.exists() and not a.new:
        sys.exit(f"already uploaded: https://youtu.be/{json.loads(state.read_text())['id']}  (use --new for a second video, --readme-only to refresh the README)")
    if a.dry_run:
        print(f"DRY RUN: would upload {a.video} (exists={a.video.exists()}) as UNLISTED\n  title: {a.title}\n  description: {a.description}\n  tags: {a.tags}\n  captions: {a.srt} (exists={a.srt.exists()})")
        update_readme("DRYRUN0000", thumb)
        return
    vid = upload(a)
    state.write_text(json.dumps({"id": vid}))
    update_readme(vid, thumb)


if __name__ == "__main__":
    main()
