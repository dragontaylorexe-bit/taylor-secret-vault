from fastapi import FastAPI, File, UploadFile, Depends, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
import io
import os
import json
import requests
from typing import List  # Bổ sung thư viện List

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
@app.get("/", methods=["GET", "HEAD"])
def serve_web():
    return FileResponse("index.html")
SECRET_PASSWORD = os.getenv("SECRET_PASSWORD", "MatKhauCuaTam")
SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.appdata']

def get_credentials():
    creds = None
    env_token = os.getenv("DRIVE_TOKEN_JSON")
    
    if env_token:
        # Khi chạy trên Render (dùng biến môi trường)
        token_info = json.loads(env_token)
        creds = Credentials.from_authorized_user_info(token_info, SCOPES)
    elif os.path.exists('token.json'):
        # Khi chạy trên máy tính cá nhân
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
        
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            # Chỉ chạy phần này khi ở máy tính cá nhân và chưa có token.json
            if os.path.exists('client_secret.json'):
                flow = InstalledAppFlow.from_client_secrets_file('client_secret.json', SCOPES)
                creds = flow.run_local_server(port=8080)
            else:
                raise HTTPException(status_code=500, detail="Thiếu thông tin xác thực Google Drive Token!")
                
        if not env_token and not os.path.exists('token.json'):
            with open('token.json', 'w') as f:
                f.write(creds.to_json())
                
    return creds

# Đã nâng cấp để nhận nhiều file cùng lúc (List[UploadFile])
@app.post("/upload/")
async def upload_multiple_files(
    files: List[UploadFile] = File(...), 
    album: str = Form("Khác"), 
    password: str = Depends(verify_password)
):
    creds = get_credentials()
    drive_service = build('drive', 'v3', credentials=creds)
    
    for file in files:
        file_content = await file.read()
        media = MediaIoBaseUpload(io.BytesIO(file_content), mimetype=file.content_type, resumable=True)
        
        file_metadata = {
            'name': file.filename,
            'parents': ['appDataFolder'],
            'appProperties': {'album': album}
        }
        
        # Tải lên từng file một vào cùng album
        drive_service.files().create(body=file_metadata, media_body=media, fields='id').execute()
        
    return {"message": f"Đã tải lên thành công {len(files)} file"}

@app.get("/files/")
def list_files(password: str = Depends(verify_password)):
    creds = get_credentials()
    drive_service = build('drive', 'v3', credentials=creds)
    
    results = drive_service.files().list(
        q="'appDataFolder' in parents and trashed=false",
        spaces="appDataFolder",
        fields="files(id, name, mimeType, appProperties)",
        pageSize=1000
    ).execute()
    
    return {"files": results.get('files', [])}

@app.get("/stream/{file_id}")
def stream_media(file_id: str, password: str = Depends(verify_password)):
    creds = get_credentials()
    drive_service = build('drive', 'v3', credentials=creds)
    
    file_info = drive_service.files().get(fileId=file_id, fields="mimeType").execute()
    mime_type = file_info.get("mimeType", "application/octet-stream")
    
    url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
    headers = {"Authorization": f"Bearer {creds.token}"}
    
    def iterfile():
        with requests.get(url, headers=headers, stream=True) as r:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    yield chunk
                    
    return StreamingResponse(iterfile(), media_type=mime_type)

@app.delete("/delete/{file_id}")
def delete_file(file_id: str, password: str = Depends(verify_password)):
    creds = get_credentials()
    drive_service = build('drive', 'v3', credentials=creds)
    try:
        drive_service.files().delete(fileId=file_id).execute()
        return {"message": "Đã xóa vĩnh viễn"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))