#!/bin/bash
# 自动生成 frontend-lab 首页导航 index.html，并保证目录可被 git 跟踪

OUTPUT="index.html"

# 1️⃣ 确保所有目录下有 .gitkeep 文件
for dir in projects/*/ react-apps/*/ utils/*/; do
  [ -d "$dir" ] || continue
  touch "$dir/.gitkeep"
done

# 2️⃣ 生成 index.html
cat > $OUTPUT <<EOF
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <title>Frontend Lab 🧪</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 2rem; background: #f9f9f9; color: #333; }
    h1 { color: #444; }
    ul { list-style: none; padding: 0; }
    li { margin: 0.5rem 0; }
    a { text-decoration: none; color: #0066cc; font-weight: bold; }
    a:hover { text-decoration: underline; }
    section { margin-bottom: 2rem; }
  </style>
</head>
<body>
  <h1>Frontend Lab 🧪</h1>
  <p>前端实验室：存放各种小型项目、工具和 React 应用。</p>
EOF

# HTML / JS 项目
if [ -d "projects" ]; then
  echo "  <section>" >> $OUTPUT
  echo "    <h2>🔹 HTML / JS 小项目</h2>" >> $OUTPUT
  echo "    <ul>" >> $OUTPUT
  for dir in projects/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    echo "      <li><a href=\"./projects/$name/\"> $name </a></li>" >> $OUTPUT
  done
  echo "    </ul>" >> $OUTPUT
  echo "  </section>" >> $OUTPUT
fi

# React 应用
if [ -d "react-apps" ]; then
  echo "  <section>" >> $OUTPUT
  echo "    <h2>🔹 React 应用</h2>" >> $OUTPUT
  echo "    <ul>" >> $OUTPUT
  for dir in react-apps/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    echo "      <li><a href=\"./react-apps/$name/\"> $name </a></li>" >> $OUTPUT
  done
  echo "    </ul>" >> $OUTPUT
  echo "  </section>" >> $OUTPUT
fi

# 通用 utils
if [ -d "utils" ]; then
  echo "  <section>" >> $OUTPUT
  echo "    <h2>🔹 Utils 工具库</h2>" >> $OUTPUT
  echo "    <ul>" >> $OUTPUT
  for dir in utils/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    echo "      <li><a href=\"./utils/$name/\"> $name </a></li>" >> $OUTPUT
  done
  echo "    </ul>" >> $OUTPUT
  echo "  </section>" >> $OUTPUT
fi

cat >> $OUTPUT <<EOF
</body>
</html>
EOF

echo "✅ 已生成 $OUTPUT"

# 3️⃣ 自动 git 提交并推送
git add .
git commit -m "chore: update index.html and ensure .gitkeep" && git push

