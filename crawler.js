/**
 * 湖北科技学院教务系统 - 课程表爬虫 v3
 * 用法: node crawler.js <学号> <密码>
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
  mainPath: "/jsxsd/framework/xsMain.jsp",
  kbPath: "/jsxsd/xskb/xskb_list.do",
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
  return wrapper(axios.create({ jar, baseURL: CONFIG.baseURL, headers: CONFIG.headers, maxRedirects: 5, validateStatus: () => true }));
}

async function login(client, username, password) {
  console.log("[*] 正在登录...");
  await client.get("/jsxsd/");
  const r = await client.post(CONFIG.loginPath, new URLSearchParams({ encoded: encodeInp(username) + "%%%" + encodeInp(password) }), {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: CONFIG.baseURL, Referer: CONFIG.baseURL + "/jsxsd/" },
  });
  const body = typeof r.data === "string" ? r.data : "";
  if (r.headers["location"]?.includes("xsMain") || body.includes("xsMain") || body.includes("学期理论课表")) {
    console.log("[+] 登录成功!"); return true;
  }
  if (body.includes("用户名或密码错误")) { console.error("[-] 账号或密码错误"); return false; }
  console.log("[!] 状态不明, 尝试继续..."); return true;
}

// ===== 解析器 =====
function parseCourseTable(html) {
  const $ = cheerio.load(html);
  const courses = [];
  const meta = {};

  // 学期/周次
  meta.weekInfo = ($("#li_showWeek, .main_text").first().text() || "").trim();

  // 先尝试方法1: kb_table (用户粘贴的格式, <p title="...">)
  const kbTable = $("table.kb_table");
  if (kbTable.length > 0) return parseKbTable($, kbTable, courses, meta);

  // 方法2: #kbtable (实际页面格式, kbcontent1 divs)
  const kbTable2 = $("#kbtable");
  if (kbTable2.length > 0) return parseKbTable2($, kbTable2, courses, meta);

  return { meta, courses, count: 0 };
}

// 方法1: table.kb_table 格式 (用户粘贴)
function parseKbTable($, table, courses, meta) {
  const weekNames = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  meta.headers = [];
  table.find("thead th").each((_, th) => meta.headers.push($(th).text().trim()));

  table.find("tbody tr").each((rowIdx, row) => {
    const cells = $(row).find("td");
    if (cells.length < 8) return;
    const timeLabel = $(cells[0]).text().trim();
    const slot = parseTimeSlot(timeLabel, rowIdx);

    for (let day = 1; day <= 7; day++) {
      const pTag = $(cells[day]).find("p");
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
        name: fields["课程名称"] || "?", credit: fields["课程学分"] || "",
        type: fields["课程属性"] || "", teacher: fields["上课教师"] || "",
        location: fields["上课地点"] || "", timeDesc: fields["上课时间"] || "",
        weekday: day, dayName: weekNames[day],
        periods: `${slot.start}-${slot.end}节`, timeSlot: slot.time,
        group: fields["分组名"] || "",
      });
    }
  });
  return { meta, courses, count: courses.length };
}

// 方法2: #kbtable 格式 (实际页面)
function parseKbTable2($, table, courses, meta) {
  const weekNames = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  meta.headers = [];
  table.find("tr:first-child th").each((_, th) => {
    const t = $(th).text().trim();
    if (t && t !== "&nbsp;") meta.headers.push(t);
  });

  table.find("tr").each((rowIdx, row) => {
    const firstCell = $(row).find("th, td").first();
    if (firstCell.length === 0) return;
    const label = firstCell.text().trim();
    const slot = parseTimeSlot(label, rowIdx);
    if (!slot) return; // skip header rows

    const cells = $(row).find("td");
    if (cells.length < 7) return;

    cells.each((colIdx, cell) => {
      if (colIdx >= 7) return;
      // 取 kbcontent1 (折叠状态) 的 div
      const divs = $(cell).find("div.kbcontent1");
      if (divs.length === 0) return;

      divs.each((_, div) => {
        const html = $(div).html() || "";
        const text = $(div).text().trim();
        if (!text || text.length < 2) return;

        // 按 ----- 分割多个课程
        const blocks = html.split(/<hr.*?>|-{10,}/i);
        blocks.forEach(block => {
          if (!block.trim() || block.trim().length < 5) return;
          const b$ = cheerio.load("<div>" + block + "</div>");
          const lines = b$("div").html()?.split(/<br\s*\/?>/i) || [];
          if (lines.length === 0) return;

          const course = {
            weekday: colIdx + 1,
            dayName: weekNames[colIdx + 1],
            periods: `${slot.start}-${slot.end}节`,
            timeSlot: slot.time,
            name: "", teacher: "", location: "", weeks: "", group: "",
          };

                    course.name = lines[0]?.replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, " ").trim() || "";

          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, " ").trim();
            if (!line || line === "&nbsp;") continue;
            // 分组信息通常在括号里
            if (/^\(.+\)$/.test(line)) { course.group = line.replace(/[()]/g, ""); continue; }
            // font title 属性包含字段名
            const titleMatch = lines[i].match(/title=['"]([^'"]+)['"]/);
            const text = line;
            if (titleMatch) {
              const t = titleMatch[1];
              if (t === "老师") course.teacher = text;
              else if (t.includes("周次")) course.weeks = text;
              else if (t === "教室") course.location = text;
            }
          }

          if (course.name) courses.push(course);
        });
      });
    });
  });

  return { meta, courses, count: courses.length };
}

function parseTimeSlot(label, rowIdx) {
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
  console.log("");
  console.log("=".repeat(60));
  if (result.meta.weekInfo) console.log(`  ${result.meta.weekInfo}`);
  console.log(`  共 ${result.count} 门课程`);
  console.log("=".repeat(60));

  const dayOrder = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const grouped = {};
  result.courses.forEach(c => {
    const key = c.dayName || "其他";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  });

  dayOrder.forEach(day => {
    const list = grouped[day];
    if (!list || list.length === 0) return;
    console.log(`\n  ${day}:`);
    list.sort((a, b) => parseInt(a.periods) - parseInt(b.periods));
    list.forEach(c => {
      const parts = [`[${c.periods}]`, c.name];
      if (c.location) parts.push(c.location);
      if (c.teacher) parts.push(c.teacher);
      if (c.weeks) parts.push(c.weeks);
      if (c.type) parts.push(c.type);
      if (c.group) parts.push("分组:" + c.group);
      console.log("    " + parts.join(" | "));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const username = args[0] || process.env.JWGL_USER;
  const password = args[1] || process.env.JWGL_PASS;
  if (!username || !password) {
    console.log("用法: node crawler.js <学号> <密码>");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("  湖北科技学院教务系统 - 课程表爬虫");
  console.log("=".repeat(60));
  console.log(`[*] 学号: ${username}\n`);

  const client = createClient();
  try {
    if (!(await login(client, username, password))) process.exit(1);
    console.log("[*] 抓取课程表...");
    const resp = await client.get(CONFIG.kbPath, {
      headers: { Referer: CONFIG.baseURL + CONFIG.mainPath },
    });
    const html = typeof resp.data === "string" ? resp.data : String(resp.data);
    fs.mkdirSync("work", { recursive: true });
    fs.writeFileSync("work/course_page.html", html, "utf-8");

    const result = parseCourseTable(html);
    printCourses(result);

    fs.mkdirSync("outputs", { recursive: true });
    fs.writeFileSync("outputs/courses.json", JSON.stringify(result, null, 2), "utf-8");
    console.log(`\n[+] JSON: outputs/courses.json`);
    if (result.count === 0) console.log("[!] 未解析出课程，查看 work/course_page.html");
  } catch (err) {
    console.error(`[-] ${err.message}`);
    process.exit(1);
  }
}

main();

