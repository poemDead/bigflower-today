import { OpenRouter } from '@openrouter/sdk';

export interface AiEnvConfig {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
}

export interface AiTranslationInput {
  rawKey: string;
  rawDisplay: string;
  fallbackCleanedJa: string;
}

export interface AiTranslationOutput {
  rawKey: string;
  cleanedJa: string;
  zhName: string;
  enName: string;
  category: string;
}

export interface AiProviderInfo {
  provider: 'openrouter' | 'gemini' | 'openai' | 'anthropic';
  model: string;
  label: string;
}

export function detectAiProvider(env: AiEnvConfig): AiProviderInfo | null {
  if (env.OPENROUTER_API_KEY?.trim()) {
    const model =
      env.OPENROUTER_MODEL?.trim() || 'deepseek/deepseek-v4.1-flash-1017';
    return { provider: 'openrouter', model, label: `OpenRouter (${model})` };
  }
  if (env.ANTHROPIC_API_KEY?.trim()) {
    const model = env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-5-5';
    return { provider: 'anthropic', model, label: `Claude (${model})` };
  }
  if (env.GEMINI_API_KEY?.trim()) {
    const model = env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
    return { provider: 'gemini', model, label: `Gemini (${model})` };
  }
  if (env.OPENAI_API_KEY?.trim()) {
    const model = env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
    return { provider: 'openai', model, label: `OpenAI (${model})` };
  }
  return null;
}

const SYSTEM_PROMPT = `你是日本东京切花市场（特别是 Big Flower ビックフラワー 进货单）的花卉专家与翻译助手。
你会收到一批从 Big Flower 进货单解析出来的切花原始名称（常常是半角片假名、花店缩写、去掉小假名的市场简称、带引号的品种名；且原进货单通常按日本花市五十音顺序排列，连续无花类前缀的品种名往往属于同一种主花，例如バラ或カーネーション）。

请对每一条切花做四件事：
1. cleanedJa：清理为标准、自然、最适合直接拿到 Google 搜图看花长什么样子的日文切花名。
   - 修正半角片假名与大写的拗音促音（如 ﾋﾟﾕｱﾌﾞﾙ- -> ピュアブルー、ｼﾕﾂｺﾝ -> 宿根、ｳｲﾝﾀ-ﾍﾞﾘ- -> ウィンターベリー、ｸｼﾞﾔｸﾋﾊﾞ -> クジャクヒバ、ｳﾝﾘﾕｳﾔﾅｷﾞ -> ウンリュウヤナギ）
   - 展开常见花市缩写（如 ｵﾝｼ -> オンシジウム、ｼﾝﾋﾞ -> シンビジウム、ｶﾗ- -> カラー、SP -> スプレー、HB -> ハイブリッド、ﾌｱﾚﾉ -> ファレノプシス、ｽﾀ-ﾁｽS -> スターチス シヌアータ、ﾕ-ｶﾘ(ﾏﾙﾊ) -> ユーカリ 丸葉）
   - 若仅有品种名且在切花市场中广为人知，请补上花类以提高 Google 搜图准确度（如 サムライ08 / アテナ / ロードス / ヤギパープル -> バラ ...、カサブランカ -> ユリ カサブランカ、ブルーアイス -> アリゾナイトスギ ブルーアイス、シングルペグモ -> マトリカリア シングルベグモ、ベイビーブルー -> ユーカリ ベイビーブルー）
   - 去掉尺寸/等级/箱号/无意义代码（如 50CM、秀、優、4P），保留品种名与花色。
2. zhName：准确、自然、中文花艺圈常用的名称（含品种名，如「玫瑰「武士08」」「蓝星花「纯蓝」」「北美冬青（红果）」「丸叶露丝草」「文心兰「蜜糖天使」」）。
3. enName：准确、自然的英文切花名（含品种名，如 "Rose 'Samurai 08'", "Tweedia 'Pure Blue'", "Broadleaf Ruscus", "Oncidium 'Honey Angel'"）。
4. category：归入简短中文/日文分类之一：「バラ・玫瑰」「ラン・兰花」「ユリ・百合」「キク・菊类」「カーネーション・康乃馨」「実もの・果枝」「グリーン・叶材枝材」「草花・其他切花」。

只输出严格的 JSON 数组，不要 Markdown 代码块，不要任何多余解释。数组每一项必须包含：
{"rawKey": "...", "cleanedJa": "...", "zhName": "...", "enName": "...", "category": "..."}
rawKey 必须与输入完全一致。`;

function buildUserPrompt(items: AiTranslationInput[]): string {
  const payload = items.map((item) => ({
    rawKey: item.rawKey,
    raw: item.rawDisplay,
    normalizedHint: item.fallbackCleanedJa,
  }));
  return `请清洗并翻译以下 ${items.length} 条 Big Flower 切花进货项，返回 JSON 数组：\n${JSON.stringify(payload, null, 2)}`;
}

function extractJsonArray(text: string): AiTranslationOutput[] {
  const trimmed = text.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI response did not contain a valid JSON array');
  }

  const parsed = JSON.parse(stripped.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('AI response JSON is not an array');
  }

  const valid: AiTranslationOutput[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const obj = row as Record<string, unknown>;
    const rawKey = typeof obj.rawKey === 'string' ? obj.rawKey : '';
    const cleanedJa = typeof obj.cleanedJa === 'string' ? obj.cleanedJa.trim() : '';
    const zhName = typeof obj.zhName === 'string' ? obj.zhName.trim() : '';
    const enName = typeof obj.enName === 'string' ? obj.enName.trim() : '';
    const category = typeof obj.category === 'string' ? obj.category.trim() : '';
    if (rawKey && cleanedJa) {
      valid.push({ rawKey, cleanedJa, zhName, enName, category });
    }
  }
  return valid;
}

async function callGemini(
  apiKey: string,
  model: string,
  items: AiTranslationInput[],
): Promise<AiTranslationOutput[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(items) }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 240)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return extractJsonArray(text);
}

async function callOpenAiCompatible(
  apiKey: string,
  baseUrl: string,
  model: string,
  items: AiTranslationInput[],
): Promise<AiTranslationOutput[]> {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(items) },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${errText.slice(0, 240)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  return extractJsonArray(text);
}

async function callAnthropic(
  apiKey: string,
  model: string,
  items: AiTranslationInput[],
): Promise<AiTranslationOutput[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 6144,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(items) }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 240)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
  return extractJsonArray(text);
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  items: AiTranslationInput[],
): Promise<AiTranslationOutput[]> {
  const client = new OpenRouter({
    apiKey,
    httpReferer: 'https://bigflower.dawnlight-flora.com',
    appTitle: 'Big Flower Today',
  });

  const response = await client.responses.send({
    responsesRequest: {
      model,
      instructions: SYSTEM_PROMPT,
      input: buildUserPrompt(items),
    },
  });

  if (!('output' in response)) {
    throw new Error('OpenRouter returned an unexpected streaming response');
  }
  if (response.status !== 'completed') {
    throw new Error(
      response.error?.message ?? `OpenRouter response ended as ${response.status}`,
    );
  }

  let text = '';
  for (const item of response.output) {
    if (item.type === 'message') {
      for (const part of item.content) {
        if (part.type === 'output_text' && part.text) {
          text += part.text;
        }
      }
    }
  }
  return extractJsonArray(text);
}

export async function translateCutFlowersWithAi(
  env: AiEnvConfig,
  items: AiTranslationInput[],
): Promise<{
  provider: AiProviderInfo;
  results: AiTranslationOutput[];
}> {
  const provider = detectAiProvider(env);
  if (!provider) {
    throw new Error(
      '未配置 AI API Key（请在 .dev.vars 或 Cloudflare Secrets 中设置 OPENROUTER_API_KEY / ANTHROPIC_API_KEY）',
    );
  }

  const BATCH_SIZE = 25;
  const results: AiTranslationOutput[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    let chunkResults: AiTranslationOutput[];

    if (provider.provider === 'openrouter') {
      chunkResults = await callOpenRouter(
        env.OPENROUTER_API_KEY!.trim(),
        provider.model,
        chunk,
      );
    } else if (provider.provider === 'gemini') {
      chunkResults = await callGemini(env.GEMINI_API_KEY!.trim(), provider.model, chunk);
    } else if (provider.provider === 'openai') {
      const baseUrl = env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
      chunkResults = await callOpenAiCompatible(
        env.OPENAI_API_KEY!.trim(),
        baseUrl,
        provider.model,
        chunk,
      );
    } else {
      chunkResults = await callAnthropic(
        env.ANTHROPIC_API_KEY!.trim(),
        provider.model,
        chunk,
      );
    }
    results.push(...chunkResults);
  }

  return { provider, results };
}
