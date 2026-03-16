#!/bin/bash

# 获取脚本所在目录的父目录，即项目根目录
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 切换到根目录
cd "$ROOT_DIR" || exit 1

# ================= 配置区域 =================
# 定义软链接映射关系
# 格式: "源路径:目标路径"
# 提示: 如果需要添加新的工具目录（如 .claude），只需在此数组中添加一行即可
LINKS=(
    ".agent:.coco"
    ".agent:.gemini"
    ".agent:.claude"
    "AGENTS.md:GEMINI.md"
)
# ===========================================

# 函数：创建软链接
create_links() {
    echo "正在配置软链接..."
    for rule in "${LINKS[@]}"; do
        local src="${rule%%:*}"
        local dest="${rule##*:}"

        # 检查目标是否已是软链接
        if [ -L "$dest" ]; then
            echo "[跳过] $dest 已是软链接"
            continue
        fi

        # 检查目标是否已存在（且不是软链接）
        if [ -e "$dest" ]; then
            echo "[警告] $dest 已存在且不是软链接，跳过"
            continue
        fi

        # 检查源是否存在
        if [ ! -e "$src" ]; then
            echo "[警告] 源文件/目录 $src 不存在，无法创建 $dest"
            continue
        fi

        ln -s "$src" "$dest"
        echo "[创建] $src -> $dest"
    done
    echo "配置完成。"
}

# 函数：删除软链接
remove_links() {
    echo "正在清理软链接..."
    for rule in "${LINKS[@]}"; do
        local dest="${rule##*:}"

        if [ -L "$dest" ]; then
            rm "$dest"
            echo "[删除] $dest"
        elif [ -e "$dest" ]; then
            echo "[保留] $dest 不是软链接，未删除"
        else
            echo "[忽略] $dest 不存在"
        fi
    done
    echo "清理完成。"
}

# 函数：显示帮助
show_help() {
    echo "管理项目中的 Agent 目录和文件软链接。"
    echo
    echo "用法: ./$(basename "$0") [命令]"
    echo
    echo "命令:"
    echo "  (不带参数)   创建/检查配置列表中的软链接"
    echo "  reset        删除配置列表中的软链接"
    echo "  help         显示此帮助信息"
    echo
    echo "当前配置的映射:"
    for rule in "${LINKS[@]}"; do
        echo "  ${rule%%:*} -> ${rule##*:}"
    done
}

# 主逻辑
case "$1" in
    reset)
        remove_links
        ;;
    help)
        show_help
        ;;
    "")
        create_links
        ;;
    *)
        echo "错误: 未知命令 '$1'"
        echo "请使用 help 查看用法。"
        exit 1
        ;;
esac
