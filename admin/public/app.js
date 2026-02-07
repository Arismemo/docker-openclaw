// ============================================================
// OpenClaw 管理面板 - 前端逻辑
// ============================================================

let logEventSource = null;
let modelPresets = []; // 模型预设缓存

// ── 初始化 ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    loadClients();
    loadTemplates();
    loadModels();
    // 每 15 秒自动刷新
    setInterval(() => { loadDashboard(); loadClients(); }, 15000);
});

// ── API 请求 ──────────────────────────────────────────────

async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
}

// ── Dashboard ─────────────────────────────────────────────

async function loadDashboard() {
    try {
        const d = await api('/dashboard');
        document.getElementById('stat-total').textContent = d.total;
        document.getElementById('stat-running').textContent = d.running;
        document.getElementById('stat-stopped').textContent = d.stopped;
        // 用量统计卡片（如果存在）
        const tokenEl = document.getElementById('stat-tokens');
        const reqEl = document.getElementById('stat-requests');
        if (tokenEl) tokenEl.textContent = formatTokens(d.todayTokens || 0);
        if (reqEl) reqEl.textContent = d.todayRequests || 0;
    } catch { }
}

// 加载可用模板列表
async function loadTemplates() {
    try {
        const templates = await api('/templates');
        const select = document.getElementById('f-template');
        // 保留默认选项，追加模板
        templates.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.icon} ${t.name} — ${t.description}`;
            select.appendChild(opt);
        });
    } catch { }
}

// ── 客户列表 ──────────────────────────────────────────────

async function loadClients() {
    try {
        const clients = await api('/clients');
        const tbody = document.getElementById('clients-tbody');
        const empty = document.getElementById('empty-state');

        if (clients.length === 0) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        tbody.innerHTML = clients.map(c => `
      <tr>
        <td><span class="status-dot ${c.status}"></span>${statusText(c.status)}</td>
        <td><strong>${c.name}</strong></td>
        <td>${c.port}</td>
        <td>${c.feishuDomain}</td>
        <td>${c.zhipuKey || '—'}</td>
        <td title="今日 Token / 请求数">${formatTokens(c.todayTokens || 0)} / ${c.todayRequests || 0}</td>
        <td class="actions">${actionButtons(c)}</td>
      </tr>
    `).join('');
    } catch (e) {
        toast('加载客户列表失败：' + e.message, 'error');
    }
}

function statusText(s) {
    const map = { running: '运行中', exited: '已停止', created: '已创建', not_created: '未创建' };
    return map[s] || s;
}

// Token 数量格式化（万为单位）
function formatTokens(n) {
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    return n.toLocaleString();
}

function actionButtons(c) {
    if (c.running) {
        return `
      <button class="btn btn-accent btn-sm" onclick="window.open('http://' + location.hostname + ':${c.port}?token=${c.gatewayToken}', '_blank')">控制台</button>
      <button class="btn btn-ghost btn-sm" onclick="stopClient('${c.name}')">停止</button>
      <button class="btn btn-ghost btn-sm" onclick="restartClient('${c.name}')">重启</button>
      <button class="btn btn-ghost btn-sm" onclick="openLogs('${c.name}')">日志</button>
      <button class="btn btn-ghost btn-sm" onclick="exportClient('${c.name}')">📤 导出</button>
    `;
    }
    return `
    <button class="btn btn-primary btn-sm" onclick="startClient('${c.name}')">启动</button>
    <button class="btn btn-ghost btn-sm" onclick="editClient('${c.name}')">编辑</button>
    <button class="btn btn-ghost btn-sm" onclick="exportClient('${c.name}')">📤 导出</button>
    <button class="btn btn-danger btn-sm" onclick="deleteClient('${c.name}')">删除</button>
  `;
}

// ── 容器控制 ──────────────────────────────────────────────

async function startClient(name) {
    try {
        await api(`/clients/${name}/start`, { method: 'POST' });
        toast(`${name} 已启动`, 'success');
        loadDashboard(); loadClients();
    } catch (e) { toast(e.message, 'error'); }
}

async function stopClient(name) {
    try {
        await api(`/clients/${name}/stop`, { method: 'POST' });
        toast(`${name} 已停止`, 'success');
        loadDashboard(); loadClients();
    } catch (e) { toast(e.message, 'error'); }
}

async function restartClient(name) {
    try {
        await api(`/clients/${name}/restart`, { method: 'POST' });
        toast(`${name} 已重启`, 'success');
        loadDashboard(); loadClients();
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteClient(name) {
    if (!confirm(`确定删除客户 "${name}"？\n此操作将停止容器并删除所有数据！`)) return;
    try {
        await api(`/clients/${name}`, { method: 'DELETE' });
        toast(`${name} 已删除`, 'success');
        loadDashboard(); loadClients();
    } catch (e) { toast(e.message, 'error'); }
}

// ── 创建/编辑弹窗 ────────────────────────────────────────

function showCreateModal() {
    document.getElementById('edit-mode').value = '';
    document.getElementById('modal-title').textContent = '创建新客户';
    document.getElementById('btn-submit').textContent = '创建并启动';
    document.getElementById('f-name').disabled = false;
    document.getElementById('f-template').disabled = false;
    document.getElementById('form-client').reset();
    showModal('modal-create');
}

async function editClient(name) {
    try {
        const c = await api(`/clients/${name}`);
        document.getElementById('edit-mode').value = name;
        document.getElementById('modal-title').textContent = `编辑：${name}`;
        document.getElementById('btn-submit').textContent = '保存配置';
        document.getElementById('f-name').value = name;
        document.getElementById('f-name').disabled = true;
        document.getElementById('f-template').disabled = true;
        document.getElementById('f-port').value = c.PORT || '';
        document.getElementById('f-feishu-id').value = c.FEISHU_APP_ID || '';
        document.getElementById('f-feishu-secret').value = c.FEISHU_APP_SECRET || '';
        document.getElementById('f-feishu-domain').value = c.FEISHU_DOMAIN || 'feishu';
        // 模型相关
        const modelSelect = document.getElementById('f-model');
        if (c.MODEL_PRESET) modelSelect.value = c.MODEL_PRESET;
        onModelChange();
        // 填入已有的 API Key（尝试多种 envKey）
        const keyInput = document.getElementById('f-api-key');
        const selectedModel = modelPresets.find(m => m.id === (c.MODEL_PRESET || ''));
        if (selectedModel && selectedModel.envKey && c[selectedModel.envKey]) {
            keyInput.value = c[selectedModel.envKey];
        } else {
            keyInput.value = c.ZHIPU_API_KEY || '';
        }
        showModal('modal-create');
    } catch (e) { toast(e.message, 'error'); }
}

async function submitClient(event) {
    event.preventDefault();
    const editMode = document.getElementById('edit-mode').value;
    const body = {
        name: document.getElementById('f-name').value,
        port: document.getElementById('f-port').value,
        feishuAppId: document.getElementById('f-feishu-id').value,
        feishuAppSecret: document.getElementById('f-feishu-secret').value,
        feishuDomain: document.getElementById('f-feishu-domain').value,
        template: document.getElementById('f-template').value,
        modelId: document.getElementById('f-model').value || undefined,
        apiKey: document.getElementById('f-api-key').value,
    };

    try {
        if (editMode) {
            await api(`/clients/${editMode}`, { method: 'PUT', body: JSON.stringify(body) });
            toast('配置已保存，请重启实例以生效', 'success');
        } else {
            await api('/clients', { method: 'POST', body: JSON.stringify(body) });
            toast(`${body.name} 已创建并启动`, 'success');
        }
        hideModal('modal-create');
        loadDashboard(); loadClients();
    } catch (e) { toast(e.message, 'error'); }
}

// ── 日志 ──────────────────────────────────────────────────

function openLogs(name) {
    document.getElementById('logs-title').textContent = `${name} — 实时日志`;
    const el = document.getElementById('log-content');
    el.textContent = '连接中...\n';
    showModal('modal-logs');

    // 关闭之前的连接
    if (logEventSource) logEventSource.close();

    logEventSource = new EventSource(`/api/clients/${name}/logs`);
    logEventSource.onmessage = (e) => {
        el.textContent += e.data + '\n';
        el.scrollTop = el.scrollHeight;
    };
    logEventSource.onerror = () => {
        el.textContent += '\n[连接断开]\n';
        logEventSource.close();
        logEventSource = null;
    };
}

function closeLogs() {
    if (logEventSource) { logEventSource.close(); logEventSource = null; }
    hideModal('modal-logs');
}

// ── 弹窗工具 ─────────────────────────────────────────────

function showModal(id) { document.getElementById(id).classList.add('active'); }
function hideModal(id) { document.getElementById(id).classList.remove('active'); }
function closeModal(event) {
    if (event.target.classList.contains('modal-overlay')) {
        event.target.classList.remove('active');
        if (event.target.id === 'modal-logs') closeLogs();
    }
}

// ── Toast ─────────────────────────────────────────────────

// ── 模型预设 ──────────────────────────────────────────────

async function loadModels() {
    try {
        modelPresets = await api('/models');
        const select = document.getElementById('f-model');
        // 清空旧选项（保留默认）
        while (select.options.length > 1) select.remove(1);
        modelPresets.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            select.appendChild(opt);
        });
    } catch { }
}

function onModelChange() {
    const modelId = document.getElementById('f-model').value;
    const label = document.getElementById('model-key-label');
    const input = document.getElementById('f-api-key');
    if (!modelId) {
        label.textContent = '智谱 API Key';
        input.placeholder = '智谱 API Key';
        return;
    }
    const m = modelPresets.find(p => p.id === modelId);
    if (m) {
        label.textContent = `${m.name} API Key`;
        input.placeholder = `输入 ${m.envKey || 'API_KEY'}`;
    }
}

// ── 导出 ──────────────────────────────────────────────────

function exportClient(name) {
    // 触发浏览器下载 tar.gz
    const a = document.createElement('a');
    a.href = `/api/clients/${name}/export`;
    a.download = `${name}-export.tar.gz`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(`正在导出 ${name}…`, 'success');
}

// ── 导入 ──────────────────────────────────────────────────

function showImportModal() {
    document.getElementById('f-import-file').value = '';
    document.getElementById('f-import-name').value = '';
    document.getElementById('f-import-port').value = '';
    showModal('modal-import');
}

async function submitImport() {
    const fileInput = document.getElementById('f-import-file');
    const name = document.getElementById('f-import-name').value.trim();
    const port = document.getElementById('f-import-port').value.trim();

    if (!fileInput.files.length) return toast('请选择 tar.gz 文件', 'error');
    if (!name || !port) return toast('名称和端口为必填', 'error');

    const btn = document.getElementById('btn-import');
    btn.disabled = true;
    btn.textContent = '导入中…';

    try {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('name', name);
        formData.append('port', port);

        const res = await fetch('/api/clients/import', {
            method: 'POST',
            body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '导入失败');

        toast(`✅ ${name} 导入成功并已启动`, 'success');
        hideModal('modal-import');
        loadDashboard(); loadClients();
    } catch (e) {
        toast('导入失败：' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '📥 导入并启动';
    }
}

// ── Toast ─────────────────────────────────────────────────

function toast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.remove(); }, 4000);
}
