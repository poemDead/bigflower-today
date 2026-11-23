import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const targetPath = path.resolve(process.cwd(), '.dev.vars');
const defaultModel = 'deepseek/deepseek-v4.1-flash-1017';

function upsertEnvFile(filePath, updates) {
  let lines = [];
  if (fs.existsSync(filePath)) {
    lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  }
  const seen = new Set();
  const nextLines = lines
    .filter((line, idx) => !(idx === lines.length - 1 && line === ''))
    .map((line) => {
      const match = line.match(/^([A-Z0-9_]+)=/);
      if (match && Object.prototype.hasOwnProperty.call(updates, match[1])) {
        seen.add(match[1]);
        return `${match[1]}=${updates[match[1]]}`;
      }
      return line;
    });

  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) {
      nextLines.push(`${k}=${v}`);
    }
  }

  fs.writeFileSync(filePath, `${nextLines.join('\n')}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

process.stdout.write(
  '请输入 OPENROUTER_API_KEY（输入时不回显，粘贴后回车；没有可前往 https://openrouter.ai/keys 创建）: ',
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

rl._writeToOutput = () => {};

rl.question('', (answer) => {
  rl.close();
  process.stdout.write('\n');
  const key = answer.trim();
  if (!key) {
    console.error('未输入 Key，已取消。');
    process.exit(1);
  }
  upsertEnvFile(targetPath, {
    OPENROUTER_API_KEY: key,
    OPENROUTER_MODEL: defaultModel,
  });
  console.log(
    `已安全保存到 ${targetPath}（权限 600，保留已有其他 Key，默认模型 ${defaultModel}，不会提交到 Git）。`,
  );
  console.log('接下来可以运行：npm run test:openrouter');
});
