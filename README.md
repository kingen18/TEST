# 🎓 湖北科技学院教务系统 - 课程表爬虫

基于 Node.js 的教务系统爬虫，自动登录并抓取课程表数据，输出结构化 JSON。

> 适用系统：强智科技教务管理系统

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 运行 (推荐使用环境变量，避免密码泄露)
# Windows PowerShell:
$env:JWGL_USER="你的学号"
$env:JWGL_PASS="你的密码"
node crawler.js

# 或直接传参:
node crawler.js 学号 密码
```

## 输出示例

```
==========================================================
  湖北科技学院教务系统 - 课程表爬虫
  https://jwgl.hbust.edu.cn
==========================================================
[*] 学号: 2021XXXXXXXX

[*] 正在登录...
[+] 登录成功!
[*] 访问主页面获取导航...
[*] 尝试: /jsxsd/xskb/xskb_list.do
[+] 找到课程表页面!
[+] 找到课表表格，解析中...

==========================================================
  学期: 2024-2025-2
  共解析出 12 门课程
==========================================================

  周一:
    [1-2节] 高等数学 | 张三 | 教1-301 | 1-16周
    [3-4节] 大学英语 | 李四 | 教2-205 | 1-16周
  ...

[+] JSON 结果: outputs/courses.json
```

## 项目结构

```
├── crawler.js          # 主脚本
├── package.json        # 依赖配置
├── work/               # 调试中间文件
│   └── course_page.html
├── outputs/            # 输出结果
│   └── courses.json
└── README.md
```

## 技术原理

| 模块 | 说明 |
|------|------|
| **登录** | Base64 编码账号密码 → POST `/jsxsd/xk/LoginToXk` |
| **定位** | 从 `xsMain.jsp` 自动发现课表 iframe/链接 |
| **解析** | cheerio 解析 HTML → 4 种策略覆盖课表/列表格式 |
| **输出** | 控制台打印 + `outputs/courses.json` |

## 依赖

- [axios](https://github.com/axios/axios) - HTTP 客户端
- [cheerio](https://cheerio.js.org/) - HTML 解析
- [tough-cookie](https://github.com/salesforce/tough-cookie) - Cookie 管理
- [axios-cookiejar-support](https://github.com/3846masa/axios-cookiejar-support) - Cookie jar 集成

## License

MIT
