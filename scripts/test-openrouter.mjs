import fs from 'node:fs';
import path from 'node:path';
import { OpenRouter } from '@openrouter/sdk';

function loadDevVars() {
  const devVarsPath = path.resolve(process.cwd(), '.dev.vars');
  if (!fs.existsSync(devVarsPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(devVarsPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const fileVars = loadDevVars();
const apiKey = (process.env.OPENROUTER_API_KEY || fileVars.OPENROUTER_API_KEY || '').trim();
const model = (
  process.argv[2] ||
  process.env.OPENROUTER_MODEL ||
  fileVars.OPENROUTER_MODEL ||
  'deepseek/deepseek-v4.1-flash-1017'
).trim();

if (!apiKey) {
  console.error('未检测到 OPENROUTER_API_KEY。');
  console.error('请先前往 https://openrouter.ai/keys 创建 API Key，然后运行：');
  console.error('  npm run set-openrouter-key');
  process.exit(1);
}

const client = new OpenRouter({
  apiKey,
  httpReferer: 'https://bigflower.dawnlight-flora.com',
  appTitle: 'Big Flower Today',
});

console.log(`正在测试 OpenRouter 端到端调用（模型: ${model}）...`);

try {
  const t0 = Date.now();
  const response = await client.responses.send({
    responsesRequest: {
      model,
      instructions:
        '你是日本切花市场专家。把输入的日文半角花名清洗为标准日文，并给出中文名与英文名，只输出 JSON：{"cleanedJa":"...","zhName":"...","enName":"..."}',
      input: "ｵｷｼﾍﾟﾀﾙﾑ'ﾋﾟﾕｱﾌﾞﾙ-'",
    },
  });

  if (!('output' in response)) {
    throw new Error('Unexpected streaming response from OpenRouter');
  }
  if (response.status !== 'completed') {
    throw new Error(
      response.error?.message ?? `OpenRouter response ended with status: ${response.status}`,
    );
  }

  const text = response.output
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content)
    .filter((part) => part.type === 'output_text' && part.text)
    .map((part) => part.text)
    .join('');

  console.log(`成功（耗时 ${((Date.now() - t0) / 1000).toFixed(2)}s）：`);
  console.log(text);
  if (response.usage) {
    console.log('Usage:', JSON.stringify(response.usage));
  }
} catch (err) {
  console.error('OpenRouter 调用失败：', err instanceof Error ? err.message : err);
  process.exit(1);
}
