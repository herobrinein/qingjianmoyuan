import os
import webbrowser
import threading
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.parse
import sys

# 确保中文路径正常处理
os.environ['PYTHONIOENCODING'] = 'utf-8'

# 获取脚本所在目录作为网站根目录
ROOT_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
print(f"网站根目录: {ROOT_DIRECTORY}")

# 自定义请求处理器
class SecureHTTPRequestHandler(SimpleHTTPRequestHandler):
    # 扩展支持的文件类型
    extensions_map = {
        '': 'application/octet-stream',
        '.html': 'text/html; charset=utf-8',
        '.htm': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.txt': 'text/plain; charset=utf-8',
        '.pdf': 'application/pdf',
        '.zip': 'application/zip',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject',
    }
    
    def do_GET(self):
        """处理GET请求，自动处理根路径重定向到index.html"""
        # 处理根路径和空路径
        if self.path in ['/', '']:
            self.path = '/index.html'
            print(f"根路径重定向到: {self.path}")
        
        # 处理没有扩展名的路径，尝试添加 .html
        elif not os.path.splitext(self.path)[1]:
            # 解码路径
            decoded_path = urllib.parse.unquote(self.path)
            # 检查是否存在对应的 .html 文件
            possible_html = decoded_path + '.html'
            full_html_path = os.path.join(ROOT_DIRECTORY, possible_html.lstrip('/'))
            
            if os.path.exists(full_html_path):
                print(f"无扩展名路径添加.html: {self.path} -> {possible_html}")
                self.path = possible_html
        
        try:
            # 调用父类方法处理请求
            super().do_GET()
        except BrokenPipeError:
            # 忽略客户端断开连接的错误
            pass
        except Exception as e:
            print(f"请求处理错误: {e}")
            self.send_error(500, "服务器内部错误")
    
    def translate_path(self, path):
        """将URL路径转换为文件系统路径"""
        try:
            # 解析URL路径
            parsed_path = urllib.parse.urlparse(path)
            # 处理中文路径 - 解码百分号编码
            path = urllib.parse.unquote(parsed_path.path)
            
            # 移除查询字符串和片段
            path = path.split('?', 1)[0].split('#', 1)[0]
            
            # 防止路径遍历攻击
            if '..' in path:
                self.send_error(403, "禁止访问上级目录")
                return self.get_error_path('403.html')
            
            # 将路径限制在网站根目录内
            full_path = os.path.abspath(os.path.join(ROOT_DIRECTORY, path.lstrip('/')))
            
            # 确保路径仍然在根目录内
            root_dir_abspath = os.path.abspath(ROOT_DIRECTORY)
            if not full_path.startswith(root_dir_abspath + os.sep) and full_path != root_dir_abspath:
                self.send_error(403, "禁止访问网站目录外的文件")
                return self.get_error_path('403.html')
            
            return full_path
        except Exception as e:
            print(f"路径转换错误: {e}")
            return self.get_error_path('500.html')
    
    def get_error_path(self, error_file):
        """获取错误页面路径，如果不存在则返回默认路径"""
        error_path = os.path.join(ROOT_DIRECTORY, error_file)
        if os.path.exists(error_path):
            return error_path
        return os.path.join(ROOT_DIRECTORY, 'index.html' if os.path.exists(os.path.join(ROOT_DIRECTORY, 'index.html')) else '')
    
    def send_error(self, code, message=None):
        """发送错误响应，如果存在自定义错误页面则使用"""
        error_pages = {
            403: '403.html',
            404: '404.html',
            500: '500.html'
        }
        
        if code in error_pages:
            error_page = os.path.join(ROOT_DIRECTORY, error_pages[code])
            if os.path.exists(error_page):
                try:
                    self.send_response(code)
                    self.send_header('Content-type', 'text/html; charset=utf-8')
                    self.end_headers()
                    with open(error_page, 'rb') as f:
                        self.wfile.write(f.read())
                    return
                except:
                    pass  # 如果自定义错误页面读取失败，使用默认错误页面
        
        # 使用默认错误处理
        super().send_error(code, message)
    
    def log_message(self, format, *args):
        """记录请求日志，支持中文"""
        try:
            sys.stdout.write(f"{self.log_date_time_string()} - {format % args}\n")
        except:
            # 如果日志记录失败，尝试使用安全的编码
            safe_args = tuple(arg.encode('utf-8', 'replace').decode('utf-8', 'replace') if isinstance(arg, str) else arg for arg in args)
            sys.stdout.write(f"{self.log_date_time_string()} - {format % safe_args}\n")

# 启动HTTP服务器
def run_server():
    """启动HTTP服务器"""
    server_address = ('', 8000)
    httpd = HTTPServer(server_address, SecureHTTPRequestHandler)
    
    # 设置超时，以便可以响应键盘中断
    httpd.timeout = 1
    
    print('正在启动HTTP服务器，端口 8000...')
    print('正在提供目录:', ROOT_DIRECTORY)
    print('-' * 50)
    print('支持以下访问方式:')
    print('  • http://localhost:8000/            (自动重定向到index.html)')
    print('  • http://localhost:8000/index.html  (直接访问)')
    print('-' * 50)
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('服务器正在关闭...')
        httpd.server_close()

# 切换到网站目录
os.chdir(ROOT_DIRECTORY)

# 在新线程中启动服务器
server_thread = threading.Thread(target=run_server)
server_thread.daemon = True
server_thread.start()

# 等待服务器启动
time.sleep(2)

# 打开浏览器访问网站根路径（会自动重定向到index.html）
url = 'http://localhost:8000/'
print(f'正在打开浏览器访问: {url}')
webbrowser.open(url)

print('网站已启动，浏览器将自动打开。')
print('按Ctrl+C关闭此窗口...')
print('-' * 50)
print('可访问的文件列表:')
try:
    html_files = [f for f in os.listdir(ROOT_DIRECTORY) if f.endswith(('.html', '.htm'))]
    for file in html_files:
        clean_name = file.replace('.html', '').replace('.htm', '')
        if file == 'index.html':
            print(f'  http://localhost:8000/          (主页)')
        else:
            print(f'  http://localhost:8000/{clean_name} 或 http://localhost:8000/{file}')
except:
    pass

# 保持脚本运行
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print('\n正在关闭服务器...')
    print('谢谢使用!')
    os._exit(0)