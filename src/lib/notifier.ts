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
    const formatted = `[Job #${jobId}] **${step}** - ${message}`;
    console.log(formatted);
    // 선택적으로 모든 스텝을 디코에 보낼 수도 있음 (현재는 로그만)
  }
}
