# Docker Manager

A dead-simple web panel to let users start, stop, and restart Docker containers. Primarily designed for game server management, but works with any Docker container.

No complex setup, no Docker-in-Docker — just connects to your existing Docker socket.

## Features

- 🔐 **Simple login** — default admin/admin, change on first login
- 👥 **Admin panel** — create users, assign containers, set passwords
- 🎮 **Per-user servers** — each user only sees their assigned containers
- 🔍 **Container discovery** — auto-discover with keyword filter
- ▶️ **Start / Stop / Restart** — big obvious buttons
- 📊 **Live status** — auto-refreshes every 5 seconds
- 📱 **Mobile-friendly** — works great on phones
- 🐳 **Direct Docker API** — no Docker-in-Docker nonsense
- ⚙️ **Auto-config** — creates config on first boot

## Quick Start

### Docker Compose (Recommended)

```yaml
version: '3.8'
services:
  game-server-panel:
    image: ghcr.io/tehrobot-assistant/game-server-panel:latest
    container_name: game-server-panel
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
  --name game-server-panel \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v $(pwd)/config:/config \
  -e ADMIN_PASSWORD=changeme \
  ghcr.io/tehrobot-assistant/game-server-panel:latest
```

### Run Locally

```bash
git clone https://github.com/TehRobot-Assistant/game-server-panel.git
cd game-server-panel
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

The admin panel lets you:

- **Create users** — username, password, admin flag
- **Assign containers** — filter by keyword, click to select
- **Edit users** — change password, update container access
- **Delete users** — remove non-admin users

### Container Assignment

1. Open user edit modal
2. Type keywords in the filter box (e.g., "minecraft, valheim")
3. Click **Filter** to show matching containers
4. Click container chips to select/deselect
5. Save

## Unraid Installation

*Compatible with Unraid 6.10.0-rc1 and newer.*

### Option A: Community Applications

1. Download the [template XML](https://raw.githubusercontent.com/TehRobot-Assistant/game-server-panel/main/unraid-template/game-server-panel.xml)
2. Save to: `/boot/config/plugins/community.applications/private/game-server-panel/game-server-panel.xml`
3. Go to **Apps** → **Private** category
4. Click **Install**

### Option B: Docker Tab

1. Download the [template XML](https://raw.githubusercontent.com/TehRobot-Assistant/game-server-panel/main/unraid-template/game-server-panel.xml)
2. Save to: `/boot/config/plugins/dockerMan/templates-user/game-server-panel.xml`
3. Go to **Docker** → **Add Container**
4. Select template from dropdown

### Option C: Manual

1. **Docker** → **Add Container**
2. Repository: `ghcr.io/tehrobot-assistant/game-server-panel:latest`
3. Port: `3000`
4. Path: `/config` → `/mnt/user/appdata/game-server-panel`
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
  "sessionSecret": "auto-generated-random-string",
  "users": {
    "admin": {
      "password": "$2a$10$...",
      "isAdmin": true,
      "containers": []
    }
  }
}
```

You can edit this directly, but the admin panel is easier.

## Security Notes

- Always change the default password on first login
- Use HTTPS in production (put behind a reverse proxy)
- Docker socket access = full Docker control — only expose on trusted networks
- Mount Docker socket read-only (`:ro`) for extra safety

## License

MIT
