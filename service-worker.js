const CACHE_NAME = 'qjmy-cache-v1';
const APP_SHELL_CACHE = 'app-shell-v1';
const DATA_CACHE = 'data-cache-v1';

// 1. 应用壳文件 - 必须100%可访问的小文件
const APP_SHELL = [
  './',
  './index.html',
  './test.html',
  './favicon.svg',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  
  // 静态图片资源（缓存优先）
  './image/deepseek.png',
  './image/gemini.png',
  './image/grok.png',
  './image/caoxingyu.png',
  './image/hero.gif',
  
  // 第三方库（缓存优先）
  './js/lib/jquery.min.js',
  './js/lib/jquery.qrcode.min.js',
  './js/lib/semantic.min.js',
  './js/lib/semantic.min.css',
  './js/lib/moment.min.js'
];

// 必须始终缓存的文件（关键数据文件）
const REQUIRED_FILES = ['./data.json', './music.json', './changelog.txt'];

// 静态资源扩展名（缓存优先）
const STATIC_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.svg', // 图片
  '.css', '.js', '.woff', '.woff2', '.ttf', '.eot', // 样式和字体
  '.ico', '.webp', '.avif' // 其他静态文件
];

// 缓存配置管理
const CACHE_CONFIG_KEY = 'qjmy-cache-config';

// 默认缓存配置
const DEFAULT_CACHE_CONFIG = {
  enableMp3Cache: true,
  maxMp3CacheCount: 30,
  maxOtherCacheCount: 50
};

// 当前配置
let cacheConfig = { ...DEFAULT_CACHE_CONFIG };

// 初始化 IndexedDB（用于 Service Worker 存储配置）
async function initIndexedDB() {
  return new Promise((resolve) => {
    if (!self.indexedDB) {
      console.log('SW: IndexedDB 不可用，将使用内存配置');
      resolve(false);
      return;
    }
    
    const request = indexedDB.open('qjmy-sw-config', 1);
    
    request.onerror = () => {
      console.warn('SW: IndexedDB 初始化失败');
      resolve(false);
    };
    
    request.onsuccess = () => {
      console.log('SW: IndexedDB 初始化成功');
      resolve(true);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config');
      }
    };
  });
}

// 从 IndexedDB 获取配置
async function getConfigFromIndexedDB() {
  return new Promise((resolve, reject) => {
    if (!self.indexedDB) {
      resolve(null);
      return;
    }
    
    const request = indexedDB.open('qjmy-sw-config', 1);
    
    request.onerror = () => {
      console.warn('SW: IndexedDB 打开失败');
      resolve(null);
    };
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(['config'], 'readonly');
      const store = transaction.objectStore('config');
      const getRequest = store.get(CACHE_CONFIG_KEY);
      
      getRequest.onsuccess = () => {
        resolve(getRequest.result || null);
      };
      
      getRequest.onerror = () => {
        resolve(null);
      };
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config');
      }
    };
  });
}

// 保存配置到 IndexedDB
async function saveConfigToIndexedDB(config) {
  return new Promise((resolve, reject) => {
    if (!self.indexedDB) {
      console.log('SW: IndexedDB 不可用，无法保存配置');
      resolve(false);
      return;
    }
    
    const request = indexedDB.open('qjmy-sw-config', 1);
    
    request.onerror = () => {
      console.warn('SW: IndexedDB 打开失败，无法保存配置');
      resolve(false);
    };
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(['config'], 'readwrite');
      const store = transaction.objectStore('config');
      const putRequest = store.put(config, CACHE_CONFIG_KEY);
      
      putRequest.onsuccess = () => {
        resolve(true);
      };
      
      putRequest.onerror = () => {
        resolve(false);
      };
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config');
      }
    };
  });
}

// 从主页面获取配置
async function fetchCacheConfigFromPage() {
  try {
    // 尝试从主页面获取配置
    const clients = await self.clients.matchAll();
    
    if (clients && clients.length > 0) {
      // 向每个客户端发送消息请求配置
      for (const client of clients) {
        client.postMessage({
          type: 'request-cache-config'
        });
      }
      console.log('SW: 已向主页面请求缓存配置');
    }
    
    // 同时尝试从 indexedDB 获取（作为备用）
    const config = await getConfigFromIndexedDB();
    if (config) {
      cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...config };
      console.log('SW: 从 IndexedDB 加载缓存配置:', cacheConfig);
    } else {
      // 如果 IndexedDB 也没有配置，使用默认值
      cacheConfig = { ...DEFAULT_CACHE_CONFIG };
      console.log('SW: 使用默认缓存配置:', cacheConfig);
    }
    
  } catch (error) {
    console.warn('SW: 获取缓存配置失败，使用默认配置:', error);
    cacheConfig = { ...DEFAULT_CACHE_CONFIG };
  }
}

// 格式化字节大小
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// 提取路径名（用于导航请求匹配）
function getPathName(request) {
  const url = new URL(request.url);
  return url.pathname;
}

// 检查URL是否为静态资源
function isStaticResource(url) {
  const urlStr = url.toString().toLowerCase();
  return STATIC_EXTENSIONS.some(ext => urlStr.endsWith(ext));
}

// 安装阶段：缓存应用壳和关键文件
self.addEventListener('install', (event) => {
  self.skipWaiting(); // 强制立即接管，不要等待
  
  event.waitUntil(
    (async () => {
      console.log('SW: 开始安装...');
      
      // 初始化配置
      await initIndexedDB();
      await fetchCacheConfigFromPage();
      
      // 只缓存轻量级的 App Shell（不包括 music.json，因为它需要网络优先）
      const appShellCache = await caches.open(APP_SHELL_CACHE);
      console.log('SW: 正在预缓存核心应用壳...');
      
      await Promise.all(
        APP_SHELL.map(url => 
          appShellCache.add(url).catch(err => 
            console.warn(`SW: 非关键文件 ${url} 缓存失败 (可忽略):`, err)
          )
        )
      );
      
      // 注意：data.json 和 music.json 不在安装阶段缓存，而是在首次请求时缓存
      console.log('SW: 核心安装完成 (关键数据文件将在首次加载时缓存)');
    })()
  );
});

// 激活阶段：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // 清理旧版本缓存
      caches.keys().then((keyList) => {
        return Promise.all(
          keyList.map((key) => {
            if (key !== APP_SHELL_CACHE && key !== DATA_CACHE) {
              console.log('SW: 删除旧缓存:', key);
              return caches.delete(key);
            }
          })
        );
      }),
      // 立即接管所有客户端
      self.clients.claim(),
      
      // 初始化缓存清理
      cleanupCache(),
      
      // 加载最新配置
      fetchCacheConfigFromPage()
    ])
  );
});

// 缓存清理函数 - 确保关键数据文件始终保留
async function cleanupCache() {
  try {
    const dataCache = await caches.open(DATA_CACHE);
    const requests = await dataCache.keys();
    
    // 分离必须保留的文件和普通文件
    const requiredUrls = REQUIRED_FILES.map(path => new URL(path, self.location.origin).href);
    const mp3Files = [];
    const otherFiles = [];
    
    for (const request of requests) {
      const url = new URL(request.url);
      const urlStr = url.href;
      
      // 使用更精确的检查：检查路径末尾是否匹配
      const isRequired = requiredUrls.some(requiredUrl => {
        const requiredUrlObj = new URL(requiredUrl);
        return urlStr === requiredUrl || 
               url.pathname === requiredUrlObj.pathname;
      });
      
      if (isRequired) {
        continue;
      } else if (url.pathname.endsWith('.mp3')) {
        mp3Files.push({ request, url: urlStr });
      } else {
        otherFiles.push({ request, url: urlStr });
      }
    }
    
    // 记录清理前的状态
    console.log(`SW: 清理前 - MP3: ${mp3Files.length} 个, 其他: ${otherFiles.length} 个`);
    
    // 如果启用了MP3缓存且超过限制，清理
    if (cacheConfig.enableMp3Cache && mp3Files.length > cacheConfig.maxMp3CacheCount) {
      // 删除最旧的 MP3 文件
      const toDelete = mp3Files.slice(cacheConfig.maxMp3CacheCount);
      await Promise.all(toDelete.map(({ request }) => dataCache.delete(request)));
      console.log(`SW: 清理了 ${toDelete.length} 个MP3缓存，保留了 ${cacheConfig.maxMp3CacheCount} 个`);
    }
    
    // 如果启用了MP3缓存但数量限制为0，清理所有MP3
    if (cacheConfig.enableMp3Cache && cacheConfig.maxMp3CacheCount === 0) {
      await Promise.all(mp3Files.map(({ request }) => dataCache.delete(request)));
      console.log(`SW: MP3缓存限制为0，清理了 ${mp3Files.length} 个MP3缓存`);
    }
    
    // 清理其他文件
    if (otherFiles.length > cacheConfig.maxOtherCacheCount) {
      const toDelete = otherFiles.slice(cacheConfig.maxOtherCacheCount);
      await Promise.all(toDelete.map(({ request }) => dataCache.delete(request)));
      console.log(`SW: 清理了 ${toDelete.length} 个其他缓存文件`);
    }
    
    // 清理后的统计
    const remainingRequests = await dataCache.keys();
    const remainingMp3 = remainingRequests.filter(req => req.url.endsWith('.mp3')).length;
    const remainingRequired = remainingRequests.filter(req => {
      const url = req.url;
      return requiredUrls.some(requiredUrl => url.includes(requiredUrl.split('/').pop()));
    }).length;
    
    console.log(`SW: 清理后 - 总文件: ${remainingRequests.length}, MP3: ${remainingMp3}, 必须文件: ${remainingRequired}`);
    
  } catch (error) {
    console.warn('SW: 缓存清理失败:', error);
  }
}

// 拦截请求：智能缓存策略
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;
  
  const url = new URL(event.request.url);
  const request = event.request;
  
  // --------------------------------------------------------
  // 1. 网络优先 (Network First) - 针对易变内容
  // --------------------------------------------------------
  
  // 1.1 导航请求 (HTML)
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  
  // 1.2 易变数据文件 (changelog, music)
  // 这些文件内容经常变，必须优先看网络
  if (url.pathname.endsWith('music.json') || 
      url.pathname.endsWith('changelog.txt')) {
    event.respondWith(handleMutableData(request));
    return;
  }

  // --------------------------------------------------------
  // 2. 缓存优先 (Cache First) - 针对静态/大文件
  // --------------------------------------------------------

  // 2.1 大型固定数据 (data.json - 11.5MB)
  if (url.pathname.endsWith('data.json')) {
    event.respondWith(handleLargeStaticData(request));
    return;
  }
  
  // 2.2 MP3 音频
  if (url.pathname.endsWith('.mp3')) {
    event.respondWith(handleMp3(request));
    return;
  }
  
  // 2.3 静态资源 (图片, JS, CSS)
  if (isStaticResource(url)) {
    event.respondWith(handleStaticResources(request));
    return;
  }
  
  // --------------------------------------------------------
  // 3. 兜底策略
  // --------------------------------------------------------
  event.respondWith(handleOtherResources(request));
});

// ================= 策略实现 =================

// 【策略A 实现】导航 (HTML) - 网络优先，回写 APP_SHELL_CACHE
async function handleNavigation(request) {
  // 修复：不要写死 cacheKey，而是根据当前 URL 决定
  // 或者是只针对根路径才使用 ./index.html
  const url = new URL(request.url);
  let cacheKey = url.pathname;
  
  // 如果是根路径，映射到 index.html
  if (cacheKey.endsWith('/')) {
      cacheKey = './index.html';
  }

  try {
    // 1. 尝试网络 (超时控制)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3秒就放弃网络

    const networkResponse = await fetch(request, { 
      signal: controller.signal,
      cache: 'no-cache' // 强制向服务器验证
    });
    clearTimeout(timeoutId);

    // 2. 网络成功：更新缓存
    if (networkResponse.ok) {
      const cache = await caches.open(APP_SHELL_CACHE);
      // 把最新的 HTML 存进去，覆盖旧的
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
  } catch (error) {
    // 网络失败，忽略错误，进入下面读取缓存环节
  }

  // 3. 离线/网络失败：读取缓存
  const cache = await caches.open(APP_SHELL_CACHE);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) return cachedResponse;

  // 4. 这里的 fallback 通常不会触发，因为 install 阶段已经缓存了 index.html
  return new Response('<h1>离线中</h1><p>请检查网络</p>', { 
    headers: { 'Content-Type': 'text/html;charset=utf-8' }
  });
}

// 【策略A 实现】易变数据 (music/changelog) - 强力网络优先
async function handleMutableData(request) {
  const dataCache = await caches.open(DATA_CACHE);
  
  try {
    // 1. 尝试网络请求
    // 使用 cache: 'reload' 强制忽略浏览器 HTTP 缓存，直接去服务器拉取最新数据
    // 这样我们就不需要手动加 ?t=xxx 时间戳了，URL 保持干净
    const networkResponse = await fetch(request, {
      cache: 'reload',
      headers: { 'Cache-Control': 'no-cache' }
    });
    
    // 2. 网络请求成功
    if (networkResponse.ok) {
      console.log(`SW: 网络更新成功: ${request.url}`);
      // 存入缓存 (使用 clone() 因为响应流只能读一次)
      await dataCache.put(request, networkResponse.clone());
      return networkResponse;
    }
  } catch (error) {
    console.warn(`SW: 网络请求失败，切换到离线模式: ${request.url}`);
  }

  // 3. 离线/网络失败：读取缓存
  // 【关键修复】加上 ignoreSearch: true
  // 这样无论缓存里的 Key 是 "changelog.txt" 还是 "changelog.txt?v=1"
  // 也无论当前请求是否带参数，只要文件名对上，就能找到缓存！
  let cachedResponse = await dataCache.match(request, { ignoreSearch: true });
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  // 4. 兜底：如果 DATA_CACHE 里没找到，去 APP_SHELL_CACHE 找找
  // (防止你是从旧版本升级上来，数据还在老桶里)
  const appShellCache = await caches.open(APP_SHELL_CACHE);
  cachedResponse = await appShellCache.match(request, { ignoreSearch: true });
  
  if (cachedResponse) {
    console.log(`SW: 从 AppShell 救回了数据: ${request.url}`);
    return cachedResponse;
  }

  // 5. 彻底没有数据
  return new Response(JSON.stringify({ error: 'Offline' }), { 
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

// 【策略B 实现】大型数据 (data.json) - 纯粹缓存优先
async function handleLargeStaticData(request) {
  const dataCache = await caches.open(DATA_CACHE);
  
  // 1. 查缓存
  const cachedResponse = await dataCache.match(request);
  if (cachedResponse) {
    console.log('SW: 命中大文件缓存');
    return cachedResponse;
  }
  
  // 2. 没缓存才下载
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      dataCache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    return new Response('[]', { headers: { 'Content-Type': 'application/json' }});
  }
}

// 【修改】关键数据文件处理 - 网络优先策略（修复缓存更新位置）
async function handleCriticalData(request) {
  const url = new URL(request.url);
  // 判断应该存入哪个缓存桶：changelog 在 App Shell 里，music 在 Data 里
  const targetCacheName = url.pathname.endsWith('changelog.txt') ? APP_SHELL_CACHE : DATA_CACHE;

  try {
    // 1. 优先尝试网络请求
    // 注意：cache: 'reload' 或 'no-cache' 确保 service worker 确实去向服务器请求新内容，而不是读浏览器内存缓存
    const networkResponse = await fetch(request, { cache: 'no-cache' });
    
    // 2. 网络请求成功：更新到正确的缓存桶
    if (networkResponse.ok) {
      const clone = networkResponse.clone();
      caches.open(targetCacheName).then(cache => {
        cache.put(request, clone);
        console.log(`SW: ${request.url} 已更新到缓存 (${targetCacheName})`);
      });
      return networkResponse;
    }
    
    throw new Error('Network response was not ok');
    
  } catch (error) {
    console.warn('SW: 关键数据网络请求失败，降级到缓存:', error);
    
    // 3. 网络失败，尝试从指定缓存读取
    const cache = await caches.open(targetCacheName);
    let cachedResponse = await cache.match(request, { ignoreSearch: true });
    
    // 如果指定缓存没找到，尝试去另一个缓存碰碰运气（兜底）
    if (!cachedResponse) {
        const otherCacheName = targetCacheName === APP_SHELL_CACHE ? DATA_CACHE : APP_SHELL_CACHE;
        const otherCache = await caches.open(otherCacheName);
        cachedResponse = await otherCache.match(request, { ignoreSearch: true });
    }

    if (cachedResponse) {
      return cachedResponse;
    }
    
    // 5. 彻底失败
    return new Response(
      '网络连接失败，且无本地缓存。',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }
}

// 3. MP3处理 - 缓存优先策略（受配置控制）
async function handleMp3(request) {
  // 检查是否启用MP3缓存
  if (!cacheConfig.enableMp3Cache) {
    console.log('SW: MP3缓存已禁用，直接请求网络');
    try {
      const networkResponse = await fetch(request);
      return networkResponse;
    } catch (error) {
      console.log('SW: MP3网络请求失败:', request.url);
      return new Response(null, { 
        status: 404, 
        statusText: '离线，无缓存' 
      });
    }
  }
  
  // 检查缓存数量限制是否为0
  if (cacheConfig.maxMp3CacheCount === 0) {
    console.log('SW: MP3缓存限制为0，直接请求网络');
    try {
      const networkResponse = await fetch(request);
      return networkResponse;
    } catch (error) {
      console.log('SW: MP3网络请求失败:', request.url);
      return new Response(null, { 
        status: 404, 
        statusText: '离线，无缓存' 
      });
    }
  }
  
  const dataCache = await caches.open(DATA_CACHE);
  const cachedResponse = await dataCache.match(request);
  
  if (cachedResponse) {
    // 有缓存：立即返回，后台更新
    console.log('SW: MP3 命中缓存，跳过后台更新');
    return cachedResponse;
  }
  
  // 无缓存：从网络获取
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // 检查缓存数量限制
      const allRequests = await dataCache.keys();
      const mp3Requests = allRequests.filter(req => req.url.endsWith('.mp3'));
      
      if (mp3Requests.length < cacheConfig.maxMp3CacheCount) {
        // 还有空间：直接缓存
        await dataCache.put(request, networkResponse.clone());
        console.log(`SW: MP3缓存成功 (${mp3Requests.length + 1}/${cacheConfig.maxMp3CacheCount})`);
      } else {
        // 达到限制：触发清理，然后缓存
        console.log(`SW: MP3缓存已满，触发清理`);
        await cleanupCache();
        
        // 再次检查是否还有空间
        const newAllRequests = await dataCache.keys();
        const newMp3Requests = newAllRequests.filter(req => req.url.endsWith('.mp3'));
        
        if (newMp3Requests.length < cacheConfig.maxMp3CacheCount) {
          await dataCache.put(request, networkResponse.clone());
          console.log(`SW: 清理后MP3缓存成功`);
        } else {
          console.warn(`SW: 清理后MP3缓存仍满，跳过缓存`);
        }
      }
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('SW: MP3获取失败:', request.url);
    return new Response(null, { 
      status: 404, 
      statusText: '离线，无缓存' 
    });
  }
}

// 4. 静态资源处理 - 缓存优先策略
async function handleStaticResources(request) {
  // 优先从应用壳缓存获取
  const appShellCache = await caches.open(APP_SHELL_CACHE);
  const cachedResponse = await appShellCache.match(request, { ignoreSearch: true });
  
  if (cachedResponse) {
    // 后台更新缓存
    updateInBackground(request, null, APP_SHELL_CACHE);
    return cachedResponse;
  }
  
  // 尝试从数据缓存获取
  const dataCache = await caches.open(DATA_CACHE);
  const dataCachedResponse = await dataCache.match(request, { ignoreSearch: true });
  if (dataCachedResponse) {
    // 后台更新缓存
    updateInBackground(request, null, DATA_CACHE);
    return dataCachedResponse;
  }
  
  // 最后尝试网络
  try {
    const networkResponse = await fetch(request);
    
    // 如果是静态资源，缓存到应用壳
    if (networkResponse.ok && request.method === 'GET') {
      const contentType = networkResponse.headers.get('content-type') || '';
      
      // 缓存常见的静态资源类型
      if (contentType.includes('font') || 
          contentType.includes('image') || 
          contentType.includes('stylesheet') || 
          contentType.includes('javascript')) {
        
        // 检查文件大小，小于5MB的才缓存
        const contentLength = networkResponse.headers.get('content-length');
        if (!contentLength || parseInt(contentLength) < 5 * 1024 * 1024) {
          await appShellCache.put(request, networkResponse.clone());
        }
      }
    }
    
    return networkResponse;
    
  } catch (error) {
    console.error('SW: 静态资源获取失败:', request.url);
    
    // 返回占位图片
    if (request.url.match(/\.(png|jpg|jpeg|gif|svg)$/i)) {
      return new Response(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        { headers: { 'Content-Type': 'image/gif' } }
      );
    }
    
    // 返回404响应
    return new Response(null, { 
      status: 404, 
      statusText: 'Not Found' 
    });
  }
}

// 5. 其他资源处理 - 后台更新策略
async function handleOtherResources(request) {
  try {
    // 先尝试网络请求
    const networkResponse = await fetch(request);
    
    // 如果是成功的响应，可以缓存到数据缓存
    if (networkResponse.ok && request.method === 'GET') {
      const dataCache = await caches.open(DATA_CACHE);
      
      // 检查缓存数量
      const allRequests = await dataCache.keys();
      const otherRequests = allRequests.filter(req => 
        !req.url.endsWith('.mp3') && 
        !REQUIRED_FILES.some(requiredFile => req.url.includes(requiredFile.split('/').pop()))
      );
      
      if (otherRequests.length < cacheConfig.maxOtherCacheCount) {
        await dataCache.put(request, networkResponse.clone());
      }
    }
    
    return networkResponse;
    
  } catch (error) {
    console.warn('SW: 其他资源网络请求失败，尝试缓存:', error);
    
    // 尝试从数据缓存获取
    const dataCache = await caches.open(DATA_CACHE);
    const cachedResponse = await dataCache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // 尝试从应用壳缓存获取
    const appShellCache = await caches.open(APP_SHELL_CACHE);
    const appCachedResponse = await appShellCache.match(request);
    if (appCachedResponse) {
      return appCachedResponse;
    }
    
    // 都没有，返回网络错误
    throw error;
  }
}

// 通用后台更新函数
async function updateInBackground(request, cacheKey, cacheName) {
  try {
    // 加上 cache-control 确保拿到的是服务器最新的，不是浏览器自带的缓存
    const freshResponse = await fetch(request, { cache: 'no-cache' });
    
    // 检查响应类型，如果是导航请求，确保返回的是 HTML
    if (freshResponse.ok) {
      const contentType = freshResponse.headers.get('content-type');
      if (request.mode === 'navigate' && (!contentType || !contentType.includes('text/html'))) {
        console.error('SW: 尝试更新 HTML 缓存但返回了非 HTML 内容，已阻止覆盖');
        return;
      }
      
      const cache = await caches.open(cacheName);
      await cache.put(cacheKey || request, freshResponse);
    }
  } catch (error) {
    // 静默失败
  }
}

// 监听消息
self.addEventListener('message', (event) => {
  // 1. 处理字符串类型的简单指令
  if (typeof event.data === 'string') {
    const command = event.data;
    
    if (command === 'cleanup-cache') {
      cleanupCache();
    } else if (command === 'clear-mp3-cache') {
      clearMp3CacheOnly();
    } else if (command === 'get-cache-status') {
      getCacheStatus().then(status => {
        event.source.postMessage({
          type: 'cache-status',
          status: status,
          config: cacheConfig
        });
      });
    } else if (command === 'delete-all-caches') {
      // 【修复】之前这里用了未定义的 messageType，已修正
      // 同时也需要补全 deleteAllCaches 函数
      deleteAllCaches().then(() => {
        event.source.postMessage({
          type: 'all-caches-deleted'
        });
      });
    }
  } 
  // 2. 处理对象类型的复杂指令
  else if (event.data && typeof event.data === 'object') {
    if (event.data.type === 'update-cache-config') {
      // 更新配置
      const oldConfig = { ...cacheConfig };
      cacheConfig = { ...cacheConfig, ...event.data.config };
      saveConfigToIndexedDB(cacheConfig);
      console.log('SW: 缓存配置已更新:', cacheConfig);
      
      if (oldConfig.enableMp3Cache !== cacheConfig.enableMp3Cache || 
          oldConfig.maxMp3CacheCount !== cacheConfig.maxMp3CacheCount) {
        cleanupCache();
      }
      
      event.source.postMessage({
        type: 'cache-config-updated',
        config: cacheConfig
      });
    } else if (event.data.type === 'get-cache-config') {
      event.source.postMessage({
        type: 'cache-config-response',
        config: cacheConfig
      });
    } else if (event.data.type === 'cache-config-from-page') {
      cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...event.data.config };
      saveConfigToIndexedDB(cacheConfig);
      console.log('SW: 从主页面接收缓存配置:', cacheConfig);
      
      if (event.data.config.enableMp3Cache === false || 
          event.data.config.maxMp3CacheCount === 0) {
        cleanupCache();
      }
    } else if (event.data.type === 'register-page') {
      const pagePath = event.data.pagePath;
      if (pagePath && !APP_SHELL.includes(pagePath)) {
        caches.open(APP_SHELL_CACHE).then(cache => {
          cache.add(pagePath).catch(err => 
            console.warn(`SW: 动态缓存页面 ${pagePath} 失败:`, err)
          );
        });
      }
    } else if (event.data.type === 'request-cache-config') {
      event.source.postMessage({
        type: 'cache-config-response',
        config: cacheConfig
      });
    }
  }
});

// 只清理MP3缓存，保留关键数据文件
async function clearMp3CacheOnly() {
  try {
    const dataCache = await caches.open(DATA_CACHE);
    const requests = await dataCache.keys();
    
    const mp3Deletions = requests
      .filter(request => request.url.endsWith('.mp3'))
      .map(request => dataCache.delete(request));
    
    await Promise.all(mp3Deletions);
    console.log(`SW: 清理了 ${mp3Deletions.length} 个MP3缓存`);
    
  } catch (error) {
    console.warn('SW: MP3缓存清理失败:', error);
  }
}

// 获取缓存详细状态
async function getCacheStatus() {
  try {
    const cacheNames = await caches.keys();
    let totalSize = 0;
    let totalFiles = 0;
    let mp3Files = 0;
    let mp3Size = 0;
    const cacheDetails = {};

    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      let cacheSize = 0;
      let cacheMp3Size = 0;
      let cacheMp3Count = 0;
      
      // 计算该缓存的大小
      for (const request of requests) {
        try {
          const response = await cache.match(request);
          if (response) {
            const blob = await response.blob();
            const size = blob.size;
            cacheSize += size;
            
            // 如果是MP3文件，单独统计
            if (request.url.endsWith('.mp3')) {
              cacheMp3Size += size;
              cacheMp3Count++;
            }
          }
        } catch (err) {
          console.warn(`SW: 计算文件大小失败: ${request.url}`, err);
        }
      }
      
      cacheDetails[cacheName] = {
        files: requests.length,
        size: cacheSize,
        readableSize: formatBytes(cacheSize),
        mp3Files: cacheMp3Count,
        mp3Size: cacheMp3Size,
        mp3ReadableSize: formatBytes(cacheMp3Size)
      };
      
      totalSize += cacheSize;
      totalFiles += requests.length;
      mp3Files += cacheMp3Count;
      mp3Size += cacheMp3Size;
    }

    return {
      total: {
        files: totalFiles,
        size: totalSize,
        readableSize: formatBytes(totalSize),
        mp3Files: mp3Files,
        mp3Size: mp3Size,
        mp3ReadableSize: formatBytes(mp3Size)
      },
      details: cacheDetails,
      config: cacheConfig
    };
    
  } catch (error) {
    console.warn('SW: 获取缓存状态失败:', error);
    return { 
      error: '获取失败', 
      total: { 
        files: 0, 
        size: 0, 
        readableSize: '0 B',
        mp3Files: 0,
        mp3Size: 0,
        mp3ReadableSize: '0 B'
      }, 
      details: {},
      config: cacheConfig
    };
  }
}

// 【新增】删除所有缓存（用于 test.html 的核弹按钮）
async function deleteAllCaches() {
  try {
    const keys = await caches.keys();
    console.log('SW: 正在删除所有缓存...', keys);
    
    await Promise.all(
      keys.map(key => caches.delete(key))
    );
    
    console.log('SW: 所有缓存已清空');
    return true;
  } catch (error) {
    console.error('SW: 删除所有缓存失败:', error);
    return false;
  }
}

// 确保在Service Worker启动时加载配置
(async function initConfig() {
  try {
    await fetchCacheConfigFromPage();
    console.log('SW: 配置初始化完成:', cacheConfig);
  } catch (error) {
    console.warn('SW: 配置初始化失败:', error);
  }
})();

// 定期清理缓存（可选）
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'cleanup-cache') {
    console.log('SW: 定期清理缓存');
    cleanupCache();
  }
});