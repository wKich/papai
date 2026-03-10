#!/bin/bash
# Plane Self-Hosted Setup Script
# https://developers.plane.so/self-hosting/methods/docker-compose

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Functions
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        echo "Visit: https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    print_success "Prerequisites check passed"
}

# Generate random secret key
generate_secret_key() {
    openssl rand -base64 50 | tr -d '\n'
}

# Interactive configuration
configure_environment() {
    print_status "Configuring Plane..."
    
    if [ ! -f .env ]; then
        print_error ".env file not found. Please ensure you're in the correct directory."
        exit 1
    fi
    
    # Backup existing .env
    if [ -f .env.backup ]; then
        cp .env .env.backup.$(date +%Y%m%d%H%M%S)
    else
        cp .env .env.backup
    fi
    
    print_status "Please provide the following configuration values:"
    
    # Web URL
    read -rp "Enter your domain or IP address (e.g., plane.example.com or 192.168.1.100): " web_url
    if [ -z "$web_url" ]; then
        web_url="localhost"
    fi
    
    # Determine protocol
    if [[ "$web_url" =~ ^https?:// ]]; then
        WEB_URL="$web_url"
    else
        WEB_URL="http://$web_url"
    fi
    
    # Update .env file
    sed -i.bak "s|^WEB_URL=.*|WEB_URL=$WEB_URL|" .env
    sed -i.bak "s|^CORS_ALLOWED_ORIGINS=.*|CORS_ALLOWED_ORIGINS=$WEB_URL|" .env
    rm -f .env.bak
    
    # Generate secret key
    SECRET_KEY=$(generate_secret_key)
    sed -i.bak "s|^SECRET_KEY=.*|SECRET_KEY=$SECRET_KEY|" .env
    rm -f .env.bak
    
    # Ports
    read -rp "HTTP Port [80]: " http_port
    http_port=${http_port:-80}
    sed -i.bak "s|^NGINX_HTTP_PORT=.*|NGINX_HTTP_PORT=$http_port|" .env
    rm -f .env.bak
    
    read -rp "HTTPS Port [443]: " https_port
    https_port=${https_port:-443}
    sed -i.bak "s|^NGINX_HTTPS_PORT=.*|NGINX_HTTPS_PORT=$https_port|" .env
    rm -f .env.bak
    
    # Default credentials
    read -rp "Default admin email [captain@plane.so]: " default_email
    default_email=${default_email:-captain@plane.so}
    sed -i.bak "s|^DEFAULT_EMAIL=.*|DEFAULT_EMAIL=$default_email|" .env
    rm -f .env.bak
    
    read -rp "Default admin password [captain@plane.so]: " default_password
    default_password=${default_password:-captain@plane.so}
    sed -i.bak "s|^DEFAULT_PASSWORD=.*|DEFAULT_PASSWORD=$default_password|" .env
    rm -f .env.bak
    
    print_success "Configuration saved to .env"
    echo ""
    print_warning "IMPORTANT: Your default login credentials are:"
    echo "  Email: $default_email"
    echo "  Password: $default_password"
    echo ""
    echo "Please change these after first login."
}

# Start services
start_services() {
    print_status "Starting Plane services..."
    
    # Pull latest images
    docker-compose pull
    
    # Start services
    docker-compose up -d
    
    # Wait for services to be healthy
    print_status "Waiting for services to start..."
    sleep 10
    
    # Check service status
    print_status "Checking service status..."
    docker-compose ps
    
    print_success "Plane has been started successfully!"
    
    # Get Web URL from env
    WEB_URL=$(grep "^WEB_URL=" .env | cut -d'=' -f2)
    HTTP_PORT=$(grep "^NGINX_HTTP_PORT=" .env | cut -d'=' -f2)
    
    echo ""
    print_status "Access Plane at: ${WEB_URL}:${HTTP_PORT}"
    echo "  - Web App: ${WEB_URL}:${HTTP_PORT}"
    echo "  - API: ${WEB_URL}:${HTTP_PORT}/api"
    echo ""
    print_status "To view logs: docker-compose logs -f"
    print_status "To stop: docker-compose down"
}

# Stop services
stop_services() {
    print_status "Stopping Plane services..."
    docker-compose down
    print_success "Services stopped"
}

# Restart services
restart_services() {
    print_status "Restarting Plane services..."
    docker-compose restart
    print_success "Services restarted"
}

# View logs
view_logs() {
    docker-compose logs -f --tail=100
}

# Update to latest version
update_services() {
    print_status "Updating Plane to the latest version..."
    
    # Pull latest images
    docker-compose pull
    
    # Recreate containers with new images
    docker-compose up -d --force-recreate
    
    print_success "Plane has been updated"
}

# Backup data
backup_data() {
    local backup_dir="backups/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"
    
    print_status "Backing up data to $backup_dir..."
    
    # Backup PostgreSQL
    docker-compose exec -T postgres pg_dump -U plane plane > "$backup_dir/database.sql"
    
    # Backup volumes
    docker run --rm -v plane_postgres-data:/data -v "$(pwd)/$backup_dir":/backup alpine tar czf /backup/postgres-data.tar.gz -C /data .
    docker run --rm -v plane_redis-data:/data -v "$(pwd)/$backup_dir":/backup alpine tar czf /backup/redis-data.tar.gz -C /data .
    docker run --rm -v plane_minio-data:/data -v "$(pwd)/$backup_dir":/backup alpine tar czf /backup/minio-data.tar.gz -C /data .
    
    # Backup configuration
    cp .env "$backup_dir/"
    cp docker-compose.yml "$backup_dir/"
    
    print_success "Backup completed: $backup_dir"
}

# Main menu
show_menu() {
    echo ""
    echo "========================================"
    echo "   Plane Self-Hosted Setup Script"
    echo "========================================"
    echo ""
    echo "Select an action:"
    echo "  1) Configure and Start (First time setup)"
    echo "  2) Start Services"
    echo "  3) Stop Services"
    echo "  4) Restart Services"
    echo "  5) View Logs"
    echo "  6) Update to Latest Version"
    echo "  7) Backup Data"
    echo "  8) Exit"
    echo ""
}

# Main execution
main() {
    check_prerequisites
    
    while true; do
        show_menu
        read -rp "Action [1]: " choice
        choice=${choice:-1}
        
        case $choice in
            1)
                configure_environment
                start_services
                ;;
            2)
                start_services
                ;;
            3)
                stop_services
                ;;
            4)
                restart_services
                ;;
            5)
                view_logs
                ;;
            6)
                update_services
                ;;
            7)
                backup_data
                ;;
            8)
                print_status "Exiting..."
                exit 0
                ;;
            *)
                print_error "Invalid option. Please try again."
                ;;
        esac
    done
}

# Run main function
main
