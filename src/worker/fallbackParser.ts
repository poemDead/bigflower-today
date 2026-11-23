import type { CutFlowerRawItem } from '../shared/types.ts';
import type { AiEnvConfig } from './ai.ts';
import {
  buildCanonicalRawKey,
  normalizeFallbackJa,
  toFullWidthKatakana,
  type ParsedBlogPost,
} from './parser.ts';

export interface WorkersAiBinding {
  run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
}

export interface SendEmailBinding {
  send: (message: {
    from: string | { email: string; name: string };
    to: string | { email: string; name: string };
    subject: string;
    text?: string;
    html?: string;
  }) => Promise<unknown>;
}

export const CLEF_DECISION_MODEL = '@cf/cloudflare/clef';
export const WORKERS_AI_FALLBACK_MODEL = '@cf/openai/gpt-oss-120b';

export interface ClefJudgeResult {
  passed: boolean;
  issueType: string;
  parseCompleteProb: number;
  pottedCleanProb: number;
  reason: string;
}

interface ClefRawResponse {
  answers?: {
    parse_complete?: { noul?: number };
    potted_clean?: { noul?: number };
    issue_type?: {
      choice?: string;
      probabilities?: Record<string, number>;
    };
  };
}

/**
 * Uses Cloudflare's native 27B Clef decision model (free tier, 0 output token cost)
 * to judge whether our deterministic rule parser cleanly extracted all cut flowers.
 */
export async function judgeParsedCutFlowersWithClef(
  ai: WorkersAiBinding,
  post: ParsedBlogPost,
): Promise<ClefJudgeResult> {
  const firstItems = post.rawItems.slice(0, 6).map((i) => i.fallbackCleanedJa);
  const lastItems = post.rawItems.slice(-6).map((i) => i.fallbackCleanedJa);
  const totalLots = post.rawItems.reduce((sum, i) => sum + i.lotCount, 0);

  const state = [
    `BLOG TITLE: ${post.title}`,
    `BLOG RAW EXCERPT (first part):\n${post.plainText.slice(0, 2600)}`,
    post.plainText.length > 2600
      ? `BLOG RAW TAIL (last part):\n${post.plainText.slice(-1200)}`
      : '',
    `RULE PARSER SUMMARY:`,
    `- Extracted unique cut flowers: ${post.rawItems.length} (from ${totalLots} rows)`,
    `- First items: ${firstItems.join(', ') || '(none)'}`,
    `- Last items: ${lastItems.join(', ') || '(none)'}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = (await ai.run(CLEF_DECISION_MODEL, {
    model: 'clef',
    state,
    questions: {
      parse_complete: {
        type: 'noul',
        instructions:
          'Did the rule parser extract almost all cut flowers from the cut-flower section without missing rows or truncating early?',
      },
      potted_clean: {
        type: 'noul',
        instructions:
          'Are the extracted items strictly cut flowers with NO potted plants (鉢花/鉢物/花苗/寸/ポット) leaked into the list?',
      },
      issue_type: {
        type: 'choice',
        instructions: 'Which best describes the rule parser output?',
        criteria: {
          clean: 'Cut flowers accurately extracted, no potted plants leaked, no wrong columns',
          truncated: 'Cut flowers were cut off early or a large portion of cut flowers is missing',
          potted_leaked: 'Potted plants (鉢花/花苗/寸) leaked into the extracted cut-flower list',
          wrong_column: 'Sizes, grades, or non-flower text were extracted instead of flower names',
        },
      },
    },
  })) as ClefRawResponse;

  const parseCompleteProb = Number(response?.answers?.parse_complete?.noul ?? 1);
  const pottedCleanProb = Number(response?.answers?.potted_clean?.noul ?? 1);
  const issueType = response?.answers?.issue_type?.choice || 'clean';

  const passed =
    issueType === 'clean' && parseCompleteProb >= 0.45 && pottedCleanProb >= 0.45;

  const reason = passed
    ? 'Clef 决策模型校验通过'
    : `Clef 决策模型判定解析异常（issue=${issueType}, complete=${parseCompleteProb.toFixed(2)}, pottedClean=${pottedCleanProb.toFixed(2)}）`;

  return {
    passed,
    issueType,
    parseCompleteProb,
    pottedCleanProb,
    reason,
  };
}

const EXTRACTION_SYSTEM_PROMPT = `You extract ONLY cut flowers (切花 / 切り花) from a Japanese flower market blog post (Big Flower).
Rules:
- Exclude ALL potted plants (鉢花, 鉢物, 花苗, ポット, items measured in 寸), potted orchids, and floral supplies (装飾用資材, 資材).
- Preserve the original Japanese flower/variety names accurately without translating them.
- If the post has both 品名 (type) and 品種 (variety), combine them cleanly unless they duplicate each other (e.g. "ﾊﾞﾗ" + "ｻﾑﾗｲ08" -> "バラ サムライ08"; "ﾓﾝｽﾃﾗ(葉)" + "ﾓﾝｽﾃﾗ(ﾊ)" -> "モンステラ(葉)").
- Deduplicate identical cut-flower varieties and count how many times each appeared in lotCount.
- Collect size/grade strings (like "50CM", "2L", "L", "秀", "60") in sizes[].
- Return ONLY a strict JSON array with no markdown fences and no explanation:
[{"name": "...", "sizes": ["..."], "lotCount": 1}]`;

interface ExtractedFlowerRow {
  name?: unknown;
  sizes?: unknown;
  lotCount?: unknown;
}

function parseExtractedArray(rawText: string): CutFlowerRawItem[] {
  const cleaned = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Fallback AI did not return a JSON array');
  }

  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Fallback AI JSON is not an array');
  }

  const itemMap = new Map<string, CutFlowerRawItem>();
  for (const row of parsed as ExtractedFlowerRow[]) {
    if (!row || typeof row !== 'object') continue;
    const rawName = typeof row.name === 'string' ? row.name.trim() : '';
    if (!rawName) continue;

    const rawKey = buildCanonicalRawKey(rawName);
    if (!rawKey) continue;

    const sizes = Array.isArray(row.sizes)
      ? row.sizes
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .map((s) => toFullWidthKatakana(s).trim())
      : [];
    const lotCount =
      typeof row.lotCount === 'number' && Number.isFinite(row.lotCount) && row.lotCount >= 1
        ? Math.round(row.lotCount)
        : 1;

    const existing = itemMap.get(rawKey);
    if (existing) {
      existing.lotCount += lotCount;
      for (const sz of sizes) {
        if (!existing.sizes.includes(sz)) existing.sizes.push(sz);
      }
    } else {
      itemMap.set(rawKey, {
        rawKey,
        rawDisplay: rawName,
        fallbackCleanedJa: normalizeFallbackJa(rawName),
        sizes,
        lotCount,
      });
    }
  }

  return Array.from(itemMap.values());
}

function extractWorkersAiText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    const obj = response as Record<string, unknown>;
    if (typeof obj.response === 'string') return obj.response;
    // OpenAI Responses API shape (used by @cf/openai/gpt-oss-120b)
    if (Array.isArray(obj.output)) {
      let text = '';
      for (const item of obj.output as Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part?.type === 'output_text' && typeof part.text === 'string') {
              text += part.text;
            }
          }
        }
      }
      if (text) return text;
    }
    if (Array.isArray(obj.choices)) {
      const first = obj.choices[0] as { message?: { content?: string } } | undefined;
      if (typeof first?.message?.content === 'string') {
        return first.message.content;
      }
    }
  }
  return JSON.stringify(response);
}

/**
 * Uses Cloudflare Workers AI free-tier @cf/openai/gpt-oss-120b to extract cut-flower rows
 * when the deterministic rule parser fails or Clef flags a format change.
 */
export async function extractCutFlowersWithWorkersAi(
  ai: WorkersAiBinding,
  title: string,
  plainText: string,
): Promise<CutFlowerRawItem[]> {
  const response = await ai.run(WORKERS_AI_FALLBACK_MODEL, {
    instructions: EXTRACTION_SYSTEM_PROMPT,
    input: `Post title: ${title}\n\nPost body:\n${plainText.slice(0, 14000)}`,
    reasoning: { effort: 'low' },
  });

  const text = extractWorkersAiText(response);
  return parseExtractedArray(text);
}

export async function extractCutFlowersWithAnthropicFallback(
  env: AiEnvConfig,
  title: string,
  plainText: string,
): Promise<CutFlowerRawItem[]> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('No Anthropic API key configured for fallback extraction');
  }
  const model = env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-5-5';
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
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Post title: ${title}\n\nPost body:\n${plainText.slice(0, 16000)}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic fallback ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
  return parseExtractedArray(text);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendParserAlertEmail(
  env: {
    EMAIL?: SendEmailBinding;
    ALERT_FROM_EMAIL?: string;
    ALERT_TO_EMAIL?: string;
  },
  alert: {
    postTitle: string;
    postUrl: string;
    isoDate: string;
    reason: string;
    fallbackStatus: 'workers_ai_ok' | 'anthropic_ok' | 'failed';
    fallbackItemCount: number;
    rawExcerpt: string;
  },
): Promise<boolean> {
  if (!env.EMAIL) return false;
  const from = env.ALERT_FROM_EMAIL?.trim() || 'alert@dawnlight-flora.com';
  const to = env.ALERT_TO_EMAIL?.trim() || 'hanzhangzhai@gmail.com';

  const statusLine =
    alert.fallbackStatus === 'workers_ai_ok'
      ? `已由 Cloudflare Workers AI 免费层自动兜底（提取 ${alert.fallbackItemCount} 种切花，前台访问不受影响）`
      : alert.fallbackStatus === 'anthropic_ok'
        ? `已由备用模型自动兜底（提取 ${alert.fallbackItemCount} 种切花）`
        : '自动兜底未能提取出切花（已保留上一期好数据，未覆盖前台）';

  const subject =
    alert.fallbackStatus === 'failed'
      ? `[Big Flower 告警-兜底失败] ${alert.postTitle} 解析异常`
      : `[Big Flower 解析器告警] ${alert.postTitle} 格式变化（已自动兜底 ${alert.fallbackItemCount} 种）`;

  const text = [
    `Big Flower 进货单解析器检测到异常，请抽空更新 src/worker/parser.ts：`,
    ``,
    `文章标题：${alert.postTitle} (${alert.isoDate})`,
    `原文链接：${alert.postUrl}`,
    `触发原因：${alert.reason}`,
    `兜底状态：${statusLine}`,
    ``,
    `--- 原文前段样本（可直接复制修复 parser.ts） ---`,
    alert.rawExcerpt,
  ].join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Noto Sans SC',sans-serif;line-height:1.6;color:#1e2a22;max-width:680px">
      <h2 style="margin:0 0 12px;color:#b8451f">Big Flower 解析器告警</h2>
      <p style="margin:0 0 12px">检测到博客进货单格式疑似变化，请及时更新 <code>src/worker/parser.ts</code>。</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:14px;font-size:14px">
        <tr><td style="padding:6px 10px;background:#f4efe6;font-weight:600;width:96px">文章标题</td><td style="padding:6px 10px;border:1px solid #e6dfd3">${escapeHtml(alert.postTitle)} (${escapeHtml(alert.isoDate)})</td></tr>
        <tr><td style="padding:6px 10px;background:#f4efe6;font-weight:600">原文链接</td><td style="padding:6px 10px;border:1px solid #e6dfd3"><a href="${escapeHtml(alert.postUrl)}">${escapeHtml(alert.postUrl)}</a></td></tr>
        <tr><td style="padding:6px 10px;background:#f4efe6;font-weight:600">触发原因</td><td style="padding:6px 10px;border:1px solid #e6dfd3">${escapeHtml(alert.reason)}</td></tr>
        <tr><td style="padding:6px 10px;background:#f4efe6;font-weight:600">兜底状态</td><td style="padding:6px 10px;border:1px solid #e6dfd3">${escapeHtml(statusLine)}</td></tr>
      </table>
      <div style="font-size:13px;font-weight:600;margin-bottom:6px">原文前段样本：</div>
      <pre style="background:#faf7f2;border:1px solid #e6dfd3;border-radius:8px;padding:12px;font-size:12px;white-space:pre-wrap;overflow-x:auto">${escapeHtml(alert.rawExcerpt)}</pre>
    </div>
  `;

  try {
    await env.EMAIL.send({
      from: { email: from, name: 'Big Flower 解析监控' },
      to,
      subject,
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error('Failed to send parser alert email:', err);
    return false;
  }
}

export async function sendParserAlertWebhook(
  webhookUrl: string | undefined,
  alert: {
    postTitle: string;
    postUrl: string;
    reason: string;
    fallbackStatus: string;
    fallbackItemCount: number;
  },
): Promise<void> {
  const url = webhookUrl?.trim();
  if (!url) return;

  const statusText =
    alert.fallbackStatus === 'workers_ai_ok'
      ? `已由 Workers AI 免费层自动兜底（提取 ${alert.fallbackItemCount} 种）`
      : alert.fallbackStatus === 'anthropic_ok'
        ? `已由备用模型自动兜底（提取 ${alert.fallbackItemCount} 种）`
        : '自动兜底失败，请尽快查看原文';

  const message = `[Big Flower 解析器告警] ${alert.postTitle}\n原因：${alert.reason}\n状态：${statusText}\n原文：${alert.postUrl}\n请及时更新 src/worker/parser.ts。`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: message,
        text: message,
        title: 'Big Flower 解析器告警',
        body: message,
      }),
    });
  } catch {
    // Best-effort
  }
}
