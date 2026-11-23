import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const targetPath = path.resolve(process.cwd(), '.dev.vars');
const model = 'claude-haiku-5-5';

process.stdout.write('请输入 ANTHROPIC_API_KEY（输入时不回显，粘贴后回车）: ');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

// Hide typed/pasted characters
rl._writeToOutput = () => {};

rl.question('', (answer) => {
  rl.close();
  process.stdout.write('\n');
  const key = answer.trim();
  if (!key) {
    console.error('未输入 Key，已取消。');
    process.exit(1);
  }
  const content = `ANTHROPIC_API_KEY=${key}\nANTHROPIC_MODEL=${model}\n`;
  fs.writeFileSync(targetPath, content, { mode: 0o600 });
  fs.chmodSync(targetPath, 0o600);
  console.log(`已安全保存到 ${targetPath}（权限 600，模型 ${model}，不会提交到 Git）。`);
});
