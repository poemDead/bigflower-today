export type DictionaryStatus = 'ai' | 'verified';

export type FlowerSource = 'verified' | 'ai' | 'untranslated';

export interface TouchakuImage {
  url: string;
  proxyUrl: string;
  filename: string;
}

export interface TouchakuInfo {
  title: string;
  dateLabel: string | null;
  isoDate: string | null;
  arrivalText: string;
  arrivalTime: string | null;
  isToday: boolean;
  isArrived: boolean;
  storeNote: string;
  nextArrivalText: string | null;
  comment: string;
  images: TouchakuImage[];
  sourceUrl: string;
}

export interface CutFlowerRawItem {
  rawKey: string;
  rawDisplay: string;
  fallbackCleanedJa: string;
  sizes: string[];
  lotCount: number;
}

export interface DictionaryEntry {
  rawKey: string;
  rawSample: string;
  cleanedJa: string;
  zhName: string;
  enName: string;
  category: string;
  status: DictionaryStatus;
  aiModel: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CutFlowerItem {
  rawKey: string;
  rawDisplay: string;
  cleanedJa: string;
  zhName: string;
  enName: string;
  category: string;
  sizes: string[];
  lotCount: number;
  source: FlowerSource;
  aiModel: string | null;
  confirmedAt: string | null;
  googleImageUrl: string;
}

export type ParserMode = 'rule' | 'workers_ai' | 'anthropic' | 'failed';

export interface ParserAlert {
  postId: string;
  postTitle: string;
  postUrl: string;
  isoDate: string;
  reason: string;
  fallbackStatus: 'workers_ai_ok' | 'anthropic_ok' | 'failed';
  fallbackItemCount: number;
  rawExcerpt: string;
  createdAt: string;
  updatedAt: string;
}

export interface BlogBatchSummary {
  id: string;
  title: string;
  link: string;
  publishedAt: string;
  isoDate: string;
  dateLabel: string;
  hasCutFlowers: boolean;
  isPottedOnly: boolean;
  cutFlowerCount: number;
  parserMode?: ParserMode;
}

export interface BlogBatchDetail extends BlogBatchSummary {
  images: TouchakuImage[];
  items: CutFlowerItem[];
}

export type TodayArrivalStatus = 'arrived' | 'scheduled' | 'listed' | 'no_cut_flowers';

export interface ArrivalStats {
  total: number;
  verified: number;
  ai: number;
  untranslated: number;
}

export interface ArrivalResponse {
  todayJst: string;
  nowJst: string;
  hasTodayCutFlowers: boolean;
  todayStatus: TodayArrivalStatus;
  todayStatusMessage: string;
  touchaku: TouchakuInfo | null;
  selectedBatch: BlogBatchDetail | null;
  recentCutFlowerBatches: BlogBatchSummary[];
  recentAllBatches: BlogBatchSummary[];
  stats: ArrivalStats;
  aiConfigured: boolean;
  canTriggerAi: boolean;
  aiProviderLabel: string | null;
  parserAlerts: ParserAlert[];
  fetchedAt: string;
  warnings: string[];
}

export interface UpsertDictionaryRequest {
  rawKey: string;
  rawSample?: string;
  cleanedJa: string;
  zhName: string;
  enName: string;
  category?: string;
  status?: DictionaryStatus;
}

export interface TranslateBatchRequest {
  batchId?: string;
  rawKeys?: string[];
  forceRetranslateAi?: boolean;
  limit?: number;
}

export interface TranslateBatchResponse {
  translatedCount: number;
  skippedVerifiedCount: number;
  failedCount: number;
  remainingCount: number;
  providerLabel: string | null;
  entries: DictionaryEntry[];
  error?: string;
}
