# Deploy to Azure VM

This project runs as Docker Compose microservices on a single Azure VM.

## 1) Prepare the VM

Install Docker + Compose plugin, then create the app directory:

```bash
sudo mkdir -p /opt/codegraph-navigator
sudo chown -R $USER:$USER /opt/codegraph-navigator
```

Open inbound ports in Azure NSG:
- `3000` (frontend)
- `8000` (api_gateway)
- `7474` (neo4j browser, optional)
- `7687` (neo4j bolt, optional)

## 2) Configure GitHub Secrets

In your GitHub repo settings, add:

- `AZURE_VM_HOST` (public IP or DNS)
- `AZURE_VM_USER` (SSH user)
- `AZURE_VM_SSH_KEY` (private key content)
- `AZURE_APP_ENV` (full `.env` file content)

Use `.env.example` as a template.

## 3) Deploy

Run the workflow:
- `.github/workflows/deploy-azure-vm.yml`
- Trigger manually via **Actions -> Deploy Azure VM -> Run workflow**

The workflow syncs code to `/opt/codegraph-navigator` and runs:

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build --remove-orphans
```

## 4) Verify

```bash
curl http://<VM_PUBLIC_IP>:8000/health
curl http://<VM_PUBLIC_IP>:3000
```

Zip ingestion endpoint:

```bash
curl -X POST http://<VM_PUBLIC_IP>:8000/ingest/zip -F "file=@repo.zip"
```
