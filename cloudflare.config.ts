import { bindings, defineConfig, triggers } from 'cf/config';

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  return {
    worker: {
      name: 'bigflower-today',
      entrypoint: './src/worker/index.ts',
      compatibilityDate: '2026-11-23',
      domains: ['bigflower.dawnlight-flora.com'],
      workersDev: false,
      observability: {
        enabled: true,
        traces: {
          enabled: true,
        },
      },
      triggers: [
        // JST 周一/三/五 08:00-08:45（UTC 周日/二/四 23:00-23:45）
        triggers.scheduled({ schedule: '0,15,30,45 23 * * SUN,TUE,THU' }),
        // JST 周一/三/五 09:00-11:45（UTC 周一/三/五 00:00-02:45）
        triggers.scheduled({ schedule: '0,15,30,45 0-2 * * MON,WED,FRI' }),
        // JST 周一/三/五 12:00（UTC 周一/三/五 03:00）
        triggers.scheduled({ schedule: '0 3 * * MON,WED,FRI' }),
        // 每日 JST 18:30 兜底同步（UTC 09:30）
        triggers.scheduled({ schedule: '30 9 * * *' }),
      ],
      env: {
        DB: bindings.d1({ name: 'bigflower-today-db' }),
        // 线上启用 Cloudflare Workers AI 免费层（Clef 质检裁判 + GPT-OSS 120B 格式兜底）
        AI: isDev ? undefined : bindings.ai(),
        // Cloudflare 原生邮件发送绑定（解析器告警直发邮箱，不污染前台 UI）
        EMAIL: bindings.sendEmail({
          destinationAddress: 'hanzhangzhai@gmail.com',
        }),
        ALERT_FROM_EMAIL: bindings.text('alert@dawnlight-flora.com'),
        ALERT_TO_EMAIL: bindings.text('hanzhangzhai@gmail.com'),
        OPENROUTER_API_KEY: bindings.secret(),
        OPENROUTER_MODEL: bindings.text('deepseek/deepseek-v4.1-flash-1017'),
        APP_ENV: bindings.text(isDev ? 'local' : 'production'),
      },
    },
  };
});
