# Changelog

## [1.6.0] - 2026-11-08

### Security
- **Login throttling**: 10 failed logins per username or 30 per IP in 15 minutes return 429, checked before any password hashing. Uses Cloudflare's client IP only when the request came via a trusted proxy.
- **Crash fix**: a login as `constructor`/`__proto__` (or a non-string password) threw an unhandled rejection and stopped the server. Names are now looked up with `Object.hasOwn`, inputs are type-checked, and async errors return a 500.
- **CSRF**: cross-site POST/PUT/DELETE to `/api` is refused (Sec-Fetch-Site, then Origin). Form-encoded bodies are no longer accepted.
- **Session cookie**: `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS (trusted proxy aware). New session id on login.
- **Password changes and user deletes end that user's existing sessions.**
- **No default `admin` password**: if `ADMIN_PASSWORD` is unset, first run generates a random one and logs it once.
- New users and groups: names limited to letters, numbers and `. _ -`; passwords at least 8 characters; `isAdmin` must be a real boolean.
- `X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy` headers; `X-Powered-By` removed.

## [1.5.1] - 2026-03-23

### Changed
- **Light mode default** — proper light theme with dark toggle
- **Pill toggle switch** — sun/moon toggle fixed to top-right, visible on all pages including login
- Removed DockerHub from CI workflow (GHCR only)

## [1.5.0] - 2026-03-23

### Changed
- **Visual refresh** — neutral zinc tones instead of blue-grey
- Subtle card borders throughout
- Flatter button styles (no bounce effect)
- Cleaner tab styling with inverted active state
- Less saturated accent color

## [1.4.0] - 2026-02-22

### Added
- **Container logs** — view logs from any container with a single click
- **Tail selection** — choose 50, 100, 200, 500, or 1000 lines
- **Auto-refresh** — optional 3-second auto-refresh for live monitoring

## [1.3.0] - 2026-02-08

### Added
- **Container filters** — filter by Online, Stopped, or by Group
- **Alphabetical sorting** — container list now sorted A-Z

## [1.2.0] - 2026-02-08

### Added
- **Admin message** — broadcast a message to all users, displayed at top of page
- **Custom icon** — replaced whale emoji with custom icon centered above title

### Changed
- Admin tab now has Settings section for admin message

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
