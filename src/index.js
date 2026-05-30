import { initDatabase, cleanupOldData, getMetricsHistory, getAggregatedHistory } from './database/schema.js';
import { handleAdminAPI } from './handlers/admin.js';
import { handleAdminUI } from './handlers/admin-ui.js';
import { serveFrontend } from './handlers/frontend.js';
import { handleUpdate } from './handlers/update.js';
import { handleDashboard, handleServerDetail, handleServerAPI, handleServersAPI } from './handlers/dashboard.js';
import { loadSettings } from './utils/settings.js';
import { checkAuth, authResponse } from './middleware/auth.js';

const historyCache = new Map();
const CACHE_TTL = 60000;
const MAX_HOURS = 72;

async function fetchHistoryData(env, request, id, hours, columns) {
  if (!id) return new Response('Missing ID', { status: 400 });
  
  const clampedHours = Math.min(hours, MAX_HOURS);
  
  const cacheKey = `${id}_${clampedHours}_${columns}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return new Response(JSON.stringify(cached.data), {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
    });
  }
  
  const data = await getMetricsHistory(env.DB, id, clampedHours, columns);
  
  historyCache.set(cacheKey, {
    timestamp: Date.now(),
    data: data
  });
  
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
  });
}

async function fetchAggregatedHistoryData(env, request, id, hours, columns) {
  if (!id) return new Response('Missing ID', { status: 400 });
  
  const clampedHours = Math.min(hours, MAX_HOURS);
  
  const cacheKey = `agg_${id}_${clampedHours}_${columns}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return new Response(JSON.stringify(cached.data), {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
    });
  }
  
  const data = await getAggregatedHistory(env.DB, id, clampedHours, columns);
  
  historyCache.set(cacheKey, {
    timestamp: Date.now(),
    data: data
  });
  
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
  });
}

export default {
  async fetch(request, env, ctx) {
    await initDatabase(env.DB);

    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    async function handleManualCleanup() {
      if (!checkAuth(request, env)) {
        const sys = await loadSettings(env.DB);
        return authResponse(sys.admin_title);
      }
      
      const result = await cleanupOldData(env.DB, true);
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const routes = [
      { method: 'GET', path: '/clear', handler: handleManualCleanup },
      { method: 'GET', path: '/', handler: async () => serveFrontend(request, env) },
      { method: 'GET', path: '/dashboard', handler: async () => serveFrontend(request, env) },
      { method: 'GET', path: '/dashboard.html', handler: async () => serveFrontend(request, env) },
      { method: 'GET', path: '/server', handler: async () => serveFrontend(request, env) },
      { method: 'GET', path: '/server.html', handler: async () => serveFrontend(request, env) },
      { method: 'GET', path: '/admin', handler: async () => serveFrontend(request, env) },
      { method: 'GET', path: '/admin.html', handler: async () => serveFrontend(request, env) },
      { method: 'POST', path: '/admin/api', handler: async () => {
        const sys = await loadSettings(env.DB);
        return handleAdminAPI(request, env, sys);
      }},
      { method: 'POST', path: '/update', handler: () => handleUpdate(request, env, ctx) },
      { method: 'GET', path: '/api/server', handler: async () => {
        const sys = await loadSettings(env.DB);
        return handleServerAPI(request, env, sys);
      }},
      { method: 'GET', path: '/api/servers', handler: async () => {
        const sys = await loadSettings(env.DB);
        return handleServersAPI(request, env, sys);
      }},
      { method: 'GET', path: '/api/history', handler: async () => {
        const id = url.searchParams.get('id');
        const metric = url.searchParams.get('metric') || 'cpu';
        const hours = parseFloat(url.searchParams.get('hours') || '24');
        return fetchHistoryData(env, request, id, hours, metric);
      }},
      { method: 'GET', path: '/api/history/all', handler: async () => {
        const id = url.searchParams.get('id');
        const hours = parseFloat(url.searchParams.get('hours') || '24');
        const allColumns = 'cpu, ram, disk, processes, net_in_speed, net_out_speed, tcp_conn, udp_conn, ping_ct, ping_cu, ping_cm, ping_bd, swap_total, swap_used';
        return fetchHistoryData(env, request, id, hours, allColumns);
      }},
      { method: 'GET', path: '/api/history/agg', handler: async () => {
        const id = url.searchParams.get('id');
        const hours = parseFloat(url.searchParams.get('hours') || '24');
        const allColumns = 'cpu, ram, disk, processes, net_in_speed, net_out_speed, tcp_conn, udp_conn, ping_ct, ping_cu, ping_cm, ping_bd, swap_total, swap_used';
        return fetchAggregatedHistoryData(env, request, id, hours, allColumns);
      }},
      { method: 'GET', path: '/', handler: async () => {
        const sys = await loadSettings(env.DB);
        const viewId = url.searchParams.get('id');
        if (viewId) {
          return handleServerDetail(request, env, sys, viewId);
        }
        return handleDashboard(request, env, sys);
      }}
    ];

    for (const route of routes) {
      if (route.method === method && route.path === path) {
        return route.handler();
      }
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    await initDatabase(env.DB);
    
    console.log('[Cron] 开始执行定时清理任务');
    await cleanupOldData(env.DB);
    console.log('[Cron] 定时清理任务完成');
  }
};