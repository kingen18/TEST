# 🎓 湖北科技学院教务系统 - 课程表爬虫

自动登录教务系统，抓取本周课程表，输出规整的 HTML 课表。

## 快速开始

```powershell
# 1. 安装依赖
npm install

# 2. 抓取一次
node crawler.js 学号 密码
```

## 自动更新（推荐）

```powershell
# 注册 Windows 定时任务，每小时自动运行
.\setup-scheduler.ps1 学号 密码
```

之后无需任何操作，`outputs\schedule.html` 每小时自动刷新。

取消定时任务：

```powershell
.\remove-scheduler.ps1
```

## 输出

- `outputs/schedule.html` — 可视化课表网页，可直接浏览器打开
- `outputs/courses.json` — 结构化 JSON 数据

## 工作原理

```
登录教务处 → main_index_loadkb.jsp → 解析 kb_table → 生成 HTML
```

| 模块 | 说明 |
|------|------|
| 登录 | Base64 编码账号密码，POST 到教务系统 |
| 抓取 | 请求 `main_index_loadkb.jsp?rq=日期` 获取本周课表 |
| 解析 | cheerio 解析 `<p title>` 中的课程名/教室/学分/类型 |
| 输出 | 生成带样式的 HTML 课表 + JSON |

## 依赖

- [axios](https://github.com/axios/axios)  HTTP 客户端
- [cheerio](https://cheerio.js.org/)  HTML 解析
- [tough-cookie](https://github.com/salesforce/tough-cookie)  Cookie 管理
- [axios-cookiejar-support](https://github.com/3846masa/axios-cookiejar-support)  Cookie jar 集成

## License

MIT
