/**
 * 湖北科技学院教务系统 - 本周课程表爬虫
 *
 * 用法:
 *   node crawler.js <学号> <密码>              # 单次抓取
 *   node crawler.js <学号> <密码> --daemon     # 每小时自动更新
 *
 * 输出: outputs/schedule.html
 */

"use strict";

const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const cheerio = require("cheerio");
const fs = require("fs");

const CONFIG = {
  baseURL: "https://jwgl.hbust.edu.cn",
  loginPath: "/jsxsd/xk/LoginToXk",
  kbPath: "/jsxsd/framework/main_index_loadkb.jsp",
  getDateParam: () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  },
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  },
};

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
  return wrapper(axios.create({
    jar, baseURL: CONFIG.baseURL, headers: CONFIG.headers,
    maxRedirects: 5, validateStatus: () => true,
  }));
}

async function login(client, username, password) {
  await client.get("/jsxsd/");
  await client.post(CONFIG.loginPath,
    new URLSearchParams({ encoded: encodeInp(username) + "%%%" + encodeInp(password) }), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: CONFIG.baseURL,
        Referer: CONFIG.baseURL + "/jsxsd/",
      },
    });
}

function parseKbTable(html) {
  const $ = cheerio.load(html);
  const table = $("table.kb_table");
  if (table.length === 0) return { courses: [], count: 0 };

  const courses = [];
  const wn = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

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

      courses.push({
        name: fields["课程名称"] || "?",
        credit: fields["课程学分"] || "",
        type: fields["课程属性"] || "",
        location: fields["上课地点"] || "",
        weekday: d,
        dayName: wn[d],
        periods: slot.start + "-" + slot.end + "节",
        timeSlot: slot.time,
        group: fields["分组名"] || "",
      });
    }
  });

  return { courses, count: courses.length };
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

function printCourses(result) {
  console.log("\n" + "=".repeat(48));
  console.log("  本周课表  |  共 " + result.count + " 门");
  console.log("=".repeat(48));

  const dayOrder = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const grouped = {};
  result.courses.forEach(c => {
    if (!grouped[c.dayName]) grouped[c.dayName] = [];
    grouped[c.dayName].push(c);
  });

  dayOrder.forEach(day => {
    const list = grouped[day];
    if (!list || list.length === 0) return;
    console.log("\n  " + day + ":");
    list.sort((a, b) => parseInt(a.periods) - parseInt(b.periods));
    list.forEach(c => {
      const p = ["[" + c.periods + "]", c.name, c.location, c.type + " " + c.credit + "学分"];
      if (c.group) p.push("分组:" + c.group);
      console.log("    " + p.filter(Boolean).join(" | "));
    });
  });
}

function generateHTML(result, username) {
  const ts = [
    { label: "1-2节", time: "08:00-09:40", key: "1-2节" },
    { label: "3-4节", time: "10:00-11:40", key: "3-4节" },
    { label: "5-6节", time: "14:30-16:10", key: "5-6节" },
    { label: "7-8节", time: "16:20-18:00", key: "7-8节" },
    { label: "9-11节", time: "19:00-21:25", key: "9-11节" },
  ];
  const grid = {};
  ts.forEach(s => { grid[s.key] = {}; for (let d = 1; d <= 7; d++) grid[s.key][d] = []; });
  result.courses.forEach(c => { const p = c.periods; if (grid[p] && c.weekday) grid[p][c.weekday].push(c); });

  const colors = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const cm = {}; let ci = 0;
  result.courses.forEach(c => {
    const base = c.name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, "").substring(0, 8);
    if (!cm[base]) { cm[base] = colors[ci % colors.length]; ci++; }
  });

  const nowStr = new Date().toLocaleString("zh-CN");
  let rows = "";
  ts.forEach(s => {
    rows += "<tr><td>" + s.label + "<br><small>" + s.time + "</small></td>";
    for (let d = 1; d <= 7; d++) {
      rows += "<td>";
      const cs = grid[s.key][d] || [];
      if (cs.length === 0) rows += '<span class="empty">-</span>';
      cs.forEach(c => {
        const cls = cm[c.name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, "").substring(0, 8)] || "c1";
        rows += '<div class="course ' + cls + '"><b>' + c.name + '</b>';
        if (c.location) rows += '<span>📍 ' + c.location + '</span>';
        if (c.type || c.credit) rows += '<span>📋 ' + c.type + ' | ' + c.credit + '学分</span>';
        if (c.group) rows += '<span>👥 ' + c.group + '</span>';
        rows += '</div>';
      });
      rows += "</td>";
    }
    rows += "</tr>";
  });

  return '<!DOCTYPE html>\n<html lang="zh">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>本周课表</title>\n<style>\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:"Microsoft YaHei","PingFang SC",sans-serif;background:#f5f6fa;padding:24px;color:#333}\n.wrap{max-width:1100px;margin:0 auto}\nh1{text-align:center;font-size:22px;margin-bottom:4px;color:#1a1a2e;font-weight:600}\n.sub{text-align:center;font-size:13px;color:#999;margin-bottom:20px}\ntable{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.06);table-layout:fixed}\nth,td{border:1px solid #eee;padding:10px 6px;text-align:center;vertical-align:top;font-size:12px}\nth{background:#1a1a2e;color:#fff;font-weight:500;padding:10px 6px}\nth:first-child{width:68px}\ntd:first-child{background:#f8f9fc;font-size:11px;color:#999;font-weight:500;line-height:1.6;width:68px;padding:10px 4px}\n.course{margin-bottom:4px;padding:6px 7px;border-radius:4px;font-size:11px;line-height:1.6;text-align:left}\n.course b{display:block;font-size:11px;margin-bottom:1px;color:#222}\n.course span{display:block;font-size:10px;color:#777;line-height:1.4}\n.empty{color:#ddd;font-size:14px;line-height:40px}\n.c1{background:#e8f0fe;border-left:3px solid #4285f4}\n.c2{background:#fff8e1;border-left:3px solid #f9a825}\n.c3{background:#e8f5e9;border-left:3px solid #43a047}\n.c4{background:#fce4ec;border-left:3px solid #e91e63}\n.c5{background:#f3e5f5;border-left:3px solid #8e24aa}\n.c6{background:#e0f7fa;border-left:3px solid #00acc1}\n.footer{text-align:center;margin-top:16px;font-size:11px;color:#bbb}\n</style>\n</head>\n<body>\n<div class="wrap">\n<h1>课程表</h1>\n<div class="sub">学号: ' + username + ' | 更新: ' + nowStr + '</div>\n<table>\n<thead><tr><th>节次</th><th>周一</th><th>周二</th><th>周三</th><th>周四</th><th>周五</th><th>周六</th><th>周日</th></tr></thead>\n<tbody>' + rows + '\n</tbody></table>\n<div class="footer">HBUST Course Crawler</div>\n</div></body></html>';
}

async function main() {
  const args = process.argv.slice(2);
  const username = args.find((_, i) => i === 0 && !args[i].startsWith("--")) || process.env.JWGL_USER || "";
  const password = args.find((_, i) => i === 1 && !args[i].startsWith("--")) || process.env.JWGL_PASS || "";
  const daemon = args.includes("--daemon");

  if (!username || !password) {
    console.log("用法: node crawler.js <学号> <密码> [--daemon]");
    console.log("  --daemon  每小时自动更新");
    process.exit(1);
  }

  async function runOnce() {
    const client = createClient();
    await login(client, username, password);
    const resp = await client.get(CONFIG.kbPath, {
      headers: { Referer: CONFIG.baseURL + "/jsxsd/framework/xsMain.jsp" },
      params: { rq: CONFIG.getDateParam() },
    });
    const html = typeof resp.data === "string" ? resp.data : String(resp.data);
    fs.mkdirSync("work", { recursive: true });
    fs.writeFileSync("work/kb_raw.html", html, "utf-8");
    return parseKbTable(html);
  }

  if (daemon) {
    console.log("=".repeat(48));
    console.log("  HBUST 课表 | 自动更新 (每小时)");
    console.log("=".repeat(48));
    console.log("[*] 学号: " + username + " | Ctrl+C 停止\n");

    const tick = async () => {
      const t = new Date().toLocaleTimeString("zh-CN");
      try {
        process.stdout.write("[" + t + "] 更新中...");
        const result = await runOnce();
        fs.mkdirSync("outputs", { recursive: true });
        fs.writeFileSync("outputs/courses.json", JSON.stringify(result, null, 2), "utf-8");
        fs.writeFileSync("outputs/schedule.html", generateHTML(result, username), "utf-8");
        console.log(" ✅ " + result.count + "门 → outputs/schedule.html");
      } catch (err) {
        console.log(" ❌ " + err.message);
      }
    };

    await tick();
    setInterval(tick, 60 * 60 * 1000);
  } else {
    console.log("=".repeat(48));
    console.log("  HBUST 本周课表爬虫");
    console.log("=".repeat(48));
    console.log("[*] 学号: " + username);

    const result = await runOnce();
    console.log("[+] 登录成功, 抓取完成");
    printCourses(result);

    fs.mkdirSync("outputs", { recursive: true });
    fs.writeFileSync("outputs/courses.json", JSON.stringify(result, null, 2), "utf-8");
    fs.writeFileSync("outputs/schedule.html", generateHTML(result, username), "utf-8");
    console.log("\n[+] outputs/schedule.html");
  }
}

main().catch(err => { console.error("[-] " + err.message); process.exit(1); });
