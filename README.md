# Docker Manager

A simple, secure web panel to let users start, stop, and restart Docker containers remotely.

**Why?** Let your mates restart game servers without giving them full Docker access. Create users, assign specific containers, and group them for easy management. Your database containers stay safe.

## Features

- 🔐 **Secure login** — bcrypt passwords, session auth, change default on first run
- 👥 **User management** — create users, assign only the containers they need
- 📁 **Container groups** — bundle containers (e.g., "Game Servers") for one-click assignment
- 🎮 **Per-user access** — users only see their assigned containers
- ▶️ **Start / Stop / Restart** — clean UI with obvious buttons
- 📊 **Live status** — auto-refreshes every 5 seconds
- 📱 **Mobile-friendly** — works great on phones
- 🐳 **Direct Docker API** — no Docker-in-Docker nonsense
- ⚙️ **Auto-config** — creates config on first boot

## Quick Start

### Docker Compose (Recommended)

```yaml
version: '3.8'
services:
  docker-manager:
    image: ghcr.io/tehrobot-assistant/docker-manager:latest
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
# Open http://localhost:3000
# Login: admin / changeme
```

### Docker Run

```bash
docker run -d \
  --name docker-manager \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v $(pwd)/config:/config \
  -e ADMIN_PASSWORD=changeme \
  ghcr.io/tehrobot-assistant/docker-manager:latest
```

### Run Locally

```bash
git clone https://github.com/TehRobot-Assistant/docker-manager.git
cd docker-manager
npm install
npm start
# Login: admin / admin
```

## First Run

1. Start the container
2. Open the web UI
3. Login with `admin` / `admin` (or your `ADMIN_PASSWORD`)
4. **Change your password** (warning banner will remind you)
5. Go to **Admin** tab to create users and assign containers

## Admin Panel

### Users

Create users with specific container access:

1. Click **+ Add** in Users section
2. Set username and password
3. Assign containers using the checkbox list
4. Optionally grant admin privileges

### Groups

Create container groups for quick assignment:

1. Click **+ Add** in Groups section  
2. Name the group (e.g., "Game Servers", "Media Apps")
3. Select containers to include
4. When editing users, click the group chip to add all containers at once

**Example:** Create a "Game Servers" group with Valheim, Minecraft, and Stationeers. When adding a new mate, one click assigns all three.

## Unraid Installation

*Compatible with Unraid 6.10.0-rc1 and newer.*

### Option A: Community Applications

1. Download the [template XML](https://raw.githubusercontent.com/TehRobot-Assistant/docker-manager/main/unraid-template/docker-manager.xml)
2. Save to: `/boot/config/plugins/community.applications/private/docker-manager.xml`
3. Go to **Apps** → search "docker-manager" in User Templates
4. Click **Install**

### Option B: Docker Tab

1. Go to **Docker** → **Add Container**
2. Repository: `ghcr.io/tehrobot-assistant/docker-manager:latest`
3. Port: `3000`
4. Path: `/config` → `/mnt/user/appdata/docker-manager`
5. Path: `/var/run/docker.sock` → `/var/run/docker.sock` (Read Only)
6. Variable: `ADMIN_PASSWORD` → your password

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Web server port |
| `ADMIN_PASSWORD` | `admin` | Initial admin password (first run only) |
| `CONFIG_PATH` | `/config` | Config directory path |
| `DOCKER_HOST` | `/var/run/docker.sock` | Docker socket or `host:port` |

## Config File

Config is auto-created at `/config/config.json` on first run:

```json
{
  "sessionSecret": "auto-generated",
  "groups": {
    "Game Servers": ["valheim", "minecraft", "stationeers"]
  },
  "users": {
    "admin": {
      "password": "$2a$10$...",
      "isAdmin": true,
      "containers": []
    }
  }
}
```

## Security Notes

- Always change the default password on first login
- Use HTTPS in production (put behind a reverse proxy)
- Docker socket access = full Docker control — only expose on trusted networks
- Mount Docker socket read-only (`:ro`) for extra safety
- Users can only control their assigned containers

## License

MIT
