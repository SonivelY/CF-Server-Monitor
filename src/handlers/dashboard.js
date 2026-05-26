import { checkAuth, authResponse } from '../middleware/auth.js';
import { formatBytes, getPingColor } from '../utils/format.js';
import { getThemeStyles, getFooterHtml } from '../themes/styles.js';
import { handleServerDetail } from './server-detail.js';

export async function handleServerAPI(request, env, sys) {
  if (sys.is_public !== 'true' && !checkAuth(request, env)) {
    return authResponse(sys.site_title);
  }
  
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  
  if (!id) return new Response('Missing ID', { status: 400 });
  
  const server = await env.DB.prepare('SELECT * FROM servers WHERE id = ?').bind(id).first();
  if (!server) return new Response('Not Found', { status: 404 });
  
  return new Response(JSON.stringify(server), { 
    headers: { 'Content-Type': 'application/json' } 
  });
}

export async function handleDashboard(request, env, sys) {
  if (sys.is_public !== 'true' && !checkAuth(request, env)) {
    return authResponse(sys.site_title);
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM servers ORDER BY server_group, name'
  ).all();
  
  const now = Date.now();

  // 统计全局数据
  let globalOnline = 0, globalOffline = 0;
  let globalSpeedIn = 0, globalSpeedOut = 0;
  let globalNetTx = 0, globalNetRx = 0;
  const groups = {};
  const countryStats = {};

  if (results && results.length > 0) {
    for (const server of results) {
      const lastUpdated = new Date(server.last_updated).getTime();
      const isOnline = (now - lastUpdated) < 120000;
      
      if (isOnline) {
        globalOnline++;
        globalSpeedIn += parseFloat(server.net_in_speed) || 0;
        globalSpeedOut += parseFloat(server.net_out_speed) || 0;
      } else {
        globalOffline++;
      }
      
      const rx_val = sys.auto_reset_traffic === 'true' 
        ? parseFloat(server.monthly_rx || 0) 
        : parseFloat(server.net_rx || 0);
      const tx_val = sys.auto_reset_traffic === 'true' 
        ? parseFloat(server.monthly_tx || 0) 
        : parseFloat(server.net_tx || 0);

      globalNetTx += tx_val;
      globalNetRx += rx_val;

      // 分组
      const grpName = server.server_group || '默认分组';
      if (!groups[grpName]) groups[grpName] = [];
      groups[grpName].push(server);

      // 国家统计
      let cCodeMap = (server.country || 'xx').toUpperCase();
      if (cCodeMap === 'TW') cCodeMap = 'CN';
      if (cCodeMap !== 'XX') {
        countryStats[cCodeMap] = (countryStats[cCodeMap] || 0) + 1;
      }
    }
  }

  // 生成过滤器标签
  let filterTagsHtml = `<span class="filter-tag active" data-filter="all">[All] ${results.length}</span>`;
  for (const [code, count] of Object.entries(countryStats).sort()) {
    filterTagsHtml += `<span class="filter-tag" data-filter="${code.toLowerCase()}">
      <img src="https://flagcdn.com/16x12/${code.toLowerCase()}.png" alt="${code}"> ${code} [${count}]
    </span>`;
  }

  // 生成卡片和表格内容
  let cardContentHtml = '';
  let tableBodyHtml = '';

  if (Object.keys(groups).length === 0) {
    cardContentHtml = '<div class="empty-state">[!] 暂无服务器，请在 <a href="/admin" style="color: var(--accent-cyan);">后台管理</a> 中添加</div>';
  } else {
    for (const [grpName, grpServers] of Object.entries(groups)) {
      cardContentHtml += `<div class="group-section">
        <div class="group-header" data-group="${grpName}">
          <span class="prompt-sign">#</span> ${grpName} 
          <span class="group-count">[${grpServers.length}]</span>
        </div>
        <div class="servers-grid">`;
      
      for (const server of grpServers) {
        const lastUpdated = new Date(server.last_updated).getTime();
        const isOnline = (now - lastUpdated) < 120000;
        const statusColor = isOnline ? 'var(--accent-green)' : 'var(--accent-red)';
        const statusText = isOnline ? 'ONLINE' : 'OFFLINE';
        
        const cpu = parseFloat(server.cpu || 0).toFixed(1);
        const ram = parseFloat(server.ram || 0).toFixed(1);
        const disk = parseFloat(server.disk || 0).toFixed(1);
        const netInSpeed = formatBytes(server.net_in_speed);
        const netOutSpeed = formatBytes(server.net_out_speed);
        const monthlyRx = formatBytes(server.monthly_rx);
        const monthlyTx = formatBytes(server.monthly_tx);
        
        const cCode = (server.country || 'xx').toLowerCase();
        const flagHtml = cCode !== 'xx' 
          ? `<img src="https://flagcdn.com/24x18/${cCode}.png" alt="${cCode}" style="vertical-align: middle; margin-right: 5px; border-radius: 2px; filter: brightness(0.9);">` 
          : '🏳️';
        
        // 元数据
        let metaHtml = '';
        if (sys.show_price === 'true') {
          metaHtml += `<div class="card-meta">💰 ${server.price || '免费'}</div>`;
        }
        if (sys.show_expire === 'true') {
          let expireText = '永久';
          if (server.expire_date) {
            const expTime = new Date(server.expire_date).getTime();
            if (!isNaN(expTime)) {
              const diff = expTime - now;
              expireText = diff > 0 
                ? Math.ceil(diff / (1000 * 3600 * 24)) + 'd' 
                : '<span style="color:var(--accent-red);">EXPIRED</span>';
            }
          }
          metaHtml += `<div class="card-meta">📅 ${expireText}</div>`;
        }

        // 徽章
        let badgesHtml = '';
        if (sys.show_bw === 'true' && server.bandwidth) 
          badgesHtml += `<span class="badge badge-bw">${server.bandwidth}</span>`;
        if (sys.show_tf === 'true' && server.traffic_limit) 
          badgesHtml += `<span class="badge badge-tf">${server.traffic_limit}</span>`;
        if (server.ip_v4 === '1') badgesHtml += `<span class="badge badge-v4">IPv4</span>`;
        if (server.ip_v6 === '1') badgesHtml += `<span class="badge badge-v6">IPv6</span>`;

        // 延迟信息
        const pingHtml = `
          <div class="ping-panel">
            <div class="ping-item"><span class="ping-label">CT</span><span class="ping-value" style="color:${getPingColor(server.ping_ct)}">${server.ping_ct === '0' ? 'TIMEOUT' : server.ping_ct + 'ms'}</span></div>
            <div class="ping-item"><span class="ping-label">CU</span><span class="ping-value" style="color:${getPingColor(server.ping_cu)}">${server.ping_cu === '0' ? 'TIMEOUT' : server.ping_cu + 'ms'}</span></div>
            <div class="ping-item"><span class="ping-label">CM</span><span class="ping-value" style="color:${getPingColor(server.ping_cm)}">${server.ping_cm === '0' ? 'TIMEOUT' : server.ping_cm + 'ms'}</span></div>
            <div class="ping-item"><span class="ping-label">BD</span><span class="ping-value" style="color:${getPingColor(server.ping_bd)}">${server.ping_bd === '0' ? 'TIMEOUT' : server.ping_bd + 'ms'}</span></div>
          </div>`;

        cardContentHtml += `
          <a href="/?id=${server.id}" class="server-card" data-country="${cCode}">
            <div class="server-card-header">
              <div class="server-identity">
                <div class="status-indicator" style="background:${statusColor}; box-shadow: 0 0 8px ${statusColor};"></div>
                ${flagHtml}
                <span class="server-name">${server.name}</span>
              </div>
              <span class="status-label" style="color:${statusColor}; border-color:${statusColor};">${statusText}</span>
            </div>
            
            <div class="server-meta">
              ${metaHtml}
              <div class="card-badges">${badgesHtml}</div>
            </div>
            
            <div class="server-stats">
              <div class="stat-row">
                <span class="stat-key">CPU</span>
                <div class="stat-bar-container">
                  <div class="stat-bar-fill" style="width:${cpu}%; background: var(--accent-cyan);"></div>
                </div>
                <span class="stat-value">${cpu}%</span>
              </div>
              <div class="stat-row">
                <span class="stat-key">RAM</span>
                <div class="stat-bar-container">
                  <div class="stat-bar-fill" style="width:${ram}%; background: var(--accent-purple);"></div>
                </div>
                <span class="stat-value">${ram}%</span>
              </div>
              <div class="stat-row">
                <span class="stat-key">DISK</span>
                <div class="stat-bar-container">
                  <div class="stat-bar-fill" style="width:${disk}%; background: var(--accent-green);"></div>
                </div>
                <span class="stat-value">${disk}%</span>
              </div>
              <div class="stat-row">
                <span class="stat-key">NET</span>
                <span class="net-down">▼ ${netInSpeed}/s</span>
                <span class="net-up">▲ ${netOutSpeed}/s</span>
              </div>
              <div class="stat-row">
                <span class="stat-key">TRF</span>
                <span class="net-down">▼ ${monthlyRx}</span>
                <span class="net-up">▲ ${monthlyTx}</span>
              </div>
            </div>
            
            ${pingHtml}
          </a>`;

        tableBodyHtml += `
          <tr onclick="window.location.href='/?id=${server.id}'" style="cursor:pointer;" data-country="${cCode}">
            <td style="text-align:center;"><div class="status-indicator" style="background:${statusColor}; display:inline-block; margin:0; width:8px; height:8px;"></div></td>
            <td><b>${server.name}</b></td>
            <td>${flagHtml} ${cCode.toUpperCase()}</td>
            <td><span class="os-label">${server.os || 'Linux'} / ${server.arch || 'KVM'}</span></td>
            <td>
              <div class="table-stat">
                <div class="stat-bar-container" style="width:60px;">
                  <div class="stat-bar-fill" style="width:${cpu}%; background: var(--accent-cyan);"></div>
                </div>
                <span>${cpu}%</span>
              </div>
            </td>
            <td>
              <div class="table-stat">
                <div class="stat-bar-container" style="width:60px;">
                  <div class="stat-bar-fill" style="width:${ram}%; background: var(--accent-purple);"></div>
                </div>
                <span>${ram}%</span>
              </div>
            </td>
            <td>
              <div class="table-stat">
                <div class="stat-bar-container" style="width:60px;">
                  <div class="stat-bar-fill" style="width:${disk}%; background: var(--accent-green);"></div>
                </div>
                <span>${disk}%</span>
              </div>
            </td>
            <td>${netInSpeed}/s</td>
            <td>${netOutSpeed}/s</td>
            <td>${monthlyRx}</td>
            <td>${monthlyTx}</td>
            <td class="update-time">${Math.round((now - lastUpdated)/1000)}s ago</td>
          </tr>`;
      }
      cardContentHtml += `</div></div>`;
    }
  }

  const themeStyles = getThemeStyles(sys);
  
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sys.site_title}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
  <script id="map-data" type="application/json">${JSON.stringify(countryStats)}</script>
  ${sys.custom_head || ''}
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
    
    :root {
      --bg-primary: #0a0e14;
      --bg-secondary: #12171f;
      --bg-card: #151b24;
      --bg-hover: #1a2230;
      --border-color: #1e2a3a;
      --border-active: #2a3a4f;
      --text-primary: #d3dae3;
      --text-secondary: #8999af;
      --text-muted: #5c6d82;
      --accent-green: #00d4aa;
      --accent-blue: #4da6ff;
      --accent-purple: #b392f0;
      --accent-pink: #f778ba;
      --accent-yellow: #ffb870;
      --accent-red: #f85149;
      --accent-cyan: #39d2c0;
      --terminal-font: 'JetBrains Mono', 'Courier New', monospace;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body { 
      font-family: var(--terminal-font);
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.5;
      position: relative;
      font-size: 13px;
    }
    
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0, 0, 0, 0.03) 2px,
        rgba(0, 0, 0, 0.03) 4px
      );
      pointer-events: none;
      z-index: 9999;
    }
    
    .container { max-width: 1500px; margin: 0 auto; padding: 16px; position: relative; }
    
    /* 终端顶部栏 */
    .terminal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px 6px 0 0;
      margin-bottom: 0;
      font-size: 12px;
      color: var(--text-secondary);
    }
    
    .terminal-dots {
      display: flex;
      gap: 8px;
    }
    
    .terminal-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    
    .terminal-dot.red { background: #ff5f56; }
    .terminal-dot.yellow { background: #ffbd2e; }
    .terminal-dot.green { background: #27c93f; }
    
    .terminal-title {
      color: var(--text-primary);
      font-weight: 600;
      font-size: 12px;
    }
    
    /* 导航区域 */
    .nav-area {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-top: none;
      padding: 16px;
      margin-bottom: 20px;
    }
    
    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    
    .site-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--accent-green);
      text-shadow: 0 0 10px rgba(0, 212, 170, 0.3);
    }
    
    .controls-group {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    
    .view-toggle {
      display: flex;
      gap: 2px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 3px;
    }
    
    .toggle-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      font-family: var(--terminal-font);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: all 0.2s;
    }
    
    .toggle-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    
    .toggle-btn.active {
      background: var(--accent-green);
      color: #000;
    }
    
    .admin-link {
      padding: 6px 14px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--accent-cyan);
      text-decoration: none;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: all 0.2s;
    }
    
    .admin-link:hover {
      background: var(--bg-hover);
      border-color: var(--border-active);
    }
    
    /* 过滤器栏 */
    .filter-bar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    
    .filter-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
      font-family: var(--terminal-font);
    }
    
    .filter-tag:hover {
      border-color: var(--border-active);
      color: var(--text-primary);
    }
    
    .filter-tag.active {
      background: var(--accent-green);
      color: #000;
      border-color: var(--accent-green);
      font-weight: 600;
    }
    
    .filter-tag img {
      border-radius: 1px;
    }
    
    /* 全局统计 */
    .global-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1px;
      background: var(--border-color);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 20px;
    }
    
    .stat-item {
      background: var(--bg-card);
      padding: 14px 16px;
      text-align: center;
    }
    
    .stat-label {
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 6px;
    }
    
    .stat-main-value {
      font-size: 20px;
      font-weight: 700;
      color: var(--accent-cyan);
      text-shadow: 0 0 8px rgba(57, 210, 192, 0.3);
    }
    
    .stat-sub-info {
      font-size: 11px;
      color: var(--text-secondary);
      margin-top: 4px;
    }
    
    /* 视图面板 */
    .view-panel {
      display: none;
    }
    
    .view-panel.active {
      display: block;
    }
    
    /* 分组标题 */
    .group-section {
      margin-bottom: 24px;
    }
    
    .group-header {
      font-size: 13px;
      font-weight: 600;
      color: var(--accent-green);
      padding: 8px 0;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border-color);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .prompt-sign {
      color: var(--text-muted);
    }
    
    .group-count {
      color: var(--text-muted);
      font-weight: 400;
      font-size: 11px;
    }
    
    /* 服务器卡片网格 */
    .servers-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 12px;
    }
    
    /* 服务器卡片 */
    .server-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 16px;
      text-decoration: none;
      color: inherit;
      transition: all 0.2s;
      display: block;
    }
    
    .server-card:hover {
      border-color: var(--accent-cyan);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      transform: translateY(-2px);
    }
    
    .server-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    
    .server-identity {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    
    .server-name {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-primary);
    }
    
    .status-label {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 8px;
      border: 1px solid;
      border-radius: 3px;
      letter-spacing: 1px;
    }
    
    .server-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      font-size: 11px;
      color: var(--text-muted);
    }
    
    .card-meta {
      display: flex;
      gap: 12px;
    }
    
    .card-badges {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    
    .badge {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .badge-bw { background: var(--accent-blue); color: #000; }
    .badge-tf { background: var(--accent-green); color: #000; }
    .badge-v4 { background: var(--accent-purple); color: #000; }
    .badge-v6 { background: var(--accent-pink); color: #000; }
    
    /* 统计条 */
    .server-stats {
      margin-bottom: 12px;
    }
    
    .stat-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    
    .stat-key {
      font-size: 10px;
      color: var(--text-muted);
      width: 35px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .stat-bar-container {
      flex: 1;
      height: 4px;
      background: var(--border-color);
      border-radius: 2px;
      overflow: hidden;
    }
    
    .stat-bar-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    
    .stat-value {
      font-size: 11px;
      color: var(--text-secondary);
      min-width: 40px;
      text-align: right;
      font-weight: 600;
    }
    
    .net-down { color: var(--accent-green); font-size: 10px; }
    .net-up { color: var(--accent-blue); font-size: 10px; }
    
    /* Ping面板 */
    .ping-panel {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
      border: 1px solid var(--border-color);
    }
    
    .ping-item {
      text-align: center;
    }
    
    .ping-label {
      font-size: 9px;
      color: var(--text-muted);
      display: block;
      margin-bottom: 2px;
    }
    
    .ping-value {
      font-size: 10px;
      font-weight: 700;
    }
    
    /* 表格视图 */
    .table-container {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      overflow: hidden;
    }
    
    .terminal-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    
    .terminal-table th {
      background: var(--bg-card);
      padding: 10px 12px;
      text-align: left;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border-color);
    }
    
    .terminal-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
      vertical-align: middle;
    }
    
    .terminal-table tr:hover {
      background: var(--bg-hover);
    }
    
    .table-stat {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .os-label {
      font-size: 11px;
      color: var(--text-secondary);
    }
    
    .update-time {
      color: var(--text-muted);
      font-size: 11px;
    }
    
    /* 地图视图 */
    .map-wrapper {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 4px;
    }
    
    #map-container {
      width: 100%;
      height: 500px;
      border-radius: 4px;
      background: #1a1a2e;
    }
    
    /* 空状态 */
    .empty-state {
      text-align: center;
      color: var(--text-muted);
      padding: 40px;
      font-size: 13px;
    }
    
    /* 滚动条 */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    
    ::-webkit-scrollbar-track {
      background: var(--bg-primary);
    }
    
    ::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 4px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background: var(--border-active);
    }
    
    /* 响应式 */
    @media (max-width: 768px) {
      .container { padding: 8px; }
      .servers-grid { grid-template-columns: 1fr; }
      .global-stats { grid-template-columns: 1fr; }
      .ping-panel { grid-template-columns: repeat(2, 1fr); }
    }
    
    ${themeStyles}
  </style>
</head>
<body class="${sys.theme || 'theme1'}">
  <div class="container">
    <!-- 终端顶部模拟 -->
    <div class="terminal-header">
      <div class="terminal-dots">
        <span class="terminal-dot red"></span>
        <span class="terminal-dot yellow"></span>
        <span class="terminal-dot green"></span>
      </div>
      <div class="terminal-title">
        dashboard — ${sys.site_title}
      </div>
      <div></div>
    </div>
    
    <!-- 导航区域 -->
    <div class="nav-area">
      <div class="header-row">
        <div class="site-title">$ ./${sys.site_title}</div>
        <div class="controls-group">
          <div class="view-toggle">
            <button class="toggle-btn active" id="btn-card" onclick="switchView('card')">
              ▣ CARDS
            </button>
            <button class="toggle-btn" id="btn-table" onclick="switchView('table')">
              ≡ TABLE
            </button>
            <button class="toggle-btn" id="btn-map" onclick="switchView('map')">
              ◉ MAP
            </button>
          </div>
          <a href="/admin" class="admin-link">⚙ ${sys.admin_title}</a>
        </div>
      </div>
      
      <div class="filter-bar" id="ajax-filters">
        ${filterTagsHtml}
      </div>
    </div>

    <!-- 全局统计 -->
    <div class="global-stats" id="ajax-stats">
      <div class="stat-item">
        <div class="stat-label">Total Servers</div>
        <div class="stat-main-value">${results.length}</div>
        <div class="stat-sub-info">
          <span style="color:var(--accent-green);">ON:${globalOnline}</span> | 
          <span style="color:var(--accent-red);">OFF:${globalOffline}</span>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label">
          Total Traffic ${sys.auto_reset_traffic === 'true' ? '[MONTH]' : ''}
        </div>
        <div class="stat-main-value" style="font-size:16px;">${formatBytes(globalNetRx)} ↓ | ↑ ${formatBytes(globalNetTx)}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Real-time Speed</div>
        <div class="stat-main-value" style="font-size:16px;">
          <span style="color:var(--accent-green);">↓ ${formatBytes(globalSpeedIn)}/s</span> | 
          <span style="color:var(--accent-blue);">↑ ${formatBytes(globalSpeedOut)}/s</span>
        </div>
      </div>
    </div>

    <!-- 卡片视图 -->
    <div id="view-card" class="view-panel active">
      <div id="ajax-cards">${cardContentHtml}</div>
    </div>

    <!-- 表格视图 -->
    <div id="view-table" class="view-panel">
      <div class="table-container">
        <table class="terminal-table">
          <thead>
            <tr>
              <th>STAT</th>
              <th>HOSTNAME</th>
              <th>REGION</th>
              <th>ARCH/OS</th>
              <th>CPU</th>
              <th>RAM</th>
              <th>DISK</th>
              <th>↓ DL</th>
              <th>↑ UL</th>
              <th>↓ RX</th>
              <th>↑ TX</th>
              <th>UPDATE</th>
            </tr>
          </thead>
          <tbody id="ajax-table">
            ${tableBodyHtml || '<tr><td colspan="12" style="text-align:center; color:var(--text-muted);">[*] No data available</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <!-- 地图视图 -->
    <div id="view-map" class="view-panel">
      <div class="map-wrapper">
        <div id="map-container"></div>
      </div>
    </div>
    
    ${getFooterHtml()}
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
  <script>
    let mapInitialized = false;
    let currentFilter = 'all';

    function switchView(viewName) {
      document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
      document.getElementById('btn-' + viewName).classList.add('active');
      document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
      document.getElementById('view-' + viewName).classList.add('active');
      localStorage.setItem('monitor_preferred_view', viewName);

      if (viewName === 'map' && !mapInitialized) {
        initMap();
        mapInitialized = true;
      } else if (viewName === 'map' && window.myMap) {
        setTimeout(() => window.myMap.invalidateSize(), 100);
      }
    }

    // 国家过滤器
    document.querySelectorAll('.filter-tag').forEach(tag => {
      tag.addEventListener('click', function() {
        document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentFilter = this.dataset.filter;
        applyFilter();
      });
    });

    function applyFilter() {
      const cards = document.querySelectorAll('.server-card');
      const rows = document.querySelectorAll('#ajax-table tr');
      
      cards.forEach(card => {
        const country = card.dataset.country;
        card.style.display = (currentFilter === 'all' || country === currentFilter) ? '' : 'none';
      });
      
      rows.forEach(row => {
        const country = row.dataset.country;
        if (country !== undefined) {
          row.style.display = (currentFilter === 'all' || country === currentFilter) ? '' : 'none';
        }
      });
      
      // 隐藏空分组
      document.querySelectorAll('.group-section').forEach(section => {
        const visibleCards = section.querySelectorAll('.server-card:not([style*="display: none"])');
        section.style.display = visibleCards.length === 0 ? 'none' : '';
      });
    }

    // 地图初始化
    const countryCoords = {
      'US': [37.09, -95.71], 'CN': [35.86, 104.19], 'JP': [36.20, 138.25], 'HK': [22.31, 114.16],
      'SG': [1.35, 103.81], 'KR': [35.90, 127.76], 'DE': [51.16, 10.45], 'GB': [55.37, -3.43],
      'NL': [52.13, 5.29], 'FR': [46.22, 2.21], 'CA': [56.13, -106.34], 'AU': [-25.27, 133.77],
      'IN': [20.59, 78.96], 'BR': [-14.23, -51.92], 'RU': [61.52, 105.31], 'ZA': [-30.55, 22.93],
      'TW': [23.69, 120.96], 'IT': [41.87, 12.56], 'SE': [60.12, 18.64], 'CH': [46.81, 8.22],
      'ES': [40.46, -3.74], 'PL': [51.91, 19.14], 'FI': [61.92, 25.74], 'NO': [60.47, 8.46],
      'DK': [56.26, 9.50], 'IE': [53.14, -7.69], 'AT': [47.51, 14.55], 'TR': [38.96, 35.24],
      'AE': [23.42, 53.84], 'MY': [4.21, 101.97], 'TH': [15.87, 100.99], 'VN': [14.05, 108.27],
      'PH': [12.87, 121.77], 'ID': [-0.78, 113.92]
    };

    const iso2To3 = {
      "US":"USA","CN":"CHN","JP":"JPN","HK":"HKG","SG":"SGP","KR":"KOR","DE":"DEU","GB":"GBR",
      "NL":"NLD","FR":"FRA","CA":"CAN","AU":"AUS","IN":"IND","BR":"BRA","RU":"RUS","ZA":"ZAF",
      "TW":"TWN","IT":"ITA","SE":"SWE","CH":"CHE","ES":"ESP","PL":"POL","FI":"FIN","NO":"NOR",
      "DK":"DNK","IE":"IRL","AT":"AUT","TR":"TUR","AE":"ARE","MY":"MYS","TH":"THA","VN":"VNM",
      "PH":"PHL","ID":"IDN"
    };

    let markersLayer, geoJsonLayer, worldGeoJson = null, currentMapDataStr = "";

    async function initMap() {
      window.myMap = L.map('map-container', {
        zoomControl: false,
        attributionControl: false,
        minZoom: 1
      }).setView([30, 10], 2);

      // 添加终端风格的缩放控制
      L.control.zoom({
        position: 'bottomright'
      }).addTo(window.myMap);

      try {
        const res = await fetch('https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json');
        worldGeoJson = await res.json();
        drawMarkers();
      } catch (e) {
        console.error("[ERROR] Map load failed", e);
      }
    }

    function drawMarkers() {
      if(!window.myMap || !worldGeoJson) return;

      const newDataStr = document.getElementById('map-data').textContent;
      if (currentMapDataStr === newDataStr) return;
      currentMapDataStr = newDataStr;

      if(geoJsonLayer) window.myMap.removeLayer(geoJsonLayer);
      if(markersLayer) markersLayer.clearLayers();
      else markersLayer = L.layerGroup().addTo(window.myMap);

      const data = JSON.parse(newDataStr);
      const isDark = true; // Terminal风格始终为暗色

      const activeIso3 = {};
      for (const code in data) {
        if (iso2To3[code]) activeIso3[iso2To3[code]] = true;
      }

      geoJsonLayer = L.geoJSON(worldGeoJson, {
        style: function(feature) {
          const isActive = activeIso3[feature.id];
          return {
            fillColor: isActive ? '#00d4aa' : '#1e2a3a',
            weight: 1,
            opacity: 0.8,
            color: '#0a0e14',
            fillOpacity: isActive ? 0.4 : 0.2
          };
        }
      }).addTo(window.myMap);

      for (const [code, count] of Object.entries(data)) {
        if(countryCoords[code]) {
          const icon = L.divIcon({ 
            className: 'custom-map-marker', 
            html: '<div style="background:#00d4aa; color:#000; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold; border:2px solid #0a0e14; box-shadow:0 0 10px rgba(0,212,170,0.5); font-family:JetBrains Mono,monospace;">' + count + '</div>', 
            iconSize: [22,22] 
          });
          L.marker(countryCoords[code], {icon: icon}).addTo(markersLayer);
        }
      }
    }

    // 恢复上次视图
    document.addEventListener('DOMContentLoaded', () => {
      const savedView = localStorage.getItem('monitor_preferred_view') || 'card';
      switchView(savedView);
    });

    // AJAX 自动刷新
    setInterval(async () => {
      try {
        const res = await fetch(location.href);
        const htmlText = await res.text();
        const parser = new DOMParser();
        const newDoc = parser.parseFromString(htmlText, 'text/html');
        
        document.getElementById('ajax-stats').innerHTML = newDoc.getElementById('ajax-stats').innerHTML;
        document.getElementById('ajax-cards').innerHTML = newDoc.getElementById('ajax-cards').innerHTML;
        document.getElementById('ajax-table').innerHTML = newDoc.getElementById('ajax-table').innerHTML;
        document.getElementById('ajax-filters').innerHTML = newDoc.getElementById('ajax-filters').innerHTML;
        document.getElementById('map-data').textContent = newDoc.getElementById('map-data').textContent;
        
        applyFilter();
        drawMarkers();
      } catch (e) {
        console.log('[INFO] Refresh pending...');
      }
    }, 60000);
  </script>
  ${sys.custom_script || ''}
</body>
</html>`;

  return new Response(html, { 
    headers: { 'Content-Type': 'text/html;charset=UTF-8' } 
  });
}

export { handleServerDetail };