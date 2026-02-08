# Changelog

## [1.1.0] - 2026-02-08

### Added
- **Admin panel** — create, edit, delete users from the web UI
- **Container assignment** — auto-discover containers with keyword filter
- **Auto-config** — creates config.json on first boot
- **Auto-generated session secret** — no manual config needed
- **ADMIN_PASSWORD env var** — set initial admin password
- **Default admin/admin login** — works out of the box
- **Password warning banner** — reminds to change default password
- **Change password modal** — quick password change from dashboard

### Changed
- Config directory structure (now `/config/config.json`)
- Admins can see and control all containers
- Improved mobile UI

### Fixed
- Users without containers now see "no servers" message

## [1.0.0] - 2026-02-08

### Added
- Initial release
- Login page with session-based authentication
- Per-user container assignments
- Start/Stop/Restart buttons
- Live status updates (5 second refresh)
- Mobile-friendly responsive UI
- Docker socket API integration
- Docker image with GitHub Actions auto-build
- Unraid template
