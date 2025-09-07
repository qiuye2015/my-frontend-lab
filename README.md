# Frontend Lab 🧪

一个前端实验室，存放各种小型项目、网站导航、工具集合和 React 应用。

## 📂 项目目录

### 🔹 HTML & CSS & JS
- [Site Bookmarks](./projects/site-bookmarks/) - 一个静态网站收藏夹
- [HTML Nav](./projects/html-nav/) - 纯 HTML 的网站导航
- [Todo Manager](./projects/todo-manager/) - 简单的项目/任务管理工具

### 🔹 React Apps
- [Bookmarks React](./react-apps/bookmarks-react/) - React 实现的收藏夹
- [Dashboard React](./react-apps/dashboard-react/) - 个人仪表盘/项目管理工具

## 仓库布局

```bash
frontend-lab/
│
├── README.md                # 仓库说明，列出项目导航
├── index.html                # 仓库内的入口导航页 (汇总所有子项目链接)
│
├── projects/                 # 小型独立前端项目集合
│   ├── site-bookmarks/       # 网站收藏夹
│   │   ├── index.html
│   │   └── style.css
│   │
│   ├── html-nav/             # 纯HTML单文件网站导航
│   │   └── index.html
│   │
│   ├── todo-manager/         # 个人项目管理工具
│   │   ├── index.html
│   │   ├── app.js
│   │   └── style.css
│   │
│   └── ...
│
├── react-apps/               # React 实现的工具或小项目
│   ├── dashboard-react/      
│   │   ├── package.json
│   │   ├── src/
│   │   └── public/
│   │
│   └── ...
│
└── utils/                    # 通用脚本、组件或样式
    ├── scripts/
    └── styles/

```



## 🚀 快速开始
克隆仓库：
```bash
git clone https://github.com/yourname/frontend-lab.git
```

进入项目目录运行：

```bash
cd react-apps/bookmarks-react
npm install
npm start
```





---

