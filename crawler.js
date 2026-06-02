/**
 * 湖北科技学院教务系统 - 课程表爬虫
 * 使用说明: node crawler.js <学号> <密码>
 * 输出: JSON 格式课程表数据 (outputs/courses.json)
 *
 * 适用系统: 强智科技教务管理系统
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
  kbApiPath: "/jsxsd/xskb/xskb_list.do",
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  },
};

// ============ Base64 编码 (与前端 encodeInp 一致) ============
const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

function encodeInp(input) {
  let output = "";
  let chr1, chr2, chr3;
  let enc1, enc2, enc3, enc4;
  let i = 0;

  do {
    chr1 = input.charCodeAt(i++);
    chr2 = input.charCodeAt(i++);
    chr3 = input.charCodeAt(i++);

    enc1 = chr1 >> 2;
    enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
    enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
    enc4 = chr3 & 63;

    if (isNaN(chr2)) {
      enc3 = enc4 = 64;
    } else if (isNaN(chr3)) {
      enc4 = 64;
    }

    output +=
      BASE64_CHARS.charAt(enc1) +
      BASE64_CHARS.charAt(enc2) +
      BASE64_CHARS.charAt(enc3) +
      BASE64_CHARS.charAt(enc4);

    chr1 = chr2 = chr3 = "";
    enc1 = enc2 = enc3 = enc4 = "";
  } while (i < input.length);

  return output;
}

// ============ 创建 HTTP 客户端 ============
function createClient() {
  const jar = new CookieJar();
  return wrapper(
    axios.create({
      jar,
      baseURL: CONFIG.baseURL,
      headers: CONFIG.headers,
      maxRedirects: 5,
      validateStatus: () => true,
    })
  );
}

// ============ 登录模块 ============
async function login(client, username, password) {
  console.log("[*] 正在登录...");

  // 1. 先访问登录页获取 JSESSIONID
  const initResp = await client.get("/jsxsd/");
  console.log(`[*] 初始请求: ${initResp.status}`);

  // 2. 构造登录参数
  const encoded = encodeInp(username) + "%%%" + encodeInp(password);

  const loginResp = await client.post(
    CONFIG.loginPath,
    new URLSearchParams({ encoded }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: CONFIG.baseURL,
        Referer: CONFIG.baseURL + "/jsxsd/",
      },
    }
  );

  console.log(`[*] 登录响应: ${loginResp.status}`);

  // 判断是否成功
  const finalUrl = loginResp.request?.res?.responseUrl || "";
  const location = loginResp.headers["location"] || "";

  if (
    finalUrl.includes("xsMain") ||
    location.includes("xsMain") ||
    location.includes("LoginToXk") === false  // 没被踢回登录页
  ) {
    console.log("[+] 登录成功!");
    return true;
  }

  // 检查错误信息
  if (loginResp.data && typeof loginResp.data === "string") {
    if (loginResp.data.includes("账号或密码") ||
        loginResp.data.includes("用户名或密码") ||
        loginResp.data.includes("密码错误")) {
      const $ = cheerio.load(loginResp.data);
      const msg = $("#showMsg").text().trim() || "账号或密码错误";
      console.error(`[-] 登录失败: ${msg}`);
      return false;
    }
  }

  // 没明确失败就继续
  console.log("[!] 登录状态不明确，继续尝试抓取...");
  return true;
}

// ============ 从主页面提取课表链接 ============
async function findKbLinks(client) {
  console.log("[*] 访问主页面获取导航...");
  const resp = await client.get(CONFIG.mainPath, {
    headers: { Referer: CONFIG.baseURL + "/jsxsd/" },
  });

  if (resp.status !== 200 || !resp.data) return [];

  const $ = cheerio.load(resp.data);
  const links = [];

  // iframe 中的 src
  $("iframe").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      links.push(src.startsWith("/") ? src : "/jsxsd/" + src);
    }
  });

  // 超链接
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim().toLowerCase();
    if (href &&
        (href.includes("kb") || text.includes("课表") || text.includes("课程") ||
         href.includes("xskb") || text.includes("schedule"))) {
      links.push(href.startsWith("/") ? href : "/jsxsd/" + href);
    }
  });

  console.log(`[*] 从主页面发现 ${links.length} 个可能的课表链接`);
  return [...new Set(links)]; // 去重
}

// ============ 抓取课程表 HTML ============
async function fetchCoursePage(client) {
  // 优先: 从主页面提取的链接
  const dynamicLinks = await findKbLinks(client);

  // 备选: 常见课表路径
  const fallbackUrls = [CONFIG.kbApiPath];

  const allUrls = [...new Set([...dynamicLinks, ...fallbackUrls])];

  for (const path of allUrls) {
    console.log(`[*] 尝试: ${path}`);
    const resp = await client.get(path, {
      headers: { Referer: CONFIG.baseURL + CONFIG.mainPath },
    });

    if (resp.status === 200 && resp.data) {
      const html = typeof resp.data === "string" ? resp.data : String(resp.data);
      if (html.includes("课程") || html.includes("课表") || html.includes("星期") ||
          html.includes("节次") || html.includes("教师") || html.length > 3000) {
        console.log(`[+] 找到课程表页面: ${path}`);
        return html;
      }
    }
  }

  throw new Error("未能找到课程表页面，请确认账号已选课或尝试手动登录后查看课表 URL");
}

// ============ 解析课程表 HTML ============
function parseCourseTable(html) {
  const $ = cheerio.load(html);
  const courses = [];
  const meta = {};

  // 学期信息
  meta.title = $("title").text().trim() || "课程表";
  $("#xnd option:selected, #xnxqid option:selected, select[name='xnd'] option:selected, select[name='xnxqid'] option:selected")
    .each((_, el) => {
      meta.semester = meta.semester || "";
      meta.semester += $(el).text().trim() + " ";
    });
  meta.semester = (meta.semester || "").trim();

  // ===== 策略 1: 标准课表表格 (包含星期/节次) =====
  let targetTable = null;
  $("table").each((_, table) => {
    const html = $.html(table);
    if (html.includes("星期一") || html.includes("周二") || html.includes("星期") ||
        html.includes("节次") || html.includes("第1节")) {
      targetTable = $(table);
      return false;
    }
  });

  // ===== 策略 2: 带课程/教师/教室关键字的表格 =====
  if (!targetTable) {
    $("table").each((_, table) => {
      const html = $.html(table);
      if ((html.match(/课程/g) || []).length >= 3 ||
          (html.match(/教师/g) || []).length >= 3 ||
          (html.match(/教室/g) || []).length >= 3) {
        targetTable = $(table);
        return false;
      }
    });
  }

  // ===== 策略 3: 常见 class/id 名称 =====
  if (!targetTable) {
    targetTable = $(".kbtable, #kbtable, table.kb_table, .table_kb, #Table1");
  }

  if (targetTable && targetTable.length > 0) {
    console.log("[+] 找到课表表格，解析中...");

    const rows = targetTable.find("tr");

    // 表头
    rows.first().find("th, td").each((_, cell) => {
      meta.headers = meta.headers || [];
      meta.headers.push($(cell).text().trim());
    });

    // 数据行
    rows.slice(1).each((rowIdx, row) => {
      $(row).find("td, th").each((colIdx, cell) => {
        const cellText = $(cell).text().trim();
        if (!cellText || cellText === " " || /^\d+$/.test(cellText)) return;

        // 分割课程信息 (常见分隔符: 换行 / br / 空格多行)
        const lines = cellText
          .split(/[\n\r]+|<br\s*\/?>/i)
          .map(s => s.trim())
          .filter(Boolean);

        if (lines.length === 0) return;

        const course = {
          name: lines[0] || "",
          teacher: lines[1] || "",
          classroom: lines[2] || "",
          weeks: lines[3] || "",
          row: rowIdx,      // 节次 (0-based)
          col: colIdx,      // 星期几 (0-based, 0=周一)
          raw: cellText,
        };

        if (course.name && !/^\d/.test(course.name.substring(0, 1))) {
          // 过滤掉以数字开头的干扰行
          courses.push(course);
        }
      });
    });
  }

  // ===== 策略 4: 列表形式的课程 (非表格布局) =====
  if (courses.length === 0) {
    $("tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length >= 5) {
        const texts = cells.map((_, c) => $(c).text().trim()).get();
        // 判断是否像课程数据行
        if (texts[1] && texts[1].length > 1 && isNaN(Number(texts[1]))) {
          courses.push({
            seq: texts[0] || "",
            name: texts[1] || texts[2] || "",
            teacher: texts[3] || "",
            time: texts[texts.length - 2] || "",
            classroom: texts[texts.length - 1] || "",
            raw: texts.join(" | "),
          });
        }
      }
    });
  }

  return { meta, courses, count: courses.length };
}

// ============ 输出格式化 ============
function printCourses(result) {
  console.log("");
  console.log("=".repeat(56));

  if (result.meta.semester) {
    console.log(`  学期: ${result.meta.semester}`);
  }
  console.log(`  共解析出 ${result.count} 门课程`);
  console.log("=".repeat(56));

  if (result.courses.length > 0) {
    // 判断是课表形式还是列表形式
    const isGrid = result.courses[0].row !== undefined;

    if (isGrid) {
      // 按星期+节次排序
      result.courses.sort((a, b) => a.col - b.col || a.row - b.row);

      const weekNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
      let currentDay = -1;

      result.courses.forEach((c, i) => {
        if (c.col !== currentDay) {
          currentDay = c.col;
          console.log(`\n  ${weekNames[currentDay % 7] || "周" + (currentDay + 1)}:`);
        }
        console.log(
          `    [${c.row + 1}-${c.row + 2}节] ${c.name} | ${c.teacher || ""} | ${c.classroom || ""} | ${c.weeks || ""}`
        );
      });
    } else {
      // 列表形式
      result.courses.forEach((c, i) => {
        console.log(`  [${i + 1}] ${c.name}`);
        if (c.teacher) console.log(`      教师: ${c.teacher}`);
        if (c.classroom) console.log(`      教室: ${c.classroom}`);
        if (c.time) console.log(`      时间: ${c.time}`);
        if (c.seq) console.log(`      序号: ${c.seq}`);
        if (c.weeks) console.log(`      周次: ${c.weeks}`);
      });
    }
  }
}

// ============ 主流程 ============
async function main() {
  const args = process.argv.slice(2);

  let username, password;

  if (args.length >= 2) {
    [username, password] = args;
  } else {
    console.log("用法: node crawler.js <学号> <密码>");
    console.log("示例: node crawler.js 12345678901 mypassword\n");
    // 尝试从环境变量读取
    username = process.env.JWGL_USER;
    password = process.env.JWGL_PASS;
    if (!username || !password) {
      console.log("也可设置环境变量: JWGL_USER=学号 JWGL_PASS=密码 node crawler.js");
      process.exit(1);
    }
  }

  console.log("=".repeat(56));
  console.log("  湖北科技学院教务系统 - 课程表爬虫");
  console.log("  " + CONFIG.baseURL);
  console.log("=".repeat(56));
  console.log(`[*] 学号: ${username}\n`);

  const client = createClient();

  try {
    // 1. 登录
    const ok = await login(client, username, password);
    if (!ok) {
      console.error("[-] 登录失败，请检查账号密码");
      process.exit(1);
    }

    // 2. 抓取课程表
    const html = await fetchCoursePage(client);

    // 3. 保存原始 HTML
    const htmlPath = "work/course_page.html";
    fs.mkdirSync("work", { recursive: true });
    fs.writeFileSync(htmlPath, html, "utf-8");
    console.log(`[*] 原始页面: ${htmlPath}`);

    // 4. 解析
    const result = parseCourseTable(html);

    // 5. 输出
    printCourses(result);

    // 6. 保存 JSON
    fs.mkdirSync("outputs", { recursive: true });
    const jsonPath = "outputs/courses.json";
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");
    console.log(`\n[+] JSON 结果: ${jsonPath}`);

    if (result.count === 0) {
      console.log("[!] 未能解析出课程，请检查 work/course_page.html 手动确认页面结构");
    }
  } catch (err) {
    console.error(`[-] 错误: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
