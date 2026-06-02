/**
 * 一键推送项目到 GitHub
 * 用法: node push-to-github.js <GitHub用户名> <Token> [仓库名]
 */

const git = require("isomorphic-git");
const http = require("isomorphic-git/http/node");
const fs = require("fs");
const path = require("path");

const PROJECT_DIR = __dirname;

async function exec(cmd) {
  const { execSync } = require("child_process");
  // 这个函数作为备用，但 isomorphic-git 不需要它
}

// ========== 创建 GitHub 仓库 ==========
async function createGitHubRepo(username, token, repoName) {
  console.log(`[*] 创建 GitHub 仓库: ${username}/${repoName}`);

  const resp = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${username}:${token}`).toString("base64"),
      "Content-Type": "application/json",
      "User-Agent": "node.js",
    },
    body: JSON.stringify({
      name: repoName,
      description: "湖北科技学院教务系统课程表爬虫",
      private: false,
      auto_init: false,
    }),
  });

  if (resp.status === 201) {
    console.log("[+] 仓库创建成功!");
    return true;
  } else if (resp.status === 422) {
    console.log("[!] 仓库已存在，直接使用");
    return true;
  } else {
    const body = await resp.text();
    console.error(`[-] 创建仓库失败: ${resp.status} ${body}`);
    return false;
  }
}

// ========== Git 初始化 + 提交 + 推送 ==========
async function pushToGitHub(username, token, repoName) {
  const remoteUrl = `https://github.com/${username}/${repoName}.git`;
  const authUrl = `https://${username}:${token}@github.com/${username}/${repoName}.git`;

  // 清理已有的 .git
  const gitDir = path.join(PROJECT_DIR, ".git");
  if (fs.existsSync(gitDir)) {
    fs.rmSync(gitDir, { recursive: true, force: true });
    console.log("[*] 已清理原有 .git 目录");
  }

  // 1. git init
  console.log("[*] git init");
  await git.init({ fs, dir: PROJECT_DIR, defaultBranch: "main" });

  // 2. 收集要提交的文件
  const allFiles = [];
  function walkDir(dir, base = "") {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === "work" ||
        entry.name === "outputs"
      )
        continue;
      if (entry.isDirectory()) {
        walkDir(fullPath, relPath);
      } else {
        allFiles.push(relPath);
      }
    }
  }
  walkDir(PROJECT_DIR);
  console.log(`[*] 待提交文件: ${allFiles.length} 个`);

  // 3. git add
  for (const file of allFiles) {
    await git.add({ fs, dir: PROJECT_DIR, filepath: file });
  }
  console.log("[*] git add 完成");

  // 4. git commit
  const sha = await git.commit({
    fs,
    dir: PROJECT_DIR,
    message: "Initial commit: 教务系统课程表爬虫",
    author: { name: username, email: `${username}@users.noreply.github.com` },
  });
  console.log(`[+] git commit: ${sha}`);

  // 5. git remote add
  await git.addRemote({
    fs,
    dir: PROJECT_DIR,
    remote: "origin",
    url: remoteUrl,
  });
  console.log(`[*] 添加远程: ${remoteUrl}`);

  // 6. git push
  console.log("[*] git push (可能需要几秒钟)...");
  const pushResult = await git.push({
    fs,
    http,
    dir: PROJECT_DIR,
    remote: "origin",
    ref: "main",
    url: authUrl,
    onAuth: () => ({
      username: token,
      password: "x-oauth-basic",
    }),
  });

  if (pushResult.error) {
    console.error(`[-] Push 失败: ${pushResult.error}`);
    return false;
  }

  console.log("[+] Push 成功!");
  console.log(`\n  仓库地址: https://github.com/${username}/${repoName}`);
  return true;
}

// ========== 主流程 ==========
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("用法: node push-to-github.js <GitHub用户名> <Token> [仓库名]");
    console.log("");
    console.log("如何获取 Token:");
    console.log("  1. 打开 https://github.com/settings/tokens");
    console.log("  2. 点击 'Generate new token (classic)'");
    console.log("  3. 勾选 'repo' 权限");
    console.log("  4. 生成并复制 token");
    console.log("");
    console.log("示例:");
    console.log("  node push-to-github.js myname ghp_xxxxxx");
    console.log("  node push-to-github.js myname ghp_xxxxxx hbust-course-crawler");
    process.exit(1);
  }

  const username = args[0];
  const token = args[1];
  const repoName = args[2] || "hbust-course-crawler";

  console.log("=".repeat(56));
  console.log("  推送项目到 GitHub");
  console.log("=".repeat(56));
  console.log(`  用户: ${username}`);
  console.log(`  仓库: ${username}/${repoName}`);
  console.log("");

  // 1. 创建仓库
  const created = await createGitHubRepo(username, token, repoName);
  if (!created) {
    console.error("[-] 无法创建仓库，请检查 Token 权限");
    process.exit(1);
  }

  // 2. 推送
  const pushed = await pushToGitHub(username, token, repoName);
  if (!pushed) {
    console.error("[-] 推送失败");
    process.exit(1);
  }

  console.log("\n[+] 完成! 🎉");
}

main().catch((err) => {
  console.error(`[-] 错误: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
