import { describe, expect, it } from 'vitest';
import { buildGoogleImageUrl } from '../src/shared/googleSearch.ts';
import {
  buildCanonicalRawKey,
  normalizeFallbackJa,
  parseBlogRssXml,
  parseTouchakuHtml,
  toFullWidthKatakana,
} from '../src/worker/parser.ts';

const SAMPLE_TOUCHAKU_HTML = `<!DOCTYPE html>
<html lang="ja">
<body>
<div class="wrap">
<div class="title">11月23日の荷物・到着時間のお知らせ</div>
<div class="arrival">11:55頃到着予定です</div>
<div class="section">
環八荻窪店の到着予定時間を表示しています<br>
明大前店、永福店は30分以上早く到着します
</div>
<div class="section">
次回の入荷予定は11月25日です<br>
入荷時間に合わせて当日更新されます
</div>
<div class="section">
<div class="comment-title">コメント</div>
<div class="comment-body">以下の画像は本日入荷のごく一部の画像です　（行き先確定前）<br /><br />入荷時間に合わせてお越しください。</div>
</div>
<div class="image-list">
  <div class="image-item"><img src="uploads/img_20261123_100618_7946.jpg" alt=""></div>
  <div class="image-item"><img src="uploads/img_20261123_100618_6548.jpg" alt=""></div>
</div>
</div>
</body>
</html>`;

const SAMPLE_RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <item rdf:about="http://bigflowersugi.blog.fc2.com/blog-entry-1835.html">
    <link>http://bigflowersugi.blog.fc2.com/blog-entry-1835.html</link>
    <title>11/23 切花・鉢花入荷品種詳細</title>
    <content:encoded><![CDATA[入荷時間は以下のリンクからご確認ください。<br>https://www.bigflower.co.jp/hp/i-touchakuDisp.htm<br><br>＜切花＞<br>品種	大きさ<br>ｱﾘｿﾞﾅｲﾄｽｷﾞ'ﾌﾞﾙ-ｱｲｽ'	50CM<br>ｳﾗｼﾞﾛﾓﾐ	40CM<br>ｳﾗｼﾞﾛﾓﾐ	40CM<br>ｻﾑﾗｲ08	40<br>ｻﾑﾗｲ08	秀<br>品種	大きさ(寸)<br>パンジー	3.5	寸<br>シクラメン	5	寸]]></content:encoded>
    <dc:subject>未分類</dc:subject>
    <dc:date>2026-11-23T10:26:18+09:00</dc:date>
  </item>
  <item rdf:about="http://bigflowersugi.blog.fc2.com/blog-entry-1834.html">
    <link>http://bigflowersugi.blog.fc2.com/blog-entry-1834.html</link>
    <title>11/21 鉢花入荷品種詳細</title>
    <content:encoded><![CDATA[品名	品種	大きさ(寸)<br>ｱｻﾞﾚｱ	ｱｻﾞﾚｱ	4.5<br>ｼｸﾗﾒﾝ	ｼｸﾗﾒﾝ	5]]></content:encoded>
    <dc:subject>鉢花入荷品種詳細</dc:subject>
    <dc:date>2026-11-21T10:42:57+09:00</dc:date>
  </item>
  <item rdf:about="http://bigflowersugi.blog.fc2.com/blog-entry-1833.html">
    <link>http://bigflowersugi.blog.fc2.com/blog-entry-1833.html</link>
    <title>11/20 切花・鉢花入荷品種詳細</title>
    <content:encoded><![CDATA[品名	品種<br>ﾊﾞﾗ	ｻﾑﾗｲ08<br>ﾊﾞﾗ	ｻﾑﾗｲ08<br>ﾓﾝｽﾃﾗ(葉)	ﾓﾝｽﾃﾗ(ﾊ)<br>宿根ｶｽﾐｿｳ"ﾍﾞ-ﾙｽﾀ-"	ｼﾕﾂｺﾝｶｽﾐｿｳ'ﾍﾞ-ﾙｽﾀ-'<br>ﾋﾊﾞｽｷﾞﾙｲ	ひむろ杉<br>装飾用資材	ｿｳｼﾖｸﾖｳｼｻﾞｲ<br>鉢花<br>品名	品種	大きさ(寸)	容姿<br>ｼｸﾗﾒﾝ	ｼｸﾗﾒﾝ	5	寸]]></content:encoded>
    <dc:subject>切り花入荷品種詳細</dc:subject>
    <dc:date>2026-11-20T11:13:02+09:00</dc:date>
  </item>
</rdf:RDF>`;

describe('katakana & normalization', () => {
  it('converts half-width katakana with dakuten and prolonged sound marks', () => {
    expect(toFullWidthKatakana("ｱﾘｿﾞﾅｲﾄｽｷﾞ'ﾌﾞﾙ-ｱｲｽ'")).toBe(
      "アリゾナイトスギ'ブル-アイス'",
    );
    expect(normalizeFallbackJa("ｱﾘｿﾞﾅｲﾄｽｷﾞ'ﾌﾞﾙ-ｱｲｽ'")).toBe(
      'アリゾナイトスギ「ブルーアイス」',
    );
    expect(normalizeFallbackJa('ｳｲﾝﾀ-ﾍﾞﾘ-(ｱｶﾐ)')).toBe('ウインターベリー(アカミ)');
  });

  it('produces identical canonical keys regardless of half-width vs full-width', () => {
    expect(buildCanonicalRawKey("ｱﾘｿﾞﾅｲﾄｽｷﾞ'ﾌﾞﾙ-ｱｲｽ'")).toBe(
      buildCanonicalRawKey('アリゾナイトスギ「ブルーアイス」'),
    );
  });
});

describe('parseTouchakuHtml', () => {
  it('extracts date, arrival time, store note, next date, and proxied image URLs', () => {
    const beforeArrival = new Date('2026-11-23T10:30:00+09:00');
    const infoBefore = parseTouchakuHtml(SAMPLE_TOUCHAKU_HTML, beforeArrival);
    expect(infoBefore.dateLabel).toBe('11月23日');
    expect(infoBefore.isoDate).toBe('2026-11-23');
    expect(infoBefore.arrivalTime).toBe('11:55');
    expect(infoBefore.isToday).toBe(true);
    expect(infoBefore.isArrived).toBe(false);
    expect(infoBefore.nextArrivalText).toBe('次回の入荷予定は11月25日です');
    expect(infoBefore.images).toHaveLength(2);
    expect(infoBefore.images[0].url).toBe(
      'https://bigflower.co.jp/touchaku/uploads/img_20261123_100618_7946.jpg',
    );
    expect(infoBefore.images[0].proxyUrl).toContain('/api/image?url=');

    const afterArrival = new Date('2026-11-23T12:10:00+09:00');
    const infoAfter = parseTouchakuHtml(SAMPLE_TOUCHAKU_HTML, afterArrival);
    expect(infoAfter.isArrived).toBe(true);
  });
});

describe('parseBlogRssXml', () => {
  it('extracts only cut flowers across Format A, Format B, and skips potted-only posts', () => {
    const posts = parseBlogRssXml(SAMPLE_RSS_XML, new Date('2026-11-23T15:00:00+09:00'));
    expect(posts).toHaveLength(3);

    // Format A (11/23): 品種 \t 大きさ, stops at 品種 \t 大きさ(寸)
    const nov23 = posts[0];
    expect(nov23.hasCutFlowers).toBe(true);
    expect(nov23.isPottedOnly).toBe(false);
    expect(nov23.rawItems.map((i) => i.fallbackCleanedJa)).toEqual([
      'アリゾナイトスギ「ブルーアイス」',
      'ウラジロモミ',
      'サムライ08',
    ]);
    expect(nov23.rawItems[1].lotCount).toBe(2);
    expect(nov23.rawItems[2].lotCount).toBe(2);
    expect(nov23.rawItems[2].sizes).toEqual(['40', '秀']);

    // Potted-only post (11/21)
    const nov21 = posts[1];
    expect(nov21.hasCutFlowers).toBe(false);
    expect(nov21.isPottedOnly).toBe(true);
    expect(nov21.rawItems).toHaveLength(0);

    // Format B (11/20): 品名 \t 品種, skips 装飾用資材 and stops at 鉢花
    const nov20 = posts[2];
    expect(nov20.hasCutFlowers).toBe(true);
    expect(nov20.ruleNeedsFallback).toBe(false);
    expect(nov20.rawItems.map((i) => i.fallbackCleanedJa)).toEqual([
      'バラ サムライ08',
      'モンステラ(葉)',
      '宿根カスミソウ「ベールスター」',
      'ひむろ杉',
    ]);
    expect(nov20.rawItems[0].lotCount).toBe(2);
  });

  it('handles space-delimited rows, bracketed potted boundaries, and flags unknown cut-flower formats for Workers AI fallback', () => {
    const spaceAndUnknownXml = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <item rdf:about="http://bigflowersugi.blog.fc2.com/blog-entry-1901.html">
    <link>http://bigflowersugi.blog.fc2.com/blog-entry-1901.html</link>
    <title>11/25 切花入荷詳細</title>
    <content:encoded><![CDATA[【切花】<br>ﾊﾞﾗ  ｻﾑﾗｲ08<br>ｶｽﾐｿｳ  ｱﾙﾀｲﾙ<br>ﾕﾘ  ｶｻﾌﾞﾗﾝｶ<br>【鉢花】<br>ｼｸﾗﾒﾝ  5寸]]></content:encoded>
    <dc:subject>切り花入荷品種詳細</dc:subject>
    <dc:date>2026-11-25T09:10:00+09:00</dc:date>
  </item>
  <item rdf:about="http://bigflowersugi.blog.fc2.com/blog-entry-1902.html">
    <link>http://bigflowersugi.blog.fc2.com/blog-entry-1902.html</link>
    <title>11/27 切花入荷品種詳細</title>
    <content:encoded><![CDATA[本日は新しい形式で記載します。<br>1. バラ（サムライ08） 50cm<br>2. ユーカリ 銀世界 60cm<br>3. オンシジウム ハニーエンジェル L<br>4. カサブランカ 秀]]></content:encoded>
    <dc:subject>切り花入荷品種詳細</dc:subject>
    <dc:date>2026-11-27T09:10:00+09:00</dc:date>
  </item>
</rdf:RDF>`;

    const posts = parseBlogRssXml(
      spaceAndUnknownXml,
      new Date('2026-11-27T10:00:00+09:00'),
    );
    expect(posts[0].hasCutFlowers).toBe(true);
    expect(posts[0].ruleNeedsFallback).toBe(false);
    expect(posts[0].rawItems.map((i) => i.fallbackCleanedJa)).toEqual([
      'バラ',
      'カスミソウ',
      'ユリ',
    ]);

    expect(posts[1].ruleNeedsFallback).toBe(true);
    expect(posts[1].fallbackReason).toContain('0 条');
    expect(posts[1].rawExcerpt).toContain('バラ（サムライ08）');
  });
});

describe('buildGoogleImageUrl', () => {
  it('encodes cleaned flower name into Google Image search URL', () => {
    const url = buildGoogleImageUrl('バラ サムライ08');
    expect(url).toContain('https://www.google.com/search?');
    expect(url).toContain('tbm=isch');
    expect(url).toContain('udm=2');
    expect(url).toContain(encodeURIComponent('バラ サムライ08').replace(/%20/g, '+'));
  });
});
