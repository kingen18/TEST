/**
 * 湖北科技学院教务系统 - 课程表爬虫 v4
 *
 * 用法:
 *   node crawler.js <学号> <密码>              # 自动检测当前周，生成 HTML
 *   node crawler.js <学号> <密码> --week 14    # 指定周次
 *   node crawler.js <学号> <密码> --daemon     # 每小时自动更新
 *
 * 输出: outputs/courses.json + outputs/schedule.html
 */

"use strict";

const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const cheerio = require("cheerio");
const fs = require("fs");

// ============ 配置 ============
const CONFIG = {
  baseURL: "https://jwgl.hbust.edu.cn",
  loginPath: "/jsxsd/xk/LoginToXk",
  mainPath: "/jsxsd/framework/xsMain.jsp",
  kbPath: "/jsxsd/xskb/xskb_list.do",
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  },
};

// ============ Base64 ============
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function encodeInp(s) {
  let o = "", c1, c2, c3, e1, e2, e3, e4, i = 0;
  do {
    c1 = s.charCodeAt(i++); c2 = s.charCodeAt(i++); c3 = s.charCodeAt(i++);
    e1 = c1 >> 2; e2 = ((c1 & 3) << 4) | (c2 >> 4);
    e3 = ((c2 & 15) << 2) | (c3 >> 6); e4 = c3 & 63;
    if (isNaN(c2)) { e3 = e4 = 64; } else if (isNaN(c3)) { e4 = 64; }
    o += B64.charAt(e1) + B64.charAt(e2) + B64.charAt(e3) + B64.charAt(e4);
    c1 = c2 = c3 = ""; e1 = e2 = e3 = e4 = "";
  } while (i < s.length);
  return o;
}

function createClient() {
  const jar = new CookieJar();
  return wrapper(axios.create({ jar, baseURL: CONFIG.baseURL, headers: CONFIG.headers, maxRedirects: 5, validateStatus: () => true }));
}

// ============ 登录 ============
async function login(client, username, password) {
  const r0 = await client.get("/jsxsd/");
  const r = await client.post(CONFIG.loginPath,
    new URLSearchParams({ encoded: encodeInp(username) + "%%%" + encodeInp(password) }), {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: CONFIG.baseURL, Referer: CONFIG.baseURL + "/jsxsd/" },
    });
  const body = typeof r.data === "string" ? r.data : "";
  if (r.headers["location"]?.includes("xsMain") || body.includes("xsMain") || body.includes("学期理论课表")) return true;
  if (body.includes("用户名或密码错误")) return false;
  return true;
}

// ============ 自动检测当前周 ============
async function detectCurrentWeek(client, html) {
  // 方法1: 根据日期估算 (2025-2026-2 学期约2月23日开学)
  const semesterStart = new Date(2026, 2, 2);
  const now = new Date();
  const diffDays = Math.floor((now - semesterStart) / (1000 * 60 * 60 * 24));
  let week = Math.max(1, Math.floor(diffDays / 7) + 1);

  // 方法2: 从 xsMain.jsp 主页面的 li_showWeek 提取来纠正
  try {
    const r = await client.get(CONFIG.mainPath, { headers: { Referer: CONFIG.baseURL + "/jsxsd/" } });
    const body = typeof r.data === "string" ? r.data : "";
    // 匹配 "第X周/总共Y周" 模式
    const m = body.match(/第(\d+)周\s*\/\s*\d+周/);
    if (m) week = parseInt(m[1]);
  } catch (_) {}

  return week;
}

// ============ 周次解析 ============
function weekInRange(weeksStr, targetWeek) {
  if (!targetWeek || !weeksStr) return true;
  const cleaned = weeksStr.replace(/\(.*?\)/g, "").trim();
  const parts = cleaned.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes("-")) {
      const [s, e] = trimmed.split("-").map(Number);
      if (targetWeek >= s && targetWeek <= e) return true;
    } else {
      if (Number(trimmed) === targetWeek) return true;
    }
  }
  return false;
}

// ============ 解析器 ============
function parseCourseTable(html) {
  const $ = cheerio.load(html);
  const courses = [];
  const meta = {};

  meta.weekInfo = ($("#li_showWeek, .main_text").first().text() || "").trim();

  // 方法1: table.kb_table (本周课表，<p title>)
  const kbTable = $("table.kb_table");
  if (kbTable.length > 0) return parseKbTable($, kbTable, courses, meta);

  // 方法2: #kbtable (学期课表，kbcontent1 divs)
  const kbTable2 = $("#kbtable");
  if (kbTable2.length > 0) return parseKbTable2($, kbTable2, courses, meta);

  return { meta, courses, count: 0 };
}

// 方法1: table.kb_table
function parseKbTable($, table, courses, meta) {
  const wn = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  meta.headers = [];
  table.find("thead th").each((_, th) => meta.headers.push($(th).text().trim()));

  table.find("tbody tr").each((rowIdx, row) => {
    const cells = $(row).find("td");
    if (cells.length < 8) return;
    const slot = parseTimeSlot($(cells[0]).text().trim());
    if (!slot) return;

    for (let d = 1; d <= 7; d++) {
      const pTag = $(cells[d]).find("p");
      if (pTag.length === 0) continue;
      const title = pTag.attr("title") || "";
      if (!title) continue;

      let decoded = title.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      const parts = decoded.split(/<br\s*\/?>/i);
      const fields = {};
      parts.forEach(p => {
        p = p.replace(/<\/?[^>]+>/g, "").trim();
        if (!p) return;
        const m = p.match(/^(.+?)[：:](.+)$/);
        if (m) fields[m[1].trim()] = m[2].trim();
      });

      let weeks = "";
      if (fields["上课时间"]) {
        const wm = fields["上课时间"].match(/第(\d+[-,\d]*)周/);
        if (wm) weeks = wm[1];
      }

      courses.push({
        name: fields["课程名称"] || "?",
        credit: fields["课程学分"] || "",
        type: fields["课程属性"] || "",
        teacher: fields["上课教师"] || "",
        location: fields["上课地点"] || "",
        timeDesc: fields["上课时间"] || "",
        weekday: d, dayName: wn[d],
        periods: slot.start + "-" + slot.end + "节", timeSlot: slot.time,
        group: fields["分组名"] || "",
        weeks: weeks,
      });
    }
  });
  return { meta, courses, count: courses.length };
}

// 方法2: #kbtable
function parseKbTable2($, table, courses, meta) {
  const wn = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  meta.headers = [];
  table.find("tr:first-child th").each((_, th) => {
    const t = $(th).text().trim();
    if (t && t !== "&nbsp;") meta.headers.push(t);
  });

  table.find("tr").each((rowIdx, row) => {
    const firstCell = $(row).find("th, td").first();
    if (firstCell.length === 0) return;
    const slot = parseTimeSlot(firstCell.text().trim());
    if (!slot) return;

    const cells = $(row).find("td");
    if (cells.length < 7) return;

    cells.each((colIdx, cell) => {
      if (colIdx >= 7) return;
      $(cell).find("div.kbcontent1").each((_, div) => {
        const divHtml = $(div).html() || "";
        const text = $(div).text().trim();
        if (!text || text.length < 2) return;

        const blocks = divHtml.split(/<hr.*?>|-{10,}/i);
        blocks.forEach(block => {
          if (!block.trim() || block.trim().length < 5) return;
          const b$ = cheerio.load("<div>" + block + "</div>");
          const lines = b$("div").html()?.split(/<br\s*\/?>/i) || [];
          if (lines.length === 0) return;

          const c = {
            weekday: colIdx + 1, dayName: wn[colIdx + 1],
            periods: slot.start + "-" + slot.end + "节", timeSlot: slot.time,
            name: "", teacher: "", location: "", weeks: "", group: "",
          };

          c.name = lines[0]?.replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, " ").trim() || "";

          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, " ").trim();
            if (!line) continue;
            if (/^\(.+\)$/.test(line)) { c.group = line.replace(/[()]/g, ""); continue; }
            const tm = lines[i].match(/title=['"]([^'"]+)['"]/);
            if (tm) {
              if (tm[1] === "老师") c.teacher = line;
              else if (tm[1].includes("周次")) c.weeks = line;
              else if (tm[1] === "教室") c.location = line;
            }
          }

          if (c.name) courses.push(c);
        });
      });
    });
  });

  return { meta, courses, count: courses.length };
}

function parseTimeSlot(label) {
  const slots = {
    "上午1-2节": { start: 1, end: 2, time: "08:00-09:40" },
    "上午3-4节": { start: 3, end: 4, time: "10:00-11:40" },
    "下午5-6节": { start: 5, end: 6, time: "14:30-16:10" },
    "下午7-8节": { start: 7, end: 8, time: "16:20-18:00" },
    "晚上9-11节": { start: 9, end: 11, time: "19:00-21:25" },
  };
  for (const [k, v] of Object.entries(slots)) {
    if (label.startsWith(k)) return v;
  }
  return null;
}

// ============ HTML 生成 ============
function generateHTML(result, username) {
  const timeSlots = [
    { label: "1-2节", time: "08:00-09:40", key: "1-2节" },
    { label: "3-4节", time: "10:00-11:40", key: "3-4节" },
    { label: "5-6节", time: "14:30-16:10", key: "5-6节" },
    { label: "7-8节", time: "16:20-18:00", key: "7-8节" },
    { label: "9-11节", time: "19:00-21:25", key: "9-11节" },
  ];

  const grid = {};
  timeSlots.forEach(s => { grid[s.key] = {}; for (let d = 1; d <= 7; d++) grid[s.key][d] = []; });
  result.courses.forEach(c => {
    const p = c.periods;
    if (grid[p] && c.weekday) grid[p][c.weekday].push(c);
  });

  const colors = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const colorMap = {}; let ci = 0;
  result.courses.forEach(c => {
    const base = c.name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, "").substring(0, 8);
    if (!colorMap[base]) { colorMap[base] = colors[ci % colors.length]; ci++; }
  });

  const weekTag = result.filterWeek ? "第" + result.filterWeek + "周" : (result.meta.weekInfo || "全部");
  const nowStr = new Date().toLocaleString("zh-CN");

  let rows = "";
  timeSlots.forEach(s => {
    rows += "<tr><td>" + s.label + "<br><small>" + s.time + "</small></td>";
    for (let d = 1; d <= 7; d++) {
      rows += "<td>";
      (grid[s.key][d] || []).forEach(c => {
        const cls = colorMap[c.name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, "").substring(0, 8)] || "c1";
        rows += '<div class="course ' + cls + '"><b>' + c.name + '</b>';
        if (c.location) rows += '<s>📍 ' + c.location + '</s>';
        if (c.weeks) rows += '<s>📅 ' + c.weeks + '</s>';
        if (c.teacher) rows += '<s>👤 ' + c.teacher + '</s>';
        if (c.group) rows += '<s>👥 ' + c.group + '</s>';
        rows += '</div>';
      });
      rows += "</td>";
    }
    rows += "</tr>";
  });

  return '<!DOCTYPE html>\n<html lang="zh">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>课程表 - ' + weekTag + '</title>\n<style>\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:"Microsoft YaHei","PingFang SC",sans-serif;background:#f0f2f5;padding:20px;color:#333}\n.wrap{max-width:1100px;margin:0 auto}\nh1{text-align:center;font-size:20px;margin-bottom:4px;color:#1a1a2e}\n.sub{text-align:center;font-size:13px;color:#999;margin-bottom:18px}\ntable{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}\nth,td{border:1px solid #e8e8e8;padding:8px 6px;text-align:center;vertical-align:top;font-size:12px}\nth{background:#1a1a2e;color:#fff;font-weight:500}\nth:first-child{width:72px}\ntd:first-child{background:#fafafa;font-size:11px;color:#888;font-weight:500;line-height:1.6}\n.course{margin-bottom:5px;padding:4px 5px;border-radius:3px;font-size:11px;line-height:1.5;text-align:left}\n.course b{display:block;font-size:11px;margin-bottom:1px}\n.course s{display:block;font-size:10px;color:#666}\n.c1{background:#e3f2fd;border-left:3px solid #2196f3}\n.c2{background:#fff3e0;border-left:3px solid #ff9800}\n.c3{background:#e8f5e9;border-left:3px solid #4caf50}\n.c4{background:#fce4ec;border-left:3px solid #e91e63}\n.c5{background:#f3e5f5;border-left:3px solid #9c27b0}\n.c6{background:#e0f7fa;border-left:3px solid #00bcd4}\n.footer{text-align:center;margin-top:16px;font-size:11px;color:#bbb}\n</style>\n</head>\n<body>\n<div class="wrap">\n<h1>📅 课程表</h1>\n<div class="sub">学号: ' + username + ' | ' + weekTag + ' | 更新: ' + nowStr + '</div>\n<table>\n<thead><tr><th>节次</th><th>周一</th><th>周二</th><th>周三</th><th>周四</th><th>周五</th><th>周六</th><th>周日</th></tr></thead>\n<tbody>' + rows + '\n</tbody></table>\n<div class="footer">Auto-generated | HBUST Course Crawler</div>\n</div></body></html>';
}

// ============ 输出 ============
function printCourses(result) {
  console.log("");
  console.log("=".repeat(60));
  const tag = result.filterWeek ? " (仅第" + result.filterWeek + "周)" : "";
  console.log("  " + (result.meta.weekInfo || "") + tag);
  console.log("  共 " + result.count + " 门课程");
  console.log("=".repeat(60));

  const dayOrder = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const grouped = {};
  result.courses.forEach(c => {
    const k = c.dayName || "其他";
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(c);
  });

  dayOrder.forEach(day => {
    const list = grouped[day];
    if (!list || list.length === 0) return;
    console.log("\n  " + day + ":");
    list.sort((a, b) => parseInt(a.periods) - parseInt(b.periods));
    list.forEach(c => {
      const parts = ["[" + c.periods + "]", c.name];
      if (c.location) parts.push(c.location);
      if (c.weeks) parts.push(c.weeks);
      if (c.teacher) parts.push("👤" + c.teacher);
      if (c.group) parts.push("👥" + c.group);
      console.log("    " + parts.join(" | "));
    });
  });
}

// ============ 核心抓取 ============
async function fetchAndSave(username, password, filterWeek) {
  const client = createClient();
  if (!(await login(client, username, password))) {
    throw new Error("登录失败");
  }

  const resp = await client.get(CONFIG.kbPath, {
    headers: { Referer: CONFIG.baseURL + CONFIG.mainPath },
    params: filterWeek ? { zc: filterWeek } : {},
  });
  const html = typeof resp.data === "string" ? resp.data : String(resp.data);

  // 自动检测周次
  let week = filterWeek;
  if (!week) {
    week = await detectCurrentWeek(client, html);
    if (week) console.log("[*] 检测到当前: 第" + week + "周");
  }

  let result = parseCourseTable(html);

  // 过滤本周
  if (week) {
    const before = result.courses.length;
    result.courses = result.courses.filter(c => weekInRange(c.weeks, week));
    result.filterWeek = week;
    if (before !== result.courses.length) {
      console.log("[*] 周次过滤: " + before + " → " + result.courses.length + " 门 (第" + week + "周)");
    }
  }
  result.count = result.courses.length;

  return result;
}

// ============ 主入口 ============
async function main() {
  const args = process.argv.slice(2);

  let username = "", password = "", filterWeek = null, daemon = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--week" && args[i + 1]) {
      filterWeek = parseInt(args[i + 1]); i++;
    } else if (args[i] === "--daemon") {
      daemon = true;
    } else if (!username) {
      username = args[i];
    } else if (!password) {
      password = args[i];
    }
  }

  username = username || process.env.JWGL_USER || "";
  password = password || process.env.JWGL_PASS || "";

  if (!username || !password) {
    console.log("用法: node crawler.js <学号> <密码> [--week N] [--daemon]");
    console.log("  --week N   指定第N周");
    console.log("  --daemon   每小时自动更新");
    process.exit(1);
  }

  if (daemon) {
    console.log("=".repeat(60));
    console.log("  自动更新模式 (每小时)");
    console.log("=".repeat(60));
    console.log("[*] 学号: " + username);
    console.log("[*] 按 Ctrl+C 停止\n");

    async function tick() {
      const time = new Date().toLocaleTimeString("zh-CN");
      try {
        console.log("\n[" + time + "] 更新中...");
        const result = await fetchAndSave(username, password, filterWeek);
        fs.mkdirSync("outputs", { recursive: true });
        fs.writeFileSync("outputs/courses.json", JSON.stringify(result, null, 2), "utf-8");
        fs.writeFileSync("outputs/schedule.html", generateHTML(result, username), "utf-8");
        const tag = result.filterWeek ? "第" + result.filterWeek + "周" : "全部";
        console.log("[" + time + "] ✅ " + result.count + "门课程 → outputs/schedule.html (" + tag + ")");
      } catch (err) {
        console.error("[" + time + "] ❌ " + err.message);
      }
    }

    await tick();
    setInterval(tick, 60 * 60 * 1000);
  } else {
    console.log("=".repeat(60));
    console.log("  湖北科技学院教务系统 - 课程表爬虫");
    console.log("=".repeat(60));
    console.log("[*] 学号: " + username + "\n");

    const result = await fetchAndSave(username, password, filterWeek);
    printCourses(result);

    fs.mkdirSync("outputs", { recursive: true });
    fs.writeFileSync("outputs/courses.json", JSON.stringify(result, null, 2), "utf-8");
    fs.writeFileSync("outputs/schedule.html", generateHTML(result, username), "utf-8");
    console.log("\n[+] outputs/schedule.html");
    console.log("[+] outputs/courses.json");
  }
}

main().catch(err => { console.error("[-] " + err.message); process.exit(1); });


