import axios from 'axios';

/**
 * Discord/Telegram 알림 서비스
 */
export class Notifier {
  private static webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  /**
   * Discord Webhook으로 알림 전송
   */
  static async sendDiscord(message: string, isError: boolean = false) {
    if (!this.webhookUrl) {
      console.warn('⚠️ DISCORD_WEBHOOK_URL이 설정되지 않았습니다.');
      return;
    }

    const payload = {
      content: `${isError ? '🚨 **[FAIL]**' : '✅ **[SUCCESS]**'} ${message}`,
      username: 'Blogger RPA Bot',
      avatar_url: 'https://cdn-icons-png.flaticon.com/512/3669/3669967.png'
    };

    try {
      await axios.post(this.webhookUrl, payload);
    } catch (error) {
      console.error('❌ Discord 알림 전송 실패:', error);
    }
  }

  /**
   * 작업 단계별 로그 전송
   */
  static async logStep(jobId: string, step: string, message: string) {
    console.log(`[Job ${jobId}] [${step}] ${message}`);
    
    try {
      // 대시보드 API로 로그 전송 (워커가 별도 프로세스일 때 필요)
      await fetch('http://localhost:3002/api/logs/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, step, message }),
      }).catch(() => {
        // 대시보드가 꺼져있을 경우 무시
      });
    } catch (e) {
      // fetch 실패 시 콘솔에만 남김
    }
  }

  static async logError(jobId: string, step: string, message: string, error?: any) {
    const errorMessage = error ? `${message}: ${error.message || error}` : message;
    console.error(`[Job ${jobId}] [${step}] ERROR: ${errorMessage}`);
    
    try {
      await fetch('http://localhost:3002/api/logs/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, step, message: errorMessage, type: 'error' }),
      }).catch(() => {});
    } catch (e) {}
  }
}
