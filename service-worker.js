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
  './changelog.txt',
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
      const url = request.url;
      
      // 检查是否为必须保留的文件
      const isRequired = requiredUrls.some(requiredUrl => 
        url.includes(requiredUrl.split('/').pop()) // 检查文件名
      );
      
      if (isRequired) {
        // 必须保留的文件 - 跳过不处理
        continue;
      } else if (url.endsWith('.mp3')) {
        mp3Files.push({ request, url });
      } else {
        otherFiles.push({ request, url });
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
  
  // 策略A：导航请求（页面访问）- 后台更新策略
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  
  // 策略B：关键数据文件 - 网络优先策略
  if (url.pathname.endsWith('data.json') || 
      url.pathname.endsWith('music.json') || 
      url.pathname.endsWith('changelog.txt')) {
    event.respondWith(handleCriticalData(request));
    return;
  }
  
  // 策略C：MP3文件 - 缓存优先策略（受配置控制）
  if (url.pathname.endsWith('.mp3')) {
    event.respondWith(handleMp3(request));
    return;
  }
  
  // 策略D：静态资源（图片、CSS、JS、字体等）- 缓存优先策略
  if (isStaticResource(url)) {
    event.respondWith(handleStaticResources(request));
    return;
  }
  
  // 策略E：其他资源 - 后台更新策略
  event.respondWith(handleOtherResources(request));
});

// ================= 策略实现 =================

// 1. 导航处理 - 后台更新策略（先缓存后网络更新）
async function handleNavigation(request) {
  const pathname = getPathName(request);
  
  // 动态确定目标页面路径
  let targetPage;
  
  // 处理根路径映射
  if (pathname === '/' || pathname.endsWith('/index.html')) {
    targetPage = './index.html';
  } else {
    targetPage = `.${pathname}`;
  }
  
  console.log(`SW: 导航请求 ${pathname}, 尝试加载 ${targetPage}`);
  
  try {
    const appShellCache = await caches.open(APP_SHELL_CACHE);
    const cachedResponse = await appShellCache.match(targetPage);
    
    if (cachedResponse) {
      // 命中缓存：返回缓存并后台更新
      updateInBackground(request, targetPage, APP_SHELL_CACHE);
      return cachedResponse;
    }
    
    // 未命中缓存：网络请求
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // 网络请求成功：将新页面存入缓存，以便下次离线访问
      const cache = await caches.open(APP_SHELL_CACHE);
      cache.put(targetPage, networkResponse.clone());
    }
    return networkResponse;
    
  } catch (error) {
    console.error(`SW: 导航请求失败 (${targetPage}):`, error);
    
    // 离线且无该页面缓存时的兜底策略
    try {
      const appShellCache = await caches.open(APP_SHELL_CACHE);
      // 如果访问新页面失败，回退到主页
      const fallbackPage = await appShellCache.match('./index.html');
      if (fallbackPage) {
        return fallbackPage;
      }
    } catch (cacheError) {
      // 忽略
    }
    
    // 最后的纯文本提示
    return new Response(
      '<!DOCTYPE html><html><body><h1>离线模式</h1><p>无法加载该页面，请检查网络。</p></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

// 2. 关键数据文件处理 - 网络优先策略
async function handleCriticalData(request) {
  try {
    // 1. 优先尝试网络请求
    const networkResponse = await fetch(request);
    
    // 2. 网络请求成功：克隆一份存入缓存，然后返回给页面
    if (networkResponse.ok) {
      const clone = networkResponse.clone();
      caches.open(DATA_CACHE).then(cache => {
        cache.put(request, clone);
        console.log(`SW: ${request.url} 已从网络下载并更新到缓存`);
      });
      return networkResponse;
    }
    
    throw new Error('Network response was not ok');
    
  } catch (error) {
    console.warn('SW: 网络请求失败，尝试读取缓存:', error);
    
    // 3. 尝试从数据缓存读取
    const dataCache = await caches.open(DATA_CACHE);
    let cachedResponse = await dataCache.match(request, { ignoreSearch: true });
    
    if (cachedResponse) {
      console.log(`SW: 从数据缓存中找到 ${request.url}`);
      return cachedResponse;
    }

    // 4. 尝试从应用壳缓存读取
    const appShellCache = await caches.open(APP_SHELL_CACHE);
    cachedResponse = await appShellCache.match(request, { ignoreSearch: true });

    if (cachedResponse) {
      console.log(`SW: 从应用壳缓存中找到 ${request.url}`);
      return cachedResponse;
    }
    
    // 5. 既没网络也没缓存
    console.error(`SW: 无法获取关键数据文件: ${request.url}`);
    return new Response(
      JSON.stringify({ error: '无法加载数据，请检查网络连接' }),
      { 
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' }
      }
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
    updateInBackground(request, null, DATA_CACHE);
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
    const freshResponse = await fetch(request);
    if (freshResponse.ok) {
      const cache = await caches.open(cacheName);
      const keyToUse = cacheKey || request;
      await cache.put(keyToUse, freshResponse.clone());
      console.log(`SW: 后台更新成功: ${request.url}`);
    }
  } catch (error) {
    // 静默失败，不影响主流程
  }
}

// 监听消息
self.addEventListener('message', (event) => {
  if (event.data === 'cleanup-cache') {
    cleanupCache();
  } else if (event.data === 'clear-mp3-cache') {
    clearMp3CacheOnly();
  } else if (event.data === 'get-cache-status') {
    getCacheStatus().then(status => {
      event.source.postMessage({
        type: 'cache-status',
        status: status,
        config: cacheConfig
      });
    });
  } else if (event.data.type === 'update-cache-config') {
    // 更新配置
    const oldConfig = { ...cacheConfig };
    cacheConfig = { ...cacheConfig, ...event.data.config };
    saveConfigToIndexedDB(cacheConfig);
    console.log('SW: 缓存配置已更新:', cacheConfig);
    
    // 如果配置有变化，立即触发清理
    if (oldConfig.enableMp3Cache !== cacheConfig.enableMp3Cache || 
        oldConfig.maxMp3CacheCount !== cacheConfig.maxMp3CacheCount) {
      cleanupCache();
    }
    
    // 发送确认消息
    event.source.postMessage({
      type: 'cache-config-updated',
      config: cacheConfig
    });
  } else if (event.data.type === 'get-cache-config') {
    // 返回当前配置
    event.source.postMessage({
      type: 'cache-config-response',
      config: cacheConfig
    });
  } else if (event.data.type === 'cache-config-from-page') {
    // 从主页面接收的配置
    cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...event.data.config };
    saveConfigToIndexedDB(cacheConfig);
    console.log('SW: 从主页面接收缓存配置:', cacheConfig);
    
    // 立即应用新配置
    if (event.data.config.enableMp3Cache === false || 
        event.data.config.maxMp3CacheCount === 0) {
      cleanupCache();
    }
  } else if (event.data.type === 'register-page') {
    // 动态注册新页面
    const pagePath = event.data.pagePath;
    if (pagePath && !APP_SHELL.includes(pagePath)) {
      console.log(`SW: 注册新页面: ${pagePath}`);
      
      // 立即缓存这个页面
      caches.open(APP_SHELL_CACHE).then(cache => {
        cache.add(pagePath).catch(err => 
          console.warn(`SW: 动态缓存页面 ${pagePath} 失败:`, err)
        );
      });
    }
  } else if (event.data.type === 'request-cache-config') {
    // 主页面请求配置，发送当前配置
    event.source.postMessage({
      type: 'cache-config-response',
      config: cacheConfig
    });
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