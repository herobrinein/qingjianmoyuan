import os
import json

def generate_music_json():
    # 1. 获取脚本所在的当前目录路径
    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 2. 定义 music 文件夹路径和输出的 json 文件路径
    music_dir = os.path.join(current_dir, 'music')
    json_path = os.path.join(current_dir, 'music.json')

    # 3. 检查 music 文件夹是否存在
    if not os.path.exists(music_dir):
        print(f"❌ 错误：在当前目录下找不到 'music' 文件夹！")
        print(f"请确保脚本位于与 'music' 文件夹相同的目录中。")
        return

    print(f"📂 正在扫描目录: {music_dir} ...")

    try:
        # 4. 获取所有 .mp3 文件
        # os.listdir 获取文件名，列表推导式筛选 .mp3 (不区分大小写)
        mp3_files = [
            f for f in os.listdir(music_dir) 
            if os.path.isfile(os.path.join(music_dir, f)) and f.lower().endswith('.mp3')
        ]

        # 5. 对文件名进行排序（可选，但推荐，这样列表比较整齐）
        mp3_files.sort()

        if not mp3_files:
            print("⚠️ 警告：'music' 文件夹里没有找到任何 MP3 文件。")
            
        # 6. 写入 music.json 文件
        with open(json_path, 'w', encoding='utf-8') as json_file:
            # ensure_ascii=False 保证中文文件名正常显示，indent=4 保证格式美观
            json.dump(mp3_files, json_file, ensure_ascii=False, indent=4)

        print(f"✅ 成功！已将 {len(mp3_files)} 个 MP3 文件写入到 'music.json'。")
        print(f"📄 文件路径: {json_path}")

    except Exception as e:
        print(f"❌ 发生未知错误: {e}")

if __name__ == "__main__":
    generate_music_json()
    # Windows 下防止双击运行后窗口立刻关闭（可选）
    input("\n按回车键退出...")