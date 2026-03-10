# Plane Self-Hosted Setup

Complete Docker Compose configuration for self-hosting [Plane](https://plane.so) - an open-source project management tool.

**Official Documentation:** https://developers.plane.so/self-hosting/overview

## Quick Start

### Option 1: Automated Setup (Recommended)

```bash
# Make the setup script executable and run it
chmod +x setup.sh
./setup.sh
```

Follow the interactive prompts to configure and start Plane.

### Option 2: Manual Setup

```bash
# 1. Configure environment
# Edit .env file with your settings:
# - WEB_URL: Your domain or IP address
# - SECRET_KEY: Generate with: openssl rand -base64 50

# 2. Start services
docker-compose up -d

# 3. Access Plane at http://localhost (or your configured domain)
```

## System Requirements

| Resource | Minimum | Recommended |
|----------|-----------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB SSD | 50 GB SSD |
| OS | Ubuntu 20.04+, Debian 11+, CentOS 8+, macOS, Windows WSL2 |

## Services Overview

| Service | Image | Purpose | Port (Internal) |
|---------|-------|---------|-----------------|
| `web` | makeplane/plane-frontend | React frontend | 3000 |
| `space` | makeplane/plane-space | Workspace app | 3000 |
| `api` | makeplane/plane-backend | Django REST API | 8000 |
| `worker` | makeplane/plane-worker | Background tasks | - |
| `beat-worker` | makeplane/plane-worker | Scheduled tasks | - |
| `postgres` | postgres:15-alpine | PostgreSQL database | 5432 |
| `redis` | redis:7-alpine | Redis cache | 6379 |
| `minio` | minio/minio | Object storage | 9000 |
| `proxy` | nginx:alpine | Reverse proxy | 80, 443 |

## Configuration

### Essential Environment Variables

Edit `.env` before starting:

```bash
# Required
WEB_URL=https://plane.example.com          # Your domain
CORS_ALLOWED_ORIGINS=https://plane.example.com
SECRET_KEY=your-50-character-random-key   # Generate: openssl rand -base64 50

# Default Admin
DEFAULT_EMAIL=admin@yourdomain.com
DEFAULT_PASSWORD=your-secure-password

# Ports (change if 80/443 are in use)
NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443
```

### Optional Features

#### Email (SMTP) Configuration

Uncomment and configure in `.env`:

```bash
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-app-password
EMAIL_USE_TLS=1
EMAIL_FROM=Plane <no-reply@yourdomain.com>
```

#### AI Integration (Optional)

```bash
OPENAI_API_KEY=sk-...
GPT_ENGINE=gpt-4
ANTHROPIC_API_KEY=sk-ant-...
```

#### External Database/Storage

For production, see [External Services](https://developers.plane.so/self-hosting/govern/database-and-storage):

```bash
# External PostgreSQL
DATABASE_URL=postgresql://user:pass@external-db:5432/plane

# External Redis
REDIS_URL=redis://external-redis:6379/0

# External S3
USE_MINIO=0
AWS_S3_REGION=us-east-1
AWS_S3_CUSTOM_ENDPOINT=https://s3.amazonaws.com
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET_NAME=plane-uploads
```

## Common Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart services
docker-compose restart

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f api

# Update to latest version
docker-compose pull
docker-compose up -d --force-recreate

# Check service status
docker-compose ps

# Execute commands in containers
docker-compose exec api python manage.py migrate
docker-compose exec postgres psql -U plane -d plane
```

## Backup & Restore

### Automated Backup

```bash
# Using the setup script
./setup.sh
# Select option 7) Backup Data
```

### Manual Backup

```bash
# Create backup directory
mkdir -p backups/$(date +%Y%m%d_%H%M%S)
cd backups/$(date +%Y%m%d_%H%M%S)

# Backup database
docker-compose exec -T postgres pg_dump -U plane plane > database.sql

# Backup volumes
docker run --rm -v plane_postgres-data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-data.tar.gz -C /data .
docker run --rm -v plane_redis-data:/data -v $(pwd):/backup alpine tar czf /backup/redis-data.tar.gz -C /data .
docker run --rm -v plane_minio-data:/data -v $(pwd):/backup alpine tar czf /backup/minio-data.tar.gz -C /data .

# Backup config
cp ../../.env .
cp ../../docker-compose.yml .
```

### Restore from Backup

```bash
# Stop services
docker-compose down

# Restore volumes (example for postgres)
docker run --rm -v plane_postgres-data:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/postgres-data.tar.gz"

# Restore database
docker-compose up -d postgres
docker-compose exec -T postgres psql -U plane plane < database.sql

# Start all services
docker-compose up -d
```

## Security Recommendations

1. **Change Default Passwords**: Immediately change the default admin credentials after first login
2. **HTTPS**: Use HTTPS in production (configure SSL certificates)
3. **Firewall**: Restrict access to ports 80/443 only
4. **Secret Key**: Generate a unique, random SECRET_KEY
5. **Backups**: Schedule regular backups
6. **Updates**: Keep Plane updated to the latest version

## Troubleshooting

### Services Won't Start

```bash
# Check logs
docker-compose logs

# Check disk space
df -h

# Check port availability
netstat -tlnp | grep -E '80|443'
```

### Database Connection Issues

```bash
# Check database status
docker-compose ps postgres
docker-compose logs postgres

# Verify database exists
docker-compose exec postgres psql -U plane -c "\l"
```

### Migrator Container Exited

```bash
# Check migrator logs
docker-compose logs migrator

# Manual migration
docker-compose run --rm api python manage.py migrate
```

### Access Issues

```bash
# Verify environment variables
docker-compose exec api env | grep WEB_URL

# Check network connectivity
docker-compose exec web ping api
```

## Upgrading

### From Community to Pro/Business

1. Purchase a license from [Plane](https://plane.so/pricing)
2. Follow [activation guide](https://developers.plane.so/self-hosting/manage/manage-licenses/activate-pro-and-business)

### Update Plane Version

```bash
# Pull latest images
docker-compose pull

# Recreate containers
docker-compose up -d --force-recreate
```

## Documentation

- [Official Documentation](https://developers.plane.so/self-hosting/overview)
- [Docker Compose Method](https://developers.plane.so/self-hosting/methods/docker-compose)
- [Configuration Guide](https://developers.plane.so/self-hosting/govern/environment-variables)
- [Authentication Setup](https://developers.plane.so/self-hosting/govern/authentication)

## Support

- [GitHub Issues](https://github.com/makeplane/plane/issues)
- [Discord Community](https://discord.com/invite/A92xrEGCge)
- [Documentation](https://developers.plane.so)

## License

This Docker Compose configuration is provided as-is for self-hosting Plane. Plane itself is licensed under the [AGPL-3.0](https://github.com/makeplane/plane/blob/master/LICENSE).
