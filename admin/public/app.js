// ============================================================
// OpenClaw 管理面板 - 前端逻辑
// ============================================================

let logEventSource = null;

// ── 初始化 ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    loadClients();
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

function actionButtons(c) {
    if (c.running) {
        return `
      <button class="btn btn-accent btn-sm" onclick="window.open('http://' + location.hostname + ':${c.port}?token=${c.gatewayToken}', '_blank')">控制台</button>
      <button class="btn btn-ghost btn-sm" onclick="stopClient('${c.name}')">停止</button>
      <button class="btn btn-ghost btn-sm" onclick="restartClient('${c.name}')">重启</button>
      <button class="btn btn-ghost btn-sm" onclick="openLogs('${c.name}')">日志</button>
    `;
    }
    return `
    <button class="btn btn-primary btn-sm" onclick="startClient('${c.name}')">启动</button>
    <button class="btn btn-ghost btn-sm" onclick="editClient('${c.name}')">编辑</button>
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
        document.getElementById('f-port').value = c.PORT || '';
        document.getElementById('f-feishu-id').value = c.FEISHU_APP_ID || '';
        document.getElementById('f-feishu-secret').value = c.FEISHU_APP_SECRET || '';
        document.getElementById('f-feishu-domain').value = c.FEISHU_DOMAIN || 'feishu';
        document.getElementById('f-zhipu-key').value = c.ZHIPU_API_KEY || '';
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
        zhipuApiKey: document.getElementById('f-zhipu-key').value,
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

function toast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.remove(); }, 4000);
}
