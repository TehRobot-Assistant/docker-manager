# Docker Manager

Manage Docker containers remotely. Secure login, user permissions, and container groups.

**Let your mates restart game servers without giving them full Docker access.**

## Quick Start

```yaml
version: '3.8'
services:
  docker-manager:
    image: tehrobotassistant/docker-manager:latest
    container_name: docker-manager
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./config:/config
    environment:
      - ADMIN_PASSWORD=changeme
    restart: unless-stopped
```

```bash
docker-compose up -d
```

**Login:** `admin` / `changeme` → change password on first login!

## Features

- 🔐 Secure login with user management
- 📁 Container groups for quick assignment  
- 👥 Per-user container access
- 📱 Mobile-friendly UI

## Links

- [GitHub](https://github.com/TehRobot-Assistant/docker-manager)
- [Full Documentation](https://github.com/TehRobot-Assistant/docker-manager#readme)
- [Unraid Template](https://github.com/TehRobot-Assistant/docker-manager/blob/master/unraid-template/docker-manager.xml)
