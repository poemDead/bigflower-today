import type {
  BlogBatchSummary,
  CutFlowerRawItem,
  TouchakuImage,
  TouchakuInfo,
} from '../shared/types.ts';

export const TOUCHAKU_URL = 'https://bigflower.co.jp/touchaku/index.php';
export const BLOG_RSS_URL = 'http://bigflowersugi.blog.fc2.com/?xml';
export const BLOG_HOME_URL = 'http://bigflowersugi.blog.fc2.com/';

const HALFWIDTH_KANA_MAP: Record<string, string> = {
  '｡': '。',
  '｢': '「',
  '｣': '」',
  '､': '、',
  '･': '・',
  'ｦ': 'ヲ',
  'ｧ': 'ァ',
  'ｨ': 'ィ',
  'ｩ': 'ゥ',
  'ｪ': 'ェ',
  'ｫ': 'ォ',
  'ｬ': 'ャ',
  'ｭ': 'ュ',
  'ｮ': 'ョ',
  'ｯ': 'ッ',
  'ｰ': 'ー',
  'ｱ': 'ア',
  'ｲ': 'イ',
  'ｳ': 'ウ',
  'ｴ': 'エ',
  'ｵ': 'オ',
  'ｶ': 'カ',
  'ｷ': 'キ',
  'ｸ': 'ク',
  'ｹ': 'ケ',
  'ｺ': 'コ',
  'ｻ': 'サ',
  'ｼ': 'シ',
  'ｽ': 'ス',
  'ｾ': 'セ',
  'ｿ': 'ソ',
  'ﾀ': 'タ',
  'ﾁ': 'チ',
  'ﾂ': 'ツ',
  'ﾃ': 'テ',
  'ﾄ': 'ト',
  'ﾅ': 'ナ',
  'ﾆ': 'ニ',
  'ﾇ': 'ヌ',
  'ﾈ': 'ネ',
  'ﾉ': 'ノ',
  'ﾊ': 'ハ',
  'ﾋ': 'ヒ',
  'ﾌ': 'フ',
  'ﾍ': 'ヘ',
  'ﾎ': 'ホ',
  'ﾏ': 'マ',
  'ﾐ': 'ミ',
  'ﾑ': 'ム',
  'ﾒ': 'メ',
  'ﾓ': 'モ',
  'ﾔ': 'ヤ',
  'ﾕ': 'ユ',
  'ﾖ': 'ヨ',
  'ﾗ': 'ラ',
  'ﾘ': 'リ',
  'ﾙ': 'ル',
  'ﾚ': 'レ',
  'ﾛ': 'ロ',
  'ﾜ': 'ワ',
  'ﾝ': 'ン',
};

const DAKUTEN_MAP: Record<string, string> = {
  'ｳ': 'ヴ',
  'ｶ': 'ガ',
  'ｷ': 'ギ',
  'ｸ': 'グ',
  'ｹ': 'ゲ',
  'ｺ': 'ゴ',
  'ｻ': 'ザ',
  'ｼ': 'ジ',
  'ｽ': 'ズ',
  'ｾ': 'ゼ',
  'ｿ': 'ゾ',
  'ﾀ': 'ダ',
  'ﾁ': 'ヂ',
  'ﾂ': 'ヅ',
  'ﾃ': 'デ',
  'ﾄ': 'ド',
  'ﾊ': 'バ',
  'ﾋ': 'ビ',
  'ﾌ': 'ブ',
  'ﾍ': 'ベ',
  'ﾎ': 'ボ',
  'ﾜ': 'ヷ',
  'ｦ': 'ヺ',
};

const HANDAKUTEN_MAP: Record<string, string> = {
  'ﾊ': 'パ',
  'ﾋ': 'ピ',
  'ﾌ': 'プ',
  'ﾍ': 'ペ',
  'ﾎ': 'ポ',
};

export function toFullWidthKatakana(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (next === 'ﾞ' && DAKUTEN_MAP[ch]) {
      out += DAKUTEN_MAP[ch];
      i += 1;
      continue;
    }
    if (next === 'ﾟ' && HANDAKUTEN_MAP[ch]) {
      out += HANDAKUTEN_MAP[ch];
      i += 1;
      continue;
    }
    if (HALFWIDTH_KANA_MAP[ch]) {
      out += HALFWIDTH_KANA_MAP[ch];
      continue;
    }
    // Full-width ASCII digits/letters -> standard ASCII
    const code = ch.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
      continue;
    }
    if (ch === '\u3000') {
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

export function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

export function getJstNow(now: Date = new Date()): {
  todayJst: string;
  nowJst: string;
  hours: number;
  minutes: number;
  year: number;
  month: number;
  day: number;
} {
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  const hours = jst.getUTCHours();
  const minutes = jst.getUTCMinutes();
  const seconds = jst.getUTCSeconds();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayJst = `${year}-${pad(month)}-${pad(day)}`;
  const nowJst = `${todayJst}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}+09:00`;
  return { todayJst, nowJst, hours, minutes, year, month, day };
}

function resolveMonthDayToIso(
  month: number,
  day: number,
  referenceYear: number,
  referenceMonth: number,
): string {
  let year = referenceYear;
  if (referenceMonth === 1 && month === 12) {
    year -= 1;
  } else if (referenceMonth === 12 && month === 1) {
    year += 1;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function makeImageProxyUrl(absoluteUrl: string): string {
  return `/api/image?url=${encodeURIComponent(absoluteUrl)}`;
}

export function parseTouchakuHtml(html: string, now: Date = new Date()): TouchakuInfo {
  const jst = getJstNow(now);

  const extractByClass = (className: string): string => {
    const regex = new RegExp(
      `<div[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`,
      'i',
    );
    const match = html.match(regex);
    return match ? stripHtml(match[1]).replace(/\r\n/g, '\n').trim() : '';
  };

  const title = extractByClass('title');
  const arrivalText = extractByClass('arrival');
  const comment = extractByClass('comment-body');

  const sectionMatches = [
    ...html.matchAll(
      /<div[^>]*class=["'][^"']*\bsection\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    ),
  ].map((m) => stripHtml(m[1]).replace(/\r\n/g, '\n').trim());

  let storeNote = '';
  let nextArrivalText: string | null = null;
  for (const sec of sectionMatches) {
    if (!sec) continue;
    if (sec.includes('環八荻窪') || sec.includes('明大前') || sec.includes('永福')) {
      storeNote = sec;
    } else if (sec.includes('次回の入荷')) {
      const firstLine = sec.split('\n')[0]?.trim() ?? sec;
      nextArrivalText = firstLine;
    }
  }

  let dateLabel: string | null = null;
  let isoDate: string | null = null;
  const dateMatch = title.match(/(\d{1,2})月(\d{1,2})日/);
  if (dateMatch) {
    const month = Number(dateMatch[1]);
    const day = Number(dateMatch[2]);
    dateLabel = `${month}月${day}日`;
    isoDate = resolveMonthDayToIso(month, day, jst.year, jst.month);
  }

  let arrivalTime: string | null = null;
  const timeMatch = arrivalText.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (timeMatch) {
    arrivalTime = `${String(Number(timeMatch[1])).padStart(2, '0')}:${timeMatch[2]}`;
  }

  const isToday = isoDate === jst.todayJst;
  let isArrived = false;
  if (isToday && arrivalTime) {
    const [hStr, mStr] = arrivalTime.split(':');
    const targetMinutes = Number(hStr) * 60 + Number(mStr);
    const nowMinutes = jst.hours * 60 + jst.minutes;
    isArrived = nowMinutes >= targetMinutes;
  } else if (isToday && /到着しました|到着済/.test(arrivalText)) {
    isArrived = true;
  }

  const images: TouchakuImage[] = [];
  const seenUrls = new Set<string>();
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(imgRegex)) {
    const rawSrc = m[1].trim();
    if (!rawSrc) continue;
    try {
      const absolute = new URL(rawSrc, TOUCHAKU_URL).toString();
      if (seenUrls.has(absolute)) continue;
      seenUrls.add(absolute);
      const filename = absolute.split('/').pop() || 'photo.jpg';
      images.push({
        url: absolute,
        proxyUrl: makeImageProxyUrl(absolute),
        filename,
      });
    } catch {
      // Ignore invalid image URLs
    }
  }

  return {
    title,
    dateLabel,
    isoDate,
    arrivalText,
    arrivalTime,
    isToday,
    isArrived,
    storeNote,
    nextArrivalText,
    comment,
    images,
    sourceUrl: TOUCHAKU_URL,
  };
}

/**
 * Deterministic cleanup for fallback display (before AI runs) and canonical dictionary key.
 */
export function normalizeFallbackJa(raw: string): string {
  let s = toFullWidthKatakana(raw).trim();
  // Convert katakana-adjacent hyphen `-` into Japanese prolonged sound mark `ー`
  s = s.replace(/([\u30A0-\u30FF])-([\u30A0-\u30FF'"「」()（）\s]|$)/g, '$1ー$2');
  s = s.replace(/([\u30A0-\u30FF])-([\u30A0-\u30FF'"「」()（）\s]|$)/g, '$1ー$2');
  // Replace paired quotes with Japanese corner brackets for readability
  s = s.replace(/['"]([^'"]+)['"]/g, '「$1」');
  // Clean up unclosed trailing parenthesis from truncated shop exports
  const openParens = (s.match(/\(/g) || []).length;
  const closeParens = (s.match(/\)/g) || []).length;
  if (openParens > closeParens) {
    s = s.replace(/\([^)]*$/, (m) => `${m})`);
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function buildCanonicalRawKey(raw: string): string {
  return normalizeFallbackJa(raw)
    .replace(/[「」'"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function simplifyForComparison(text: string): string {
  return toFullWidthKatakana(text)
    .replace(/['"「」()（）・･\s\-ー]/g, '')
    .replace(/[ァィゥェォャュョッ]/g, (ch) => {
      const bigMap: Record<string, string> = {
        ァ: 'ア',
        ィ: 'イ',
        ゥ: 'ウ',
        ェ: 'エ',
        ォ: 'オ',
        ャ: 'ヤ',
        ュ: 'ユ',
        ョ: 'ヨ',
        ッ: 'ツ',
      };
      return bigMap[ch] || ch;
    })
    .toLowerCase();
}

const GENERIC_GROUP_PREFIXES = new Set([
  'ハモノ',
  'エダモノ',
  'ネイティブフラワー',
  'ヒバスギルイ',
  'ミモノ',
  'キリハナ',
  '切花',
  '切り花',
  '葉物',
  '枝物',
]);

const SKIP_NON_FLOWER_KEYWORDS = [
  '装飾用資材',
  'ソウショクヨウシザイ',
  '資材',
  'オアシス',
  'ラッピング',
];

const POTTED_SECTION_MARKERS = [
  /^[＜<【]?鉢花[＞>】]?$/,
  /^[＜<【]?鉢物[＞>】]?$/,
  /^[＜<【]?花苗[＞>】]?$/,
  /^[＜<【]?観葉(植物)?[＞>】]?$/,
  /^[＜<【]?多肉(植物)?[＞>】]?$/,
  /^[＜<【]?蘭鉢[＞>】]?$/,
  /^鉢[花物]・(花苗|蘭)/,
];

function isPottedHeaderLine(line: string): boolean {
  const normalized = toFullWidthKatakana(line).trim();
  if (POTTED_SECTION_MARKERS.some((re) => re.test(normalized))) {
    return true;
  }
  if (normalized.includes('大きさ(寸)') || normalized.includes('容姿')) {
    return true;
  }
  return false;
}

function isLikelyPottedItemLine(line: string): boolean {
  const normalized = toFullWidthKatakana(line);
  return ['(ハチ)', '(苗)', 'ポット', '花苗'].some((kw) => normalized.includes(kw));
}

function isCutFlowerMarkerLine(line: string): boolean {
  const normalized = toFullWidthKatakana(line).trim();
  return /^[＜<【]?切り?花[＞>】]?$/.test(normalized);
}

function isCutFlowerHeaderLine(line: string): boolean {
  const normalized = toFullWidthKatakana(line).trim();
  if (isCutFlowerMarkerLine(normalized)) return true;
  if (/^品名\s+品種$/.test(normalized)) return true;
  if (/^品種\s+大きさ$/.test(normalized)) return true;
  if (/^品名\s+品種\s+大きさ$/.test(normalized)) return true;
  return false;
}

function isBoilerplateLine(line: string): boolean {
  const s = line.trim();
  if (!s) return true;
  return (
    s.startsWith('入荷時間は') ||
    s.startsWith('入荷は午後') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('パソコンでの閲覧') ||
    s.startsWith('スマホの場合') ||
    s.startsWith('記事の一番下') ||
    s.startsWith('ご覧いただくか') ||
    s.startsWith('※こちらの入荷情報') ||
    s.startsWith('ご来店時に') ||
    s.startsWith('当日入荷情報のデータ') ||
    s.startsWith('本日は入荷ありません') ||
    s.startsWith('下記商品は明日') ||
    s.includes('PCビュー')
  );
}

function splitColumns(line: string): string[] {
  if (line.includes('\t')) {
    return line
      .split('\t')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
  }
  return line
    .split(/\s{2,}/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function combineTwoColumnName(col0: string, col1: string): {
  rawDisplay: string;
  keySource: string;
} {
  const c0 = col0.trim();
  const c1 = col1.trim();
  if (!c1) {
    return { rawDisplay: c0, keySource: c0 };
  }
  const c0Full = toFullWidthKatakana(c0).trim();
  if (GENERIC_GROUP_PREFIXES.has(c0Full)) {
    return { rawDisplay: `${c0} / ${c1}`, keySource: c1 };
  }

  const s0 = simplifyForComparison(c0);
  const s1 = simplifyForComparison(c1);

  if (s0 === s1) {
    return { rawDisplay: c0, keySource: c0 };
  }
  // e.g. ﾓﾝｽﾃﾗ(葉) vs ﾓﾝｽﾃﾗ(ﾊ) or 宿根ｶｽﾐｿｳ"ﾍﾞ-ﾙｽﾀ-" vs ｼﾕﾂｺﾝｶｽﾐｿｳ'ﾍﾞ-ﾙｽﾀ-'
  if (
    s0.includes(s1) ||
    s1.includes(s0) ||
    /["'「]/.test(c0) ||
    (c0.includes('(') && c1.includes('('))
  ) {
    // Prefer col0 because it usually has Kanji + full cultivar name
    return { rawDisplay: c0, keySource: c0 };
  }

  return {
    rawDisplay: `${c0} ${c1}`,
    keySource: `${c0} ${c1}`,
  };
}

export interface ParsedBlogPost extends BlogBatchSummary {
  images: TouchakuImage[];
  rawItems: CutFlowerRawItem[];
  plainText: string;
  rawExcerpt: string;
  contentFingerprint: string;
  ruleNeedsFallback: boolean;
  fallbackReason: string | null;
}

function simpleHashHex(input: string): string {
  // Fast deterministic 64-bit FNV-1a pair for change detection
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function parseCutFlowersFromPostContent(
  title: string,
  subject: string,
  htmlContent: string,
): {
  hasCutFlowers: boolean;
  isPottedOnly: boolean;
  rawItems: CutFlowerRawItem[];
  images: TouchakuImage[];
  plainText: string;
  rawExcerpt: string;
  ruleNeedsFallback: boolean;
  fallbackReason: string | null;
} {
  // Extract any embedded images from the blog post HTML
  const images: TouchakuImage[] = [];
  const seenImg = new Set<string>();
  for (const m of htmlContent.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    const rawSrc = m[1].trim();
    if (!rawSrc || rawSrc.includes('fc2.com/image/headbar')) continue;
    try {
      const abs = new URL(rawSrc, BLOG_HOME_URL).toString();
      if (seenImg.has(abs)) continue;
      seenImg.add(abs);
      images.push({
        url: abs,
        proxyUrl: makeImageProxyUrl(abs),
        filename: abs.split('/').pop() || 'blog.jpg',
      });
    } catch {
      // Ignore invalid URL
    }
  }

  const plainText = stripHtml(htmlContent).replace(/\r\n/g, '\n');
  const lines = plainText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const rawExcerpt = lines.slice(0, 35).join('\n').slice(0, 1400);

  const titleAndSubject = `${title} ${subject}`;
  const mentionsCut = /切り?花/.test(titleAndSubject);
  const mentionsPotted = /鉢花|鉢物|花苗/.test(titleAndSubject);
  if (mentionsPotted && !mentionsCut) {
    return {
      hasCutFlowers: false,
      isPottedOnly: true,
      rawItems: [],
      images,
      plainText,
      rawExcerpt,
      ruleNeedsFallback: false,
      fallbackReason: null,
    };
  }

  let mode: 'waiting' | 'name_size' | 'group_variety' | 'ended' = 'waiting';
  const itemMap = new Map<string, CutFlowerRawItem>();
  let nonBoilerplateLineCount = 0;

  for (const line of lines) {
    if (isBoilerplateLine(line)) continue;
    nonBoilerplateLineCount += 1;

    if (isPottedHeaderLine(line)) {
      if (mode === 'waiting') {
        if (!mentionsCut) {
          return {
            hasCutFlowers: false,
            isPottedOnly: true,
            rawItems: [],
            images,
            plainText,
            rawExcerpt,
            ruleNeedsFallback: false,
            fallbackReason: null,
          };
        }
        // Title promised cut flowers, yet first header we saw was potted!
        return {
          hasCutFlowers: false,
          isPottedOnly: false,
          rawItems: [],
          images,
          plainText,
          rawExcerpt,
          ruleNeedsFallback: true,
          fallbackReason: '标题包含切花但规则解析在遇到盆栽标题前未匹配到切花区',
        };
      }
      mode = 'ended';
      break;
    }

    const normalizedHeader = toFullWidthKatakana(line).trim();
    if (isCutFlowerMarkerLine(normalizedHeader)) {
      if (mode === 'waiting') {
        mode = 'name_size';
      }
      continue;
    }

    if (isCutFlowerHeaderLine(line)) {
      if (/^品名\s+品種/.test(normalizedHeader)) {
        mode = 'group_variety';
      } else if (/^品種\s+大きさ$/.test(normalizedHeader)) {
        mode = 'name_size';
      }
      continue;
    }

    if (mode === 'waiting') {
      continue;
    }

    const cols = splitColumns(line);
    if (cols.length === 0) continue;

    // Guard: if a row unexpectedly ends with `寸` or contains potted markers, we've entered potted plants
    if (cols[cols.length - 1] === '寸' || isLikelyPottedItemLine(line)) {
      if (itemMap.size > 0) {
        mode = 'ended';
        break;
      }
      continue;
    }

    const fullLineNorm = toFullWidthKatakana(line);
    if (SKIP_NON_FLOWER_KEYWORDS.some((kw) => fullLineNorm.includes(kw))) {
      continue;
    }

    let rawDisplay = '';
    let keySource = '';
    let size = '';

    if (mode === 'name_size') {
      rawDisplay = cols[0];
      keySource = cols[0];
      size = cols[1] ? toFullWidthKatakana(cols[1]).trim() : '';
    } else {
      const combined = combineTwoColumnName(cols[0], cols[1] ?? '');
      rawDisplay = combined.rawDisplay;
      keySource = combined.keySource;
      size = cols[2] ? toFullWidthKatakana(cols[2]).trim() : '';
    }

    const rawKey = buildCanonicalRawKey(keySource);
    if (!rawKey) continue;

    const existing = itemMap.get(rawKey);
    if (existing) {
      existing.lotCount += 1;
      if (size && !existing.sizes.includes(size)) {
        existing.sizes.push(size);
      }
    } else {
      itemMap.set(rawKey, {
        rawKey,
        rawDisplay,
        fallbackCleanedJa: normalizeFallbackJa(keySource),
        sizes: size ? [size] : [],
        lotCount: 1,
      });
    }
  }

  const rawItems = Array.from(itemMap.values());
  const isNoStockNotice = /本日は入荷ありません|入荷はありません|お休み/.test(plainText);

  let ruleNeedsFallback = false;
  let fallbackReason: string | null = null;
  if (!isNoStockNotice && mentionsCut && rawItems.length < 3 && nonBoilerplateLineCount >= 4) {
    ruleNeedsFallback = true;
    fallbackReason =
      rawItems.length === 0
        ? '标题标注了切花，但硬规则解析出 0 条（疑似博客表格格式变化）'
        : `标题标注了切花，但硬规则仅解析出 ${rawItems.length} 条（疑似格式变化）`;
  }

  return {
    hasCutFlowers: rawItems.length > 0,
    isPottedOnly: rawItems.length === 0 && mentionsPotted && !mentionsCut,
    rawItems,
    images,
    plainText,
    rawExcerpt,
    ruleNeedsFallback,
    fallbackReason,
  };
}

function extractXmlTag(block: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = block.match(regex);
  if (!match) return '';
  let content = match[1].trim();
  const cdataMatch = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdataMatch) {
    content = cdataMatch[1];
  } else {
    content = decodeHtmlEntities(content);
  }
  return content.trim();
}

export function parseBlogRssXml(xml: string, now: Date = new Date()): ParsedBlogPost[] {
  const jst = getJstNow(now);
  const items: ParsedBlogPost[] = [];
  const itemMatches = xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi);

  for (const m of itemMatches) {
    const block = m[1];
    const title = extractXmlTag(block, 'title');
    const link = extractXmlTag(block, 'link');
    const publishedAt = extractXmlTag(block, 'dc:date');
    const subject = extractXmlTag(block, 'dc:subject');
    const contentHtml =
      extractXmlTag(block, 'content:encoded') || extractXmlTag(block, 'description');

    const idMatch = link.match(/blog-entry-(\d+)/);
    const id = idMatch ? `blog-entry-${idMatch[1]}` : `post-${items.length + 1}`;

    let isoDate = '';
    let dateLabel = '';
    const isoMatch = publishedAt.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
      isoDate = isoMatch[1];
      const [, mm, dd] = isoDate.split('-');
      dateLabel = `${Number(mm)}/${Number(dd)}`;
    } else {
      const titleDateMatch = title.match(/(\d{1,2})\/(\d{1,2})/);
      if (titleDateMatch) {
        const month = Number(titleDateMatch[1]);
        const day = Number(titleDateMatch[2]);
        isoDate = resolveMonthDayToIso(month, day, jst.year, jst.month);
        dateLabel = `${month}/${day}`;
      }
    }

    const parsed = parseCutFlowersFromPostContent(title, subject, contentHtml);
    items.push({
      id,
      title,
      link,
      publishedAt,
      isoDate,
      dateLabel,
      hasCutFlowers: parsed.hasCutFlowers,
      isPottedOnly: parsed.isPottedOnly,
      cutFlowerCount: parsed.rawItems.length,
      parserMode: 'rule',
      images: parsed.images,
      rawItems: parsed.rawItems,
      plainText: parsed.plainText,
      rawExcerpt: parsed.rawExcerpt,
      contentFingerprint: simpleHashHex(`${title}\n${parsed.plainText}`),
      ruleNeedsFallback: parsed.ruleNeedsFallback,
      fallbackReason: parsed.fallbackReason,
    });
  }

  return items;
}
