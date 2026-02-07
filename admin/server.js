// ============================================================
// OpenClaw 多客户管理面板 - 后端 API
// ============================================================

const express = require('express');
const Docker = require('dockerode');
const path = require('path');
const fs = require('fs').promises;
const { existsSync, mkdirSync, createReadStream } = require('fs');

const app = express();
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// 配置
const PORT = process.env.ADMIN_PORT || 3000;
const OPENCLAW_IMAGE = process.env.OPENCLAW_IMAGE || 'openclaw:local';
const HOST_PROJECT_DIR = process.env.HOST_PROJECT_DIR || process.cwd();
const CLIENTS_DIR = path.resolve(process.env.CLIENTS_DIR || path.join(__dirname, 'clients'));
const CONFIG_TEMPLATE = path.resolve(process.env.CONFIG_TEMPLATE || path.join(__dirname, 'config', 'openclaw.json'));

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 工具函数 ──────────────────────────────────────────────

const cname = (name) => `openclaw-${name}`;

// 解析 .env 文件为对象
async function parseEnv(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const config = {};
    for (const line of content.split('\n')) {
      const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
      if (m) config[m[1].trim()] = m[2].trim();
    }
    return config;
  } catch { return {}; }
}

// 获取容器运行信息
async function inspectContainer(name) {
  try {
    const info = await docker.getContainer(cname(name)).inspect();
    return {
      status: info.State.Status,
      running: info.State.Running,
      startedAt: info.State.StartedAt,
      health: info.State.Health?.Status || null,
    };
  } catch {
    return { status: 'not_created', running: false };
  }
}

// 读取客户的 gateway token
async function getGatewayToken(clientName) {
  try {
    const configPath = path.join(CLIENTS_DIR, clientName, 'data', 'openclaw.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    return config.gateway?.auth?.token || '';
  } catch { return ''; }
}

// 列出所有客户
async function listClients() {
  if (!existsSync(CLIENTS_DIR)) return [];
  const entries = await fs.readdir(CLIENTS_DIR, { withFileTypes: true });
  const results = [];

  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const env = await parseEnv(path.join(CLIENTS_DIR, e.name, '.env'));
    const container = await inspectContainer(e.name);
    const gatewayToken = await getGatewayToken(e.name);
    results.push({
      name: e.name,
      port: env.PORT || '—',
      feishuAppId: env.FEISHU_APP_ID ? '••••' + env.FEISHU_APP_ID.slice(-4) : '',
      feishuDomain: env.FEISHU_DOMAIN || 'feishu',
      zhipuKey: env.ZHIPU_API_KEY ? '••••' + env.ZHIPU_API_KEY.slice(-4) : '',
      gatewayToken,
      ...container,
    });
  }
  return results;
}

// ── API 路由 ──────────────────────────────────────────────

// 总览
app.get('/api/dashboard', async (_req, res) => {
  try {
    const clients = await listClients();
    const running = clients.filter(c => c.running).length;
    res.json({ total: clients.length, running, stopped: clients.length - running });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 列出客户
app.get('/api/clients', async (_req, res) => {
  try { res.json(await listClients()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// 获取客户详情（含完整 .env）
app.get('/api/clients/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const dir = path.join(CLIENTS_DIR, name);
    if (!existsSync(dir)) return res.status(404).json({ error: '客户不存在' });
    const env = await parseEnv(path.join(dir, '.env'));
    const container = await inspectContainer(name);
    res.json({ name, ...env, ...container });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 创建客户
app.post('/api/clients', async (req, res) => {
  try {
    const { name, port, feishuAppId, feishuAppSecret, feishuDomain, zhipuApiKey } = req.body;

    // 校验
    if (!name || !port) return res.status(400).json({ error: '名称和端口为必填' });
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return res.status(400).json({ error: '名称仅允许小写字母、数字、连字符' });

    const clientDir = path.join(CLIENTS_DIR, name);
    const dataDir = path.join(clientDir, 'data');
    if (existsSync(clientDir)) return res.status(409).json({ error: '客户已存在' });

    // 创建目录
    mkdirSync(dataDir, { recursive: true });

    // 写 .env
    const envContent = [
      `PORT=${port}`,
      `FEISHU_APP_ID=${feishuAppId || ''}`,
      `FEISHU_APP_SECRET=${feishuAppSecret || ''}`,
      `FEISHU_DOMAIN=${feishuDomain || 'feishu'}`,
      `ZHIPU_API_KEY=${zhipuApiKey || ''}`,
      '',
    ].join('\n');
    await fs.writeFile(path.join(clientDir, '.env'), envContent);

    // 写配置文件（从模板替换占位符）
    let tpl = await fs.readFile(CONFIG_TEMPLATE, 'utf-8');
    tpl = tpl
      .replace('FEISHU_APP_ID_PLACEHOLDER', feishuAppId || '')
      .replace('FEISHU_APP_SECRET_PLACEHOLDER', feishuAppSecret || '')
      .replace('FEISHU_DOMAIN_PLACEHOLDER', feishuDomain || 'feishu')
      .replace('ZHIPU_API_KEY_PLACEHOLDER', zhipuApiKey || '');
    await fs.writeFile(path.join(dataDir, 'openclaw.json'), tpl);

    // 创建并启动容器
    const hostDataPath = path.join(HOST_PROJECT_DIR, 'clients', name, 'data');
    const container = await docker.createContainer({
      Image: OPENCLAW_IMAGE,
      name: cname(name),
      ExposedPorts: { '18789/tcp': {} },
      HostConfig: {
        PortBindings: { '18789/tcp': [{ HostPort: String(port) }] },
        Binds: [`${hostDataPath}:/home/node/.openclaw`],
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });
    await container.start();

    res.status(201).json({ name, port, status: 'running' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新客户配置
app.put('/api/clients/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const dir = path.join(CLIENTS_DIR, name);
    if (!existsSync(dir)) return res.status(404).json({ error: '客户不存在' });

    const { port, feishuAppId, feishuAppSecret, feishuDomain, zhipuApiKey } = req.body;
    const envContent = [
      `PORT=${port || ''}`,
      `FEISHU_APP_ID=${feishuAppId || ''}`,
      `FEISHU_APP_SECRET=${feishuAppSecret || ''}`,
      `FEISHU_DOMAIN=${feishuDomain || 'feishu'}`,
      `ZHIPU_API_KEY=${zhipuApiKey || ''}`,
      '',
    ].join('\n');
    await fs.writeFile(path.join(dir, '.env'), envContent);

    // 同步更新 openclaw.json
    let tpl = await fs.readFile(CONFIG_TEMPLATE, 'utf-8');
    tpl = tpl
      .replace('FEISHU_APP_ID_PLACEHOLDER', feishuAppId || '')
      .replace('FEISHU_APP_SECRET_PLACEHOLDER', feishuAppSecret || '')
      .replace('FEISHU_DOMAIN_PLACEHOLDER', feishuDomain || 'feishu')
      .replace('ZHIPU_API_KEY_PLACEHOLDER', zhipuApiKey || '');
    await fs.writeFile(path.join(dir, 'data', 'openclaw.json'), tpl);

    res.json({ message: '配置已更新，请重启实例以生效' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除客户
app.delete('/api/clients/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const dir = path.join(CLIENTS_DIR, name);

    // 尝试停止并移除容器
    try {
      const c = docker.getContainer(cname(name));
      try { await c.stop(); } catch { }
      await c.remove();
    } catch { }

    // 移除目录
    if (existsSync(dir)) await fs.rm(dir, { recursive: true, force: true });

    res.json({ message: '客户已删除' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 容器控制 ──────────────────────────────────────────────

app.post('/api/clients/:name/start', async (req, res) => {
  try {
    const { name } = req.params;
    const info = await inspectContainer(name);

    if (info.status === 'not_created') {
      // 容器不存在，重新创建
      const env = await parseEnv(path.join(CLIENTS_DIR, name, '.env'));
      const hostDataPath = path.join(HOST_PROJECT_DIR, 'clients', name, 'data');
      const container = await docker.createContainer({
        Image: OPENCLAW_IMAGE,
        name: cname(name),
        ExposedPorts: { '18789/tcp': {} },
        HostConfig: {
          PortBindings: { '18789/tcp': [{ HostPort: String(env.PORT || '18789') }] },
          Binds: [`${hostDataPath}:/home/node/.openclaw`],
          RestartPolicy: { Name: 'unless-stopped' },
        },
      });
      await container.start();
    } else {
      await docker.getContainer(cname(name)).start();
    }
    res.json({ message: '已启动' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients/:name/stop', async (req, res) => {
  try {
    await docker.getContainer(cname(req.params.name)).stop();
    res.json({ message: '已停止' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients/:name/restart', async (req, res) => {
  try {
    await docker.getContainer(cname(req.params.name)).restart();
    res.json({ message: '已重启' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 实时日志 (SSE) ────────────────────────────────────────

app.get('/api/clients/:name/logs', async (req, res) => {
  try {
    const container = docker.getContainer(cname(req.params.name));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const logStream = await container.logs({
      follow: true, stdout: true, stderr: true, tail: 200, timestamps: true,
    });

    // Docker 多路复用流：解析帧头获取实际内容
    const onData = (chunk) => {
      const lines = chunk.toString('utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        res.write(`data: ${line}\n\n`);
      }
    };

    logStream.on('data', (chunk) => {
      // Docker 流帧头为 8 字节，跳过帧头直接取内容
      if (chunk.length > 8) {
        onData(chunk.slice(8));
      } else {
        onData(chunk);
      }
    });

    logStream.on('end', () => {
      res.write('event: close\ndata: stream ended\n\n');
      res.end();
    });

    req.on('close', () => { logStream.destroy(); });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 健康检查
app.get('/api/clients/:name/health', async (req, res) => {
  try {
    const info = await inspectContainer(req.params.name);
    res.json(info);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SPA 回退 ──────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── 启动 ──────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🦞 OpenClaw Admin 管理面板: http://localhost:${PORT}`);
  console.log(`   客户目录: ${CLIENTS_DIR}`);
  console.log(`   配置模板: ${CONFIG_TEMPLATE}`);
  console.log(`   宿主机路径: ${HOST_PROJECT_DIR}`);
});
