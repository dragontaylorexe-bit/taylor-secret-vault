"""Run ONLY on your own computer to authorize the existing Google OAuth app."""
import argparse
import json
from pathlib import Path

SCOPES = ["https://www.googleapis.com/auth/drive.appdata"]


def main():
    parser = argparse.ArgumentParser(description="Connect this vault to Google Drive locally.")
    parser.add_argument("--client", default="client_secret.json", help="Google Desktop OAuth client JSON")
    parser.add_argument("--output", default="token.json", help="Private output file (never commit it)")
    args = parser.parse_args()
    client = Path(args.client)
    output = Path(args.output)
    if not client.is_file():
        parser.error("Missing client_secret.json. Read HUONG_DAN.md, section Google Drive.")
    try:
        info = json.loads(client.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        parser.error("The OAuth client file is not valid JSON.")
    if "installed" not in info:
        parser.error("Use a Google Desktop app OAuth client. A Web application client is not supported by this helper.")
    if output.exists():
        answer = input("A token file already exists. Replace it? Type YES to continue: ")
        if answer != "YES":
            print("Kept the existing file.")
            return
    from google_auth_oauthlib.flow import InstalledAppFlow
    flow = InstalledAppFlow.from_client_config(info, SCOPES)
    credentials = flow.run_local_server(port=0, access_type="offline", prompt="consent")
    if not credentials.refresh_token:
        raise SystemExit("Google did not return a refresh token. Re-authorize with consent, then retry.")
    output.write_text(credentials.to_json(), encoding="utf-8")
    print(f"Saved private token to {output.resolve()}.")
    print("Paste its complete JSON into Render Environment > DRIVE_TOKEN_JSON.")
    print("Do not upload this file or client_secret.json to GitHub.")


if __name__ == "__main__":
    main()
