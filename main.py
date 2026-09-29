def get_credentials():
    try:
        creds = None
        env_token = os.getenv("DRIVE_TOKEN_JSON")
        
        if env_token:
            # Tự động dọn dẹp khoảng trắng hoặc dấu nháy thừa nếu lỡ copy dán lỗi
            clean_token = env_token.strip()
            if clean_token.startswith('"') and clean_token.endswith('"'):
                clean_token = clean_token[1:-1]
            token_info = json.loads(clean_token)
            creds = Credentials.from_authorized_user_info(token_info, SCOPES)
        elif os.path.exists('token.json'):
            creds = Credentials.from_authorized_user_file('token.json', SCOPES)
            
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if os.path.exists('client_secret.json'):
                    flow = InstalledAppFlow.from_client_secrets_file('client_secret.json', SCOPES)
                    creds = flow.run_local_server(port=8080)
                    
            if not env_token and not os.path.exists('token.json') and creds:
                with open('token.json', 'w') as f:
                    f.write(creds.to_json())
        return creds
    except Exception as e:
        print("CRITICAL ERROR in get_credentials:")
        traceback.print_exc()
        raise e