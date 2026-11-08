import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import Docker from 'dockerode';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_DIR = process.env.CONFIG_PATH || join(__dirname, 'config');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
// No hard-coded default any more: this app holds the Docker socket, so a public
// instance left on admin/admin is a full host takeover. If ADMIN_PASSWORD isn't
// set, first run generates a random one and prints it to the container log once.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
const ADMIN_PASSWORD_GENERATED = !process.env.ADMIN_PASSWORD;

// Login throttling. Per-account AND per-IP, because behind Cloudflare many users
// can share an edge IP and an attacker can rotate IPs. Trade-off: anyone who
// knows a username can keep it locked by failing on purpose; the lock clears
// itself after the window.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_USER = Number(process.env.MAX_FAILS_PER_USER) || 10;
const MAX_FAILS_PER_IP = Number(process.env.MAX_FAILS_PER_IP) || 30;
const loginFails = new Map(); // key -> { count, first }

function failCount(key) {
  const e = loginFails.get(key);
  if (!e) return 0;
  if (Date.now() - e.first > LOGIN_WINDOW_MS) { loginFails.delete(key); return 0; }
  return e.count;
}
function recordFail(key) {
  const e = loginFails.get(key);
  if (!e || Date.now() - e.first > LOGIN_WINDOW_MS) loginFails.set(key, { count: 1, first: Date.now() });
  else e.count++;
}
// Keep the map from growing without bound under a spray of random usernames.
setInterval(() => { for (const k of loginFails.keys()) failCount(k); }, 60 * 1000).unref();

// Usernames become keys of config.users, so refuse anything that could reach
// Object.prototype ("__proto__", "constructor") or look like a path.
const USERNAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
// The regex alone still allows "__proto__" / "constructor" (underscores and
// letters are legal), so also refuse any name Object.prototype already has.
const validName = (n) => typeof n === 'string' && USERNAME_RE.test(n) && !(n in Object.prototype);
const hasUser = (name) => typeof name === 'string' && Object.hasOwn(config.users, name);
const hasGroup = (name) => typeof name === 'string' && Object.hasOwn(config.groups, name);
const isNameList = (a) => Array.isArray(a) && a.every(x => typeof x === 'string' && x.length <= 255);
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

// Express 4 doesn't catch rejected promises from async handlers; an uncaught
// rejection kills the process (the whole panel goes down). Route every async
// handler through this so errors become a 500 instead.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

// Docker connection
const dockerSocket = process.env.DOCKER_HOST || '/var/run/docker.sock';
const docker = dockerSocket.startsWith('/')
  ? new Docker({ socketPath: dockerSocket })
  : new Docker({ host: dockerSocket.split(':')[0], port: dockerSocket.split(':')[1] || 2375 });

// Initialize config
async function initConfig() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  
  let config;
  
  if (existsSync(CONFIG_FILE)) {
    config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    // Ensure groups exists
    if (!config.groups) config.groups = {};
    console.log('📄 Loaded existing config');
  } else {
    const sessionSecret = crypto.randomBytes(32).toString('hex');
    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    
    config = {
      sessionSecret,
      groups: {},
      users: {
        admin: {
          password: adminHash,
          isAdmin: true,
          containers: []
        }
      }
    };
    
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('📄 Created new config with admin user');
    console.log(`   Login: admin / ${ADMIN_PASSWORD_GENERATED ? `${ADMIN_PASSWORD}  (generated, shown once; change it after logging in)` : '(from ADMIN_PASSWORD env)'}`);
  }
  
  return config;
}

function saveConfig(config) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

let config;

(async () => {
  config = await initConfig();
  
  // Behind NPM/Cloudflare: trust private-range proxies so req.secure / req.ip
  // reflect the real request (needed for the Secure cookie and IP throttling).
  // Override with TRUST_PROXY (any Express trust-proxy value, "false" to disable).
  const tp = process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal';
  app.set('trust proxy', tp === 'false' ? false : tp);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set('X-Frame-Options', 'DENY');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  // JSON only. The urlencoded parser is gone on purpose: it let a plain HTML
  // <form> on any website submit to these endpoints with the admin's cookie.
  app.use(express.json({ limit: '100kb' }));

  // CSRF: refuse state-changing API calls that a browser marks as cross-site.
  // Sec-Fetch-Site first (all current browsers), Origin vs Host as the fallback.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const sfs = req.get('sec-fetch-site');
    if (sfs) return (sfs === 'same-origin' || sfs === 'none') ? next() : res.status(403).json({ error: 'Cross-site request blocked' });
    const origin = req.get('origin');
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request blocked' }); }
      catch { return res.status(403).json({ error: 'Cross-site request blocked' }); }
    }
    next();
  });

  app.use(session({
    name: 'dm.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    // secure:'auto' = Secure flag whenever the request arrived over HTTPS (via the
    // trusted proxy's X-Forwarded-Proto), while plain-http LAN access still works.
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 24 * 60 * 60 * 1000 }
  }));
  app.use(express.static(join(__dirname, 'public')));

  // A session is only valid while its user exists and hasn't had their password
  // changed since that session logged in (so a reset kicks everyone out).
  function sessionUser(req) {
    const name = req.session.user;
    if (!hasUser(name)) return null;
    const user = config.users[name];
    if (user.passwordChangedAt && (req.session.loginAt || 0) < user.passwordChangedAt) return null;
    return user;
  }

  function requireAuth(req, res, next) {
    if (sessionUser(req)) next();
    else res.status(401).json({ error: 'Unauthorized' });
  }

  function requireAdmin(req, res, next) {
    if (sessionUser(req)?.isAdmin) next();
    else res.status(403).json({ error: 'Admin access required' });
  }

  function getUserContainers(username) {
    if (!hasUser(username)) return [];
    const user = config.users[username];
    if (user.isAdmin) return '__all__';
    return user.containers || [];
  }

  // Client IP for throttling. Cloudflare's header is used only when the request
  // came through a trusted (private-range) proxy, so it can't be spoofed by a
  // client talking to the app directly.
  function clientIp(req) {
    const cf = req.get('cf-connecting-ip');
    return (cf && req.ip !== req.socket.remoteAddress) ? cf : req.ip;
  }

  async function isDefaultPassword() {
    const adminUser = config.users.admin;
    if (!adminUser) return false;
    return await bcrypt.compare('admin', adminUser.password);
  }

  // ==================== AUTH API ====================

  app.post('/api/login', wrap(async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 1024) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const ipKey = 'ip:' + clientIp(req);
    const userKey = 'user:' + username.toLowerCase();
    // Checked BEFORE bcrypt so a flood can't be used to burn CPU either.
    if (failCount(ipKey) >= MAX_FAILS_PER_IP || failCount(userKey) >= MAX_FAILS_PER_USER) {
      res.set('Retry-After', String(LOGIN_WINDOW_MS / 1000));
      return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    }

    const user = hasUser(username) ? config.users[username] : null;
    // Compare against a dummy hash for unknown users so response time doesn't
    // reveal which usernames exist.
    const valid = await bcrypt.compare(password, user?.password || DUMMY_HASH);
    if (!user || !valid) {
      recordFail(ipKey); recordFail(userKey);
      console.warn(`Failed login for "${username.slice(0, 64)}" from ${clientIp(req)}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    loginFails.delete(userKey);
    // New session id on login (no session fixation).
    await new Promise((ok, fail) => req.session.regenerate(e => e ? fail(e) : ok()));
    req.session.user = username;
    req.session.loginAt = Date.now();
    const usingDefault = username === 'admin' && await isDefaultPassword();

    res.json({ success: true, username, isAdmin: user.isAdmin || false, defaultPassword: usingDefault });
  }));

  app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
  });

  app.get('/api/me', wrap(async (req, res) => {
    const user = sessionUser(req);
    if (user) {
      const usingDefault = req.session.user === 'admin' && await isDefaultPassword();
      res.json({ username: req.session.user, isAdmin: user.isAdmin || false, defaultPassword: usingDefault });
    } else {
      res.status(401).json({ error: 'Not logged in' });
    }
  }));

  // ==================== CONTAINERS API ====================

  app.get('/api/containers', requireAuth, async (req, res) => {
    try {
      const allowedContainers = getUserContainers(req.session.user);
      const containers = await docker.listContainers({ all: true });
      
      const result = containers
        .filter(c => {
          if (allowedContainers === '__all__') return true;
          const name = c.Names[0]?.replace(/^\//, '') || '';
          return allowedContainers.includes(name);
        })
        .map(c => ({
          id: c.Id.substring(0, 12),
          name: c.Names[0]?.replace(/^\//, '') || 'unknown',
          status: c.State,
          statusText: c.Status,
          image: c.Image
        }));
      
      if (allowedContainers !== '__all__') {
        for (const containerName of allowedContainers) {
          if (!result.find(s => s.name === containerName)) {
            result.push({ id: null, name: containerName, status: 'not_found', statusText: 'Container not found', image: null });
          }
        }
      }
      
      res.json(result);
    } catch (err) {
      console.error('Error listing containers:', err);
      res.status(500).json({ error: 'Failed to list containers' });
    }
  });

  // Legacy endpoint for compatibility
  app.get('/api/servers', requireAuth, async (req, res) => {
    return res.redirect('/api/containers');
  });

  app.post('/api/containers/:name/:action', requireAuth, async (req, res) => {
    const { name, action } = req.params;
    const allowedContainers = getUserContainers(req.session.user);
    
    if (allowedContainers !== '__all__' && !allowedContainers.includes(name)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!['start', 'stop', 'restart'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    
    try {
      const containers = await docker.listContainers({ all: true });
      const containerInfo = containers.find(c => c.Names[0]?.replace(/^\//, '') === name);
      
      if (!containerInfo) return res.status(404).json({ error: 'Container not found' });
      
      const container = docker.getContainer(containerInfo.Id);
      
      if (action === 'start') await container.start();
      else if (action === 'stop') await container.stop();
      else if (action === 'restart') await container.restart();
      
      res.json({ success: true, action, container: name });
    } catch (err) {
      console.error(`Error ${action} container ${name}:`, err);
      res.status(500).json({ error: `Failed to ${action}: ${err.message}` });
    }
  });

  // Legacy endpoint
  app.post('/api/servers/:name/:action', requireAuth, (req, res) => {
    req.url = req.url.replace('/servers/', '/containers/');
    return app._router.handle(req, res);
  });

  // ==================== LOGS API ====================

  app.get('/api/containers/:name/logs', requireAuth, async (req, res) => {
    const { name } = req.params;
    const { tail = 100, timestamps = 'true' } = req.query;
    const allowedContainers = getUserContainers(req.session.user);
    
    if (allowedContainers !== '__all__' && !allowedContainers.includes(name)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    try {
      const containers = await docker.listContainers({ all: true });
      const containerInfo = containers.find(c => c.Names[0]?.replace(/^\//, '') === name);
      
      if (!containerInfo) return res.status(404).json({ error: 'Container not found' });
      
      const container = docker.getContainer(containerInfo.Id);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: parseInt(tail) || 100,
        timestamps: timestamps === 'true'
      });
      
      // Docker logs come with stream headers (8 bytes per line), strip them
      const cleanLogs = logs.toString('utf8')
        .split('\n')
        .map(line => {
          // Remove docker stream header (first 8 bytes if present)
          if (line.length > 8) {
            const headerByte = line.charCodeAt(0);
            if (headerByte === 1 || headerByte === 2) {
              return line.substring(8);
            }
          }
          return line;
        })
        .join('\n');
      
      res.json({ logs: cleanLogs, container: name });
    } catch (err) {
      console.error(`Error getting logs for ${name}:`, err);
      res.status(500).json({ error: `Failed to get logs: ${err.message}` });
    }
  });

  // ==================== SETTINGS API ====================

  app.get('/api/settings', (req, res) => {
    res.json({ adminMessage: config.adminMessage || '' });
  });

  app.put('/api/admin/settings', requireAdmin, (req, res) => {
    const { adminMessage } = req.body;
    if (typeof adminMessage === 'string') {
      config.adminMessage = adminMessage;
      saveConfig(config);
    }
    res.json({ success: true });
  });

  // ==================== GROUPS API (all users) ====================

  app.get('/api/groups', requireAuth, (req, res) => {
    const groups = Object.entries(config.groups || {}).map(([name, containers]) => ({
      name,
      containers: containers || []
    }));
    res.json(groups);
  });

  // ==================== ADMIN API ====================

  app.get('/api/admin/containers', requireAdmin, async (req, res) => {
    try {
      const { filter } = req.query;
      const containers = await docker.listContainers({ all: true });
      
      let result = containers.map(c => ({
        id: c.Id.substring(0, 12),
        name: c.Names[0]?.replace(/^\//, '') || 'unknown',
        status: c.State,
        image: c.Image
      })).sort((a, b) => a.name.localeCompare(b.name));
      
      if (filter) {
        const keywords = filter.toLowerCase().split(',').map(k => k.trim()).filter(k => k);
        result = result.filter(c => keywords.some(k => c.name.toLowerCase().includes(k)));
      }
      
      res.json(result);
    } catch (err) {
      console.error('Error listing containers:', err);
      res.status(500).json({ error: 'Failed to list containers' });
    }
  });

  // ==================== GROUPS API ====================

  app.get('/api/admin/groups', requireAdmin, (req, res) => {
    const groups = Object.entries(config.groups || {}).map(([name, containers]) => ({
      name,
      containers: containers || []
    }));
    res.json(groups);
  });

  // Group and user names are object keys in config.json: hasGroup/hasUser use
  // Object.hasOwn so names like "__proto__" or "constructor" can't reach
  // Object.prototype, and new names must match USERNAME_RE.
  app.post('/api/admin/groups', requireAdmin, (req, res) => {
    const { name, containers } = req.body || {};
    if (!validName(name)) {
      return res.status(400).json({ error: 'Group name required (letters, numbers, . _ - only)' });
    }
    if (containers !== undefined && !isNameList(containers)) {
      return res.status(400).json({ error: 'Containers must be a list of names' });
    }
    if (hasGroup(name)) return res.status(400).json({ error: 'Group already exists' });

    config.groups[name] = containers || [];
    saveConfig(config);
    res.json({ success: true, name });
  });

  app.put('/api/admin/groups/:name', requireAdmin, (req, res) => {
    const { name } = req.params;
    const { containers, newName } = req.body || {};
    if (!hasGroup(name)) return res.status(404).json({ error: 'Group not found' });
    if (containers !== undefined && !isNameList(containers)) {
      return res.status(400).json({ error: 'Containers must be a list of names' });
    }
    if (newName !== undefined && newName !== name) {
      if (!validName(newName)) return res.status(400).json({ error: 'Invalid group name' });
      if (hasGroup(newName)) return res.status(400).json({ error: 'Group already exists' });
    }

    if (containers) config.groups[name] = containers;
    if (newName && newName !== name) {
      config.groups[newName] = config.groups[name];
      delete config.groups[name];
    }
    saveConfig(config);
    res.json({ success: true });
  });

  app.delete('/api/admin/groups/:name', requireAdmin, (req, res) => {
    const { name } = req.params;
    if (!hasGroup(name)) return res.status(404).json({ error: 'Group not found' });
    delete config.groups[name];
    saveConfig(config);
    res.json({ success: true });
  });

  // ==================== USERS API ====================

  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const users = Object.entries(config.users).map(([username, data]) => ({
      username,
      isAdmin: data.isAdmin || false,
      containers: data.containers || []
    }));
    res.json(users);
  });

  const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 1024;

  app.post('/api/admin/users', requireAdmin, wrap(async (req, res) => {
    const { username, password, isAdmin, containers } = req.body || {};
    if (!validName(username)) {
      return res.status(400).json({ error: 'Username required (letters, numbers, . _ - only)' });
    }
    if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (containers !== undefined && !isNameList(containers)) {
      return res.status(400).json({ error: 'Containers must be a list of names' });
    }
    if (hasUser(username)) return res.status(400).json({ error: 'User already exists' });

    config.users[username] = {
      password: await bcrypt.hash(password, 10),
      isAdmin: isAdmin === true, // strictly boolean: "false" or "1" must not grant admin
      containers: containers || []
    };
    saveConfig(config);
    res.json({ success: true, username });
  }));

  app.put('/api/admin/users/:username', requireAdmin, wrap(async (req, res) => {
    const { username } = req.params;
    const { password, isAdmin, containers } = req.body || {};
    if (!hasUser(username)) return res.status(404).json({ error: 'User not found' });
    if (password !== undefined && password !== '' && !validPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (containers !== undefined && !isNameList(containers)) {
      return res.status(400).json({ error: 'Containers must be a list of names' });
    }
    if (username === 'admin' && isAdmin === false) {
      const otherAdmins = Object.entries(config.users).filter(([u, d]) => u !== 'admin' && d.isAdmin);
      if (otherAdmins.length === 0) {
        return res.status(400).json({ error: 'Cannot remove admin status from the only admin' });
      }
    }

    const user = config.users[username];
    if (password) {
      user.password = await bcrypt.hash(password, 10);
      // Ends every existing session for this user (see sessionUser). If admins
      // change their own password, keep their current session alive.
      user.passwordChangedAt = Date.now();
      if (req.session.user === username) req.session.loginAt = Date.now() + 1;
    }
    if (typeof isAdmin === 'boolean') user.isAdmin = isAdmin;
    if (containers) user.containers = containers;

    saveConfig(config);
    res.json({ success: true, username });
  }));

  app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
    const { username } = req.params;
    if (username === 'admin') return res.status(400).json({ error: 'Cannot delete admin user' });
    if (!hasUser(username)) return res.status(404).json({ error: 'User not found' });
    delete config.users[username]; // their sessions stop working at once (sessionUser)
    saveConfig(config);
    res.json({ success: true });
  });

  // Errors from wrap()ed handlers and bad JSON bodies end up here.
  app.use('/api', (err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Bad request' });
    }
    console.error('API error:', err);
    res.status(500).json({ error: 'Internal error' });
  });

  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`🐳 Docker Manager running at http://localhost:${PORT}`);
    console.log(`   Docker: ${dockerSocket}`);
    console.log(`   Config: ${CONFIG_FILE}`);
    console.log(`   Users: ${Object.keys(config.users).length}`);
    console.log(`   Groups: ${Object.keys(config.groups || {}).length}`);
  });
})();
