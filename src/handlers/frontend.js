const FRONTEND_FILES = {
  'dashboard.html': null,
  'server.html': null,
  'admin.html': null
};

let filesCache = null;

async function loadFrontendFiles(env) {
  if (filesCache) return filesCache;

  try {
    const files = {};
    
    // 尝试从 Cloudflare Pages/Asset 绑定读取
    if (env.ASSETS) {
      try {
        for (const filename of Object.keys(FRONTEND_FILES)) {
          try {
            const res = await env.ASSETS.fetch(new Request(`http://static/${filename}`));
            if (res.ok) {
              files[filename] = await res.text();
            }
          } catch (e) {
            // 忽略错误
          }
        }
      } catch (e) {
        console.log('[INFO] No ASSETS binding');
      }
    }

    // 如果有文件直接使用
    if (Object.keys(files).length > 0) {
      filesCache = files;
      return files;
    }

    // 回退到从 GitHub 加载（需修改为您的仓库）
    const baseUrl = 'https://raw.githubusercontent.com/YOUR_USERNAME/CF-Server-Monitor/refs/heads/main/public';

    for (const filename of Object.keys(FRONTEND_FILES)) {
      try {
        const res = await fetch(`${baseUrl}/${filename}`);
        if (res.ok) {
          files[filename] = await res.text();
        }
      } catch (e) {
        console.error(`[WARN] Failed to load ${filename}:`, e);
      }
    }

    filesCache = files;
    return files;
  } catch (e) {
    console.error('[ERROR] Failed to load frontend files:', e);
    return {};
  }
}

export async function serveFrontend(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  let filename;

  if (path === '/' || path === '/dashboard' || path === '/dashboard.html') {
    filename = 'dashboard.html';
  } else if (path === '/server' || path === '/server.html') {
    filename = 'server.html';
  } else if (path === '/admin' || path === '/admin.html') {
    // Admin 页面由前端自己处理认证，不再使用 Basic Auth 弹窗
    filename = 'admin.html';
  } else {
    return new Response('Not Found', { status: 404 });
  }

  const files = await loadFrontendFiles(env);
  const html = files[filename];

  if (html) {
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=300'
      }
    });
  }

  return new Response('Frontend not available. Please deploy to Cloudflare Pages or configure ASSETS binding.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' }
  });
}
