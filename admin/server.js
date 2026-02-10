// ============================================================
// OpenClaw 多客户管理面板 - 后端 API
// ============================================================

const express = require('express');
const crypto = require('crypto');
const Docker = require('dockerode');
const path = require('path');
const fs = require('fs').promises;
const { existsSync, mkdirSync, createReadStream, chownSync, readdirSync, statSync, lstatSync } = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const multer = require('multer');
const os = require('os');

// multer 临时上传目录
const upload = multer({ dest: os.tmpdir() });

// 递归 chown 目录为 node 用户 (uid/gid 1000)
// 客户容器以 node (1000) 运行，admin 以 root 创建目录，需修正权限
function chownRecursiveSync(dirPath, uid = 1000, gid = 1000) {
  try {
    chownSync(dirPath, uid, gid);
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        chownRecursiveSync(fullPath, uid, gid);
      } else {
        chownSync(fullPath, uid, gid);
      }
    }
  } catch (e) { /* 忽略权限错误 */ }
}

const app = express();
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// 配置
const PORT = process.env.ADMIN_PORT || 3000;
const OPENCLAW_IMAGE = process.env.OPENCLAW_IMAGE || 'openclaw:local';
const HOST_PROJECT_DIR = process.env.HOST_PROJECT_DIR || process.cwd();
const CLIENTS_DIR = path.resolve(process.env.CLIENTS_DIR || path.join(__dirname, 'clients'));
const CONFIG_TEMPLATE = path.resolve(process.env.CONFIG_TEMPLATE || path.join(__dirname, 'config', 'openclaw.json'));

// Basic Auth 配置
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || crypto.randomBytes(12).toString('hex');

// 中间件
app.use(express.json());

// Basic Auth 认证中间件（健康检查除外）
app.use((req, res, next) => {
  // 健康检查端点无需认证
  if (req.path.match(/\/api\/clients\/[^/]+\/health$/)) return next();

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="OpenClaw Admin"');
    return res.status(401).json({ error: '需要认证' });
  }

  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
    res.setHeader('WWW-Authenticate', 'Basic realm="OpenClaw Admin"');
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── 工具函数 ──────────────────────────────────────────────

// 在指定容器中执行命令并返回 stdout
async function execInContainer(containerName, cmd) {
  const container = docker.getContainer(containerName);
  const exec = await container.exec({
    Cmd: cmd, AttachStdout: true, AttachStderr: true,
  });
  const stream = await exec.start();
  return new Promise((resolve, reject) => {
    let stdout = '';
    container.modem.demuxStream(stream, {
      write: (chunk) => { stdout += chunk.toString(); }
    }, {
      write: () => { } // 忽略 stderr
    });
    stream.on('end', () => resolve(stdout));
    stream.on('error', reject);
    // 超时保护 30s
    setTimeout(() => resolve(stdout), 30000);
  });
}

// 解析 clawhub explore/search 文本输出
function parseSkillLines(output) {
  return output.trim().split('\n')
    .filter(l => l.trim() && !l.startsWith('-') && !l.startsWith('Fetching'))
    .map(line => {
      // 格式: slug  version  time  description...
      const match = line.match(/^(\S+)\s+(v?\d[\d.]+)\s+(.+?)\s{2,}(.+)$/);
      if (match) return { slug: match[1], version: match[2], time: match[3].trim(), description: match[4].trim() };
      // fallback: slug  version
      const parts = line.trim().split(/\s+/);
      return { slug: parts[0], version: parts[1] || '', description: parts.slice(2).join(' ') };
    })
    .filter(s => s.slug && s.slug.length > 1);
}

// 解析 openclaw skills list 表格输出
function parseSkillsTable(output) {
  const skills = [];
  // 按行匹配表格中的 skill 条目
  for (const line of output.split('\n')) {
    // 格式: │ status │ icon name │ description │ source │
    const match = line.match(/│\s*(✓ ready|✗ missing|⏸ disabled)\s*│\s*(.+?)\s*│\s*(.+?)\s*│\s*(.+?)\s*│/);
    if (match) {
      const status = match[1].includes('ready') ? 'ready' : match[1].includes('missing') ? 'missing' : 'disabled';
      const nameRaw = match[2].trim();
      // 提取 emoji 图标和名称
      const iconMatch = nameRaw.match(/^(.+?)\s+(\S+)$/);
      skills.push({
        status,
        icon: iconMatch ? iconMatch[1].trim() : '',
        slug: iconMatch ? iconMatch[2].trim() : nameRaw,
        description: match[3].trim(),
        source: match[4].trim(),
      });
    }
  }
  return skills;
}

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
    const todayUsage = await getTodayUsage(e.name);
    results.push({
      name: e.name,
      port: env.PORT || '—',
      feishuAppId: env.FEISHU_APP_ID ? '••••' + env.FEISHU_APP_ID.slice(-4) : '',
      feishuDomain: env.FEISHU_DOMAIN || 'feishu',
      zhipuKey: env.ZHIPU_API_KEY ? '••••' + env.ZHIPU_API_KEY.slice(-4) : '',
      gatewayToken,
      todayTokens: todayUsage.totalTokens,
      todayRequests: todayUsage.requests,
      ...container,
    });
  }
  return results;
}

// ── 用量统计 ──────────────────────────────────────────────

// 从 JSONL 会话文件中解析用量数据
async function parseSessionUsage(clientName) {
  const sessionsDir = path.join(CLIENTS_DIR, clientName, 'data', 'agents', 'main', 'sessions');
  if (!existsSync(sessionsDir)) return {};

  const files = await fs.readdir(sessionsDir);
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

  // 按天汇总用量
  const daily = {};

  for (const file of jsonlFiles) {
    try {
      const content = await fs.readFile(path.join(sessionsDir, file), 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'message' || entry.message?.role !== 'assistant') continue;
          const usage = entry.message?.usage;
          if (!usage) continue;

          const day = entry.timestamp?.slice(0, 10) || 'unknown';
          if (!daily[day]) daily[day] = { input: 0, output: 0, cacheRead: 0, totalTokens: 0, requests: 0 };
          daily[day].input += usage.input || 0;
          daily[day].output += usage.output || 0;
          daily[day].cacheRead += usage.cacheRead || 0;
          daily[day].totalTokens += usage.totalTokens || 0;
          daily[day].requests += 1;
        } catch { /* 跳过无法解析的行 */ }
      }
    } catch { /* 跳过无法读取的文件 */ }
  }

  return daily;
}

// 获取今日用量摘要
async function getTodayUsage(clientName) {
  try {
    const daily = await parseSessionUsage(clientName);
    const today = new Date().toISOString().slice(0, 10);
    return daily[today] || { input: 0, output: 0, cacheRead: 0, totalTokens: 0, requests: 0 };
  } catch { return { input: 0, output: 0, cacheRead: 0, totalTokens: 0, requests: 0 }; }
}

// ── API 路由 ──────────────────────────────────────────────

// 总览（含全局用量统计）
app.get('/api/dashboard', async (_req, res) => {
  try {
    const clients = await listClients();
    const running = clients.filter(c => c.running).length;
    const todayTotalTokens = clients.reduce((sum, c) => sum + (c.todayTokens || 0), 0);
    const todayTotalRequests = clients.reduce((sum, c) => sum + (c.todayRequests || 0), 0);
    res.json({
      total: clients.length, running, stopped: clients.length - running,
      todayTokens: todayTotalTokens, todayRequests: todayTotalRequests,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 客户用量详情（按天）
app.get('/api/clients/:name/usage', async (req, res) => {
  try {
    const daily = await parseSessionUsage(req.params.name);
    // 计算总计
    const total = { input: 0, output: 0, cacheRead: 0, totalTokens: 0, requests: 0 };
    for (const day of Object.values(daily)) {
      total.input += day.input;
      total.output += day.output;
      total.cacheRead += day.cacheRead;
      total.totalTokens += day.totalTokens;
      total.requests += day.requests;
    }
    res.json({ daily, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Skill Marketplace API ─────────────────────────────────

// 获取任意运行中容器的名称（用于全局命令）
async function getAnyRunningContainer() {
  const clients = await listClients();
  const running = clients.find(c => c.running);
  return running ? cname(running.name) : null;
}

// 客户 skill 列表
app.get('/api/clients/:name/skills', async (req, res) => {
  try {
    const containerName = cname(req.params.name);
    const output = await execInContainer(containerName, ['openclaw', 'skills', 'list']);
    const skills = parseSkillsTable(output);
    // 同时获取 clawhub 安装的 skill
    let installed = [];
    try {
      const hubOutput = await execInContainer(containerName, ['clawhub', 'list']);
      installed = hubOutput.trim().split('\n').filter(l => l.trim()).map(l => {
        const [slug, version] = l.trim().split(/\s+/);
        return { slug, version };
      });
    } catch { }
    res.json({ skills, installed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 浏览注册表（热门/最新）
app.get('/api/skills/explore', async (req, res) => {
  try {
    const limit = req.query.limit || 20;
    const containerName = await getAnyRunningContainer();
    if (!containerName) return res.status(503).json({ error: '无运行中的客户容器' });
    const output = await execInContainer(containerName, [
      'clawhub', 'explore', '--limit', String(limit), '--no-input'
    ]);
    res.json(parseSkillLines(output));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 搜索注册表
app.get('/api/skills/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: '搜索关键词不能为空' });
    const containerName = await getAnyRunningContainer();
    if (!containerName) return res.status(503).json({ error: '无运行中的客户容器' });
    const output = await execInContainer(containerName, [
      'clawhub', 'search', q, '--no-input'
    ]);
    res.json(parseSkillLines(output));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 安装 skill 到指定客户
app.post('/api/clients/:name/skills/install', async (req, res) => {
  try {
    const { slug } = req.body;
    if (!slug) return res.status(400).json({ error: 'slug 不能为空' });
    const containerName = cname(req.params.name);
    const output = await execInContainer(containerName, [
      'clawhub', 'install', slug, '--no-input'
    ]);
    res.json({ ok: true, message: `已安装 ${slug}`, output: output.trim() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新 skill
app.post('/api/clients/:name/skills/update', async (req, res) => {
  try {
    const { slug } = req.body;
    const containerName = cname(req.params.name);
    const cmd = slug
      ? ['clawhub', 'update', slug, '--no-input']
      : ['clawhub', 'update', '--no-input'];
    const output = await execInContainer(containerName, cmd);
    res.json({ ok: true, message: slug ? `已更新 ${slug}` : '已更新全部', output: output.trim() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 模型预设 API ──────────────────────────────────────────

const MODELS_FILE = path.resolve(process.env.MODELS_FILE || path.join(__dirname, '..', 'config', 'models.json'));

// 读取模型预设
async function loadModels() {
  if (!existsSync(MODELS_FILE)) return [];
  return JSON.parse(await fs.readFile(MODELS_FILE, 'utf-8'));
}

// 保存模型预设
async function saveModels(models) {
  await fs.writeFile(MODELS_FILE, JSON.stringify(models, null, 2) + '\n');
}

// 模型列表
app.get('/api/models', async (_req, res) => {
  try { res.json(await loadModels()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// 添加模型预设
app.post('/api/models', async (req, res) => {
  try {
    const { id, name, provider, modelId, baseUrl, api, contextWindow, maxTokens, envKey } = req.body;
    if (!id || !name || !provider || !modelId) {
      return res.status(400).json({ error: 'id, name, provider, modelId 为必填' });
    }
    const models = await loadModels();
    if (models.find(m => m.id === id)) return res.status(409).json({ error: '模型 ID 已存在' });
    models.push({ id, name, provider, modelId, baseUrl, api, contextWindow, maxTokens, envKey });
    await saveModels(models);
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除模型预设
app.delete('/api/models/:id', async (req, res) => {
  try {
    let models = await loadModels();
    models = models.filter(m => m.id !== req.params.id);
    await saveModels(models);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 根据模型预设生成 openclaw.json 的 models 段
function buildModelConfig(modelPreset, apiKey) {
  return {
    providers: {
      [modelPreset.provider]: {
        baseUrl: modelPreset.baseUrl,
        apiKey: apiKey || '',
        api: modelPreset.api || 'openai-completions',
        models: [{
          id: modelPreset.modelId,
          name: modelPreset.name,
          contextWindow: modelPreset.contextWindow || 128000,
          maxTokens: modelPreset.maxTokens || 8192,
        }],
      },
    },
  };
}

// 模板列表
const TEMPLATES_DIR = path.resolve(process.env.TEMPLATES_DIR || path.join(__dirname, '..', 'config', 'templates'));

app.get('/api/templates', async (_req, res) => {
  try {
    if (!existsSync(TEMPLATES_DIR)) return res.json([]);
    const files = await fs.readdir(TEMPLATES_DIR);
    const templates = [];
    for (const file of files.filter(f => f.endsWith('.json'))) {
      try {
        const content = JSON.parse(await fs.readFile(path.join(TEMPLATES_DIR, file), 'utf-8'));
        templates.push({
          id: file.replace('.json', ''),
          name: content._meta?.name || file,
          description: content._meta?.description || '',
          icon: content._meta?.icon || '🤖',
        });
      } catch { /* 跳过无效模板 */ }
    }
    res.json(templates);
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
    const { name, port, feishuAppId, feishuAppSecret, feishuDomain, zhipuApiKey, template, modelId, apiKey } = req.body;

    // 校验
    if (!name || !port) return res.status(400).json({ error: '名称和端口为必填' });
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return res.status(400).json({ error: '名称仅允许小写字母、数字、连字符' });

    const clientDir = path.join(CLIENTS_DIR, name);
    const dataDir = path.join(clientDir, 'data');
    if (existsSync(clientDir)) return res.status(409).json({ error: '客户已存在' });

    // 创建目录并设置权限（客户容器以 uid 1000 运行）
    mkdirSync(dataDir, { recursive: true });
    chownRecursiveSync(clientDir);

    // 查找模型预设
    let selectedModel = null;
    if (modelId) {
      const models = await loadModels();
      selectedModel = models.find(m => m.id === modelId);
    }

    // 写 .env（动态 API Key 字段）
    const envLines = [
      `PORT=${port}`,
      `FEISHU_APP_ID=${feishuAppId || ''}`,
      `FEISHU_APP_SECRET=${feishuAppSecret || ''}`,
      `FEISHU_DOMAIN=${feishuDomain || 'feishu'}`,
      `TEMPLATE=${template || 'default'}`,
    ];
    // 写入对应的 API Key
    if (selectedModel && selectedModel.envKey) {
      envLines.push(`${selectedModel.envKey}=${apiKey || zhipuApiKey || ''}`);
    } else {
      envLines.push(`ZHIPU_API_KEY=${zhipuApiKey || ''}`);
    }
    if (modelId) envLines.push(`MODEL_PRESET=${modelId}`);
    envLines.push('');
    await fs.writeFile(path.join(clientDir, '.env'), envLines.join('\n'));

    // 构建 openclaw.json
    let tplSource = CONFIG_TEMPLATE;
    if (template && template !== 'default') {
      const templateFile = path.join(TEMPLATES_DIR, `${template}.json`);
      if (existsSync(templateFile)) tplSource = templateFile;
    }
    let config = JSON.parse(await fs.readFile(tplSource, 'utf-8'));
    // 清除模板的 _meta
    delete config._meta;

    // 替换飞书配置
    if (config.channels?.feishu) {
      config.channels.feishu.appId = feishuAppId || '';
      config.channels.feishu.appSecret = feishuAppSecret || '';
      config.channels.feishu.domain = feishuDomain || 'feishu';
    }

    // 按模型预设生成 provider 配置
    if (selectedModel) {
      const effectiveKey = apiKey || zhipuApiKey || '';
      config.models = buildModelConfig(selectedModel, effectiveKey);
      config.agents.defaults.model.primary = `${selectedModel.provider}/${selectedModel.modelId}`;
    } else {
      // 兼容旧逻辑：替换占位符
      let tplStr = JSON.stringify(config);
      tplStr = tplStr.replace('ZHIPU_API_KEY_PLACEHOLDER', zhipuApiKey || '');
      config = JSON.parse(tplStr);
    }

    await fs.writeFile(path.join(dataDir, 'openclaw.json'), JSON.stringify(config, null, 4) + '\n');
    // 确保所有文件属于 node 用户
    chownRecursiveSync(clientDir);

    // 创建并启动容器
    const hostDataPath = path.join(HOST_PROJECT_DIR, 'clients', name, 'data');
    const containerEnv = [];
    if (process.env.HTTP_PROXY) containerEnv.push(`HTTP_PROXY=${process.env.HTTP_PROXY}`, `http_proxy=${process.env.HTTP_PROXY}`);
    if (process.env.HTTPS_PROXY) containerEnv.push(`HTTPS_PROXY=${process.env.HTTPS_PROXY}`, `https_proxy=${process.env.HTTPS_PROXY}`);
    containerEnv.push('OPENAI_BASE_URL=http://172.17.0.1:11434/v1', 'OPENAI_API_KEY=ollama');
    const container = await docker.createContainer({
      Image: OPENCLAW_IMAGE,
      name: cname(name),
      Env: containerEnv.length ? containerEnv : undefined,
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

// ── 导入导出 API ─────────────────────────────────────────

// 导出客户（完整 data 目录 + .env）为 tar.gz
app.get('/api/clients/:name/export', async (req, res) => {
  try {
    const { name } = req.params;
    const clientDir = path.join(CLIENTS_DIR, name);
    if (!existsSync(clientDir)) return res.status(404).json({ error: '客户不存在' });

    // 先写入 meta.json
    const meta = {
      version: 1,
      exportedAt: new Date().toISOString(),
      clientName: name,
    };
    await fs.writeFile(path.join(clientDir, 'meta.json'), JSON.stringify(meta, null, 2));

    // 流式输出 tar.gz
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-export.tar.gz"`);

    const { spawn } = require('child_process');
    const tar = spawn('tar', ['czf', '-', '-C', CLIENTS_DIR, name]);
    tar.stdout.pipe(res);
    tar.stderr.on('data', (d) => console.error('tar stderr:', d.toString()));
    tar.on('close', async (code) => {
      // 清理 meta.json
      try { await fs.unlink(path.join(clientDir, 'meta.json')); } catch { }
      if (code !== 0 && !res.headersSent) {
        res.status(500).json({ error: 'tar 打包失败' });
      }
    });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// 导入客户（上传 tar.gz）
app.post('/api/clients/import', upload.single('file'), async (req, res) => {
  const tmpFile = req.file?.path;
  try {
    if (!tmpFile) return res.status(400).json({ error: '请上传 tar.gz 文件' });

    const newName = req.body.name;
    const newPort = req.body.port;
    if (!newName || !newPort) return res.status(400).json({ error: 'name 和 port 为必填' });
    if (!/^[a-z0-9][a-z0-9-]*$/.test(newName)) {
      return res.status(400).json({ error: '名称仅允许小写字母、数字、连字符' });
    }

    const clientDir = path.join(CLIENTS_DIR, newName);
    if (existsSync(clientDir)) return res.status(409).json({ error: '客户已存在' });

    // 解压到临时目录
    const tmpDir = path.join(os.tmpdir(), `openclaw-import-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    await execFileAsync('tar', ['xzf', tmpFile, '-C', tmpDir]);

    // 查找解压后的实际文件夹（tar 中的顶层目录可能是原始客户名）
    const extracted = (await fs.readdir(tmpDir)).filter(f => !f.startsWith('.'));
    const srcDir = extracted.length === 1
      ? path.join(tmpDir, extracted[0])
      : tmpDir;

    // 复制到正式目录（跨文件系统不能用 rename）
    await fs.cp(srcDir, clientDir, { recursive: true });

    // 更新 .env 中的 PORT
    const envFile = path.join(clientDir, '.env');
    if (existsSync(envFile)) {
      let envContent = await fs.readFile(envFile, 'utf-8');
      envContent = envContent.replace(/^PORT=.*/m, `PORT=${newPort}`);
      await fs.writeFile(envFile, envContent);
    }

    // 清理临时文件
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { }
    try { await fs.unlink(path.join(clientDir, 'meta.json')); } catch { }
    // 修正权限（admin 以 root 运行，客户容器需要 uid 1000）
    chownRecursiveSync(clientDir);

    // 创建并启动容器
    const hostDataPath = path.join(HOST_PROJECT_DIR, 'clients', newName, 'data');
    const containerEnv = [];
    if (process.env.HTTP_PROXY) containerEnv.push(`HTTP_PROXY=${process.env.HTTP_PROXY}`, `http_proxy=${process.env.HTTP_PROXY}`);
    if (process.env.HTTPS_PROXY) containerEnv.push(`HTTPS_PROXY=${process.env.HTTPS_PROXY}`, `https_proxy=${process.env.HTTPS_PROXY}`);
    containerEnv.push('OPENAI_BASE_URL=http://172.17.0.1:11434/v1', 'OPENAI_API_KEY=ollama');
    const container = await docker.createContainer({
      Image: OPENCLAW_IMAGE,
      name: cname(newName),
      Env: containerEnv.length ? containerEnv : undefined,
      ExposedPorts: { '18789/tcp': {} },
      HostConfig: {
        PortBindings: { '18789/tcp': [{ HostPort: String(newPort) }] },
        Binds: [`${hostDataPath}:/home/node/.openclaw`],
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });
    await container.start();

    res.status(201).json({ name: newName, port: newPort, status: 'running', message: '导入成功' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    // 清理上传的临时文件
    if (tmpFile) try { await fs.unlink(tmpFile); } catch { }
  }
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
      const containerEnv = [];
      if (process.env.HTTP_PROXY) containerEnv.push(`HTTP_PROXY=${process.env.HTTP_PROXY}`, `http_proxy=${process.env.HTTP_PROXY}`);
      if (process.env.HTTPS_PROXY) containerEnv.push(`HTTPS_PROXY=${process.env.HTTPS_PROXY}`, `https_proxy=${process.env.HTTPS_PROXY}`);
      containerEnv.push('OPENAI_BASE_URL=http://172.17.0.1:11434/v1', 'OPENAI_API_KEY=ollama');
      const container = await docker.createContainer({
        Image: OPENCLAW_IMAGE,
        name: cname(name),
        Env: containerEnv.length ? containerEnv : undefined,
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

// 升级客户容器（保留数据，用新镜像重建，重新初始化插件/技能）
app.post('/api/clients/:name/upgrade', async (req, res) => {
  try {
    const { name } = req.params;
    const env = await parseEnv(path.join(CLIENTS_DIR, name, '.env'));
    const port = env.PORT || '18789';

    // 1. 停止并删除旧容器
    const container = docker.getContainer(cname(name));
    try { await container.stop(); } catch { /* 可能已停止 */ }
    try { await container.remove(); } catch { /* 可能不存在 */ }

    // 2. 删除 .initialized 标记，让 init.sh 重新安装插件/技能
    const initMarker = path.join(CLIENTS_DIR, name, 'data', '.initialized');
    try { await fs.unlink(initMarker); } catch { /* 不存在则忽略 */ }

    // 3. 删除旧 extensions 目录（让 init.sh 重新 clone 最新版本）
    const extDir = path.join(CLIENTS_DIR, name, 'data', 'extensions');
    try { await fs.rm(extDir, { recursive: true, force: true }); } catch { }

    // 4. 用新镜像重建容器（memory-lancedb 配置由 init.sh 自动注入）
    const hostDataPath = path.join(HOST_PROJECT_DIR, 'clients', name, 'data');
    const containerEnv = [];
    if (process.env.HTTP_PROXY) containerEnv.push(`HTTP_PROXY=${process.env.HTTP_PROXY}`, `http_proxy=${process.env.HTTP_PROXY}`);
    if (process.env.HTTPS_PROXY) containerEnv.push(`HTTPS_PROXY=${process.env.HTTPS_PROXY}`, `https_proxy=${process.env.HTTPS_PROXY}`);
    containerEnv.push('OPENAI_BASE_URL=http://172.17.0.1:11434/v1', 'OPENAI_API_KEY=ollama');
    const newContainer = await docker.createContainer({
      Image: OPENCLAW_IMAGE,
      name: cname(name),
      Env: containerEnv.length ? containerEnv : undefined,
      ExposedPorts: { '18789/tcp': {} },
      HostConfig: {
        PortBindings: { '18789/tcp': [{ HostPort: String(port) }] },
        Binds: [`${hostDataPath}:/home/node/.openclaw`],
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });
    await newContainer.start();

    res.json({ message: '升级完成，新插件和技能将自动安装' });
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
  console.log(`🔐 管理面板认证: ${ADMIN_USER} / ${process.env.ADMIN_PASS ? '****' : ADMIN_PASS}`);
  if (!process.env.ADMIN_PASS) {
    console.log(`   ⚠️ 密码为自动生成，建议在 .env 中设置 ADMIN_PASS`);
  }
});
