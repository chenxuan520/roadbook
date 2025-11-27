/**
 * 配置区域
 */
const UPSTREAM_HOST = 'nominatim.openstreetmap.org'; // 目标域名
const UPSTREAM_PROTOCOL = 'https:'; // 目标协议

// 伪装的 Nginx 首页 HTML 代码
const NGINX_HTML = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
    body {
        width: 35em;
        margin: 0 auto;
        font-family: Tahoma, Verdana, Arial, sans-serif;
    }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>`;

export default {
  async fetch(request, _env, _ctx) {
    const url = new URL(request.url);

    // -------------------------------------------------------
    // 1. 伪装逻辑：如果是访问根目录，返回 Nginx 页面
    // -------------------------------------------------------
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/robots.txt') {
      // 对于 robots.txt，返回 User-agent: * Disallow: / 进一步伪装成未配置的服务器
      if (url.pathname === '/robots.txt') {
        return new Response("User-agent: *\nDisallow: /", { status: 200 });
      }
      
      // 返回 Nginx 欢迎页
      return new Response(NGINX_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=UTF-8',
          'Server': 'nginx/1.18.0', // 伪造 Server 头
        },
      });
    }

    // -------------------------------------------------------
    // 2. 代理逻辑：处理 CORS 和 转发
    // -------------------------------------------------------

    // 处理 CORS 预检请求 (OPTIONS)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, User-Agent',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 构建目标 URL
    url.host = UPSTREAM_HOST;
    url.protocol = UPSTREAM_PROTOCOL;

    // 构建新的请求头
    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', UPSTREAM_HOST);
    
    // 设置 User-Agent (OSM 必须)
    // 如果为了隐蔽，可以在这里设置一个非常普通的浏览器 UA
    if (!newHeaders.get('User-Agent') || newHeaders.get('User-Agent').includes('workers')) {
       newHeaders.set('User-Agent', 'Mozilla/5.0 (Compatible; Nominatim-Proxy/1.0; +your_email@example.com)');
    }

    // 发起代理请求
    const newRequest = new Request(url.toString(), {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: 'follow'
    });

    try {
      const response = await fetch(newRequest);

      // 处理响应头，允许跨域
      const newResponseHeaders = new Headers(response.headers);
      newResponseHeaders.set('Access-Control-Allow-Origin', '*');
      newResponseHeaders.set('Access-Control-Expose-Headers', '*');
      
      // 移除可能暴露源站信息的头 (可选)
      newResponseHeaders.delete('Set-Cookie');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newResponseHeaders,
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: 'Proxy Error' }), { 
        status: 502,
        headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
      });
    }
  },
};
