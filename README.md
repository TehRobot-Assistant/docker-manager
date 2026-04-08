# Docker Manager

<p align="center">
  <img src="icon.png" alt="Docker Manager" width="200">
</p>

<p align="center">
  A simple, secure web panel to start, stop, and restart Docker containers remotely.
</p>

---

## Features

- Secure login with bcrypt passwords and session auth
- Per-user container assignments — users only see what you allow
- Container groups for quick multi-user assignment
- Admin panel for user and group management
- Live container logs viewer
- Auto-discovers all Docker containers
- Auto-refreshing status
- Mobile-friendly dark UI

## Installation

### Unraid (Recommended)

1. Go to **Apps** tab and search **TehRobot**
2. Click the **Docker Hub** button
3. Find **docker-manager** and click **Install**
4. Set your port, appdata path, and admin password
5. Click **Apply**

### Docker Compose

```yaml
services:
  docker-manager:
    image: tehrobot/docker-manager:latest
    container_name: docker-manager
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./config:/config
    environment:
      - PORT=3000
      - ADMIN_PASSWORD=changeme
      - CONFIG_PATH=/config
    restart: unless-stopped
```

### Docker Run

```bash
docker run -d \
  --name docker-manager \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v $(pwd)/config:/config \
  -e ADMIN_PASSWORD=changeme \
  tehrobot/docker-manager:latest
```

## First Run

1. Open the web UI
2. Login with `admin` / `admin` (or your `ADMIN_PASSWORD`)
3. **Change your password** — a warning banner will remind you
4. Go to **Admin** tab to create users and assign containers

## User Management

Create users with specific container access:

1. Click **+ Add** in Users section
2. Set username and password
3. Assign containers using the checkbox list
4. Optionally grant admin privileges

## Container Groups

Bundle containers for quick assignment:

1. Click **+ Add** in Groups section
2. Name the group (e.g., "Game Servers", "Media Apps")
3. Select containers to include
4. When editing users, click the group chip to add all containers at once

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Web server port |
| `ADMIN_PASSWORD` | `admin` | Initial admin password (first run only) |
| `CONFIG_PATH` | `/config` | Config directory path |
| `DOCKER_HOST` | `/var/run/docker.sock` | Docker socket or `host:port` |

## Security Notes

- Always change the default password on first login
- Use HTTPS in production (put behind a reverse proxy)
- Mount Docker socket read-only (`:ro`)
- Users can only control their assigned containers

## Links

- [Docker Hub](https://hub.docker.com/r/tehrobot/docker-manager)
- [GitHub](https://github.com/TehRobot-Assistant/docker-manager)

## License

MIT
