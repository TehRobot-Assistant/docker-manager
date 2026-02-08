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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

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
    console.log(`   Default login: admin / ${ADMIN_PASSWORD === 'admin' ? 'admin (⚠️ CHANGE THIS!)' : '(from ADMIN_PASSWORD env)'}`);
  }
  
  return config;
}

function saveConfig(config) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

let config;

(async () => {
  config = await initConfig();
  
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
  }));
  app.use(express.static(join(__dirname, 'public')));

  function requireAuth(req, res, next) {
    if (req.session.user) next();
    else res.status(401).json({ error: 'Unauthorized' });
  }

  function requireAdmin(req, res, next) {
    if (req.session.user && config.users[req.session.user]?.isAdmin) next();
    else res.status(403).json({ error: 'Admin access required' });
  }

  function getUserContainers(username) {
    const user = config.users[username];
    if (user?.isAdmin) return '__all__';
    return user ? user.containers || [] : [];
  }

  async function isDefaultPassword() {
    const adminUser = config.users.admin;
    if (!adminUser) return false;
    return await bcrypt.compare('admin', adminUser.password);
  }

  // ==================== AUTH API ====================

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = config.users[username];
    
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    
    req.session.user = username;
    const usingDefault = username === 'admin' && await isDefaultPassword();
    
    res.json({ success: true, username, isAdmin: user.isAdmin || false, defaultPassword: usingDefault });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
  });

  app.get('/api/me', async (req, res) => {
    if (req.session.user) {
      const user = config.users[req.session.user];
      const usingDefault = req.session.user === 'admin' && await isDefaultPassword();
      res.json({ username: req.session.user, isAdmin: user?.isAdmin || false, defaultPassword: usingDefault });
    } else {
      res.status(401).json({ error: 'Not logged in' });
    }
  });

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

  app.post('/api/admin/groups', requireAdmin, (req, res) => {
    const { name, containers } = req.body;
    
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Group name required' });
    }
    
    if (config.groups[name]) {
      return res.status(400).json({ error: 'Group already exists' });
    }
    
    config.groups[name] = containers || [];
    saveConfig(config);
    res.json({ success: true, name });
  });

  app.put('/api/admin/groups/:name', requireAdmin, (req, res) => {
    const { name } = req.params;
    const { containers, newName } = req.body;
    
    if (!config.groups[name]) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    if (Array.isArray(containers)) {
      config.groups[name] = containers;
    }
    
    if (newName && newName !== name) {
      config.groups[newName] = config.groups[name];
      delete config.groups[name];
    }
    
    saveConfig(config);
    res.json({ success: true });
  });

  app.delete('/api/admin/groups/:name', requireAdmin, (req, res) => {
    const { name } = req.params;
    
    if (!config.groups[name]) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
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

  app.post('/api/admin/users', requireAdmin, async (req, res) => {
    const { username, password, isAdmin, containers } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    if (config.users[username]) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    config.users[username] = {
      password: await bcrypt.hash(password, 10),
      isAdmin: isAdmin || false,
      containers: containers || []
    };
    
    saveConfig(config);
    res.json({ success: true, username });
  });

  app.put('/api/admin/users/:username', requireAdmin, async (req, res) => {
    const { username } = req.params;
    const { password, isAdmin, containers } = req.body;
    
    if (!config.users[username]) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (username === 'admin' && isAdmin === false) {
      const otherAdmins = Object.entries(config.users).filter(([u, d]) => u !== 'admin' && d.isAdmin);
      if (otherAdmins.length === 0) {
        return res.status(400).json({ error: 'Cannot remove admin status from the only admin' });
      }
    }
    
    if (password) config.users[username].password = await bcrypt.hash(password, 10);
    if (typeof isAdmin === 'boolean') config.users[username].isAdmin = isAdmin;
    if (Array.isArray(containers)) config.users[username].containers = containers;
    
    saveConfig(config);
    res.json({ success: true, username });
  });

  app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
    const { username } = req.params;
    
    if (username === 'admin') return res.status(400).json({ error: 'Cannot delete admin user' });
    if (!config.users[username]) return res.status(404).json({ error: 'User not found' });
    
    delete config.users[username];
    saveConfig(config);
    res.json({ success: true });
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
