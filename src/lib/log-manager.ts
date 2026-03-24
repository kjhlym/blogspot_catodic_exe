type LogType = 'log' | 'error' | 'status' | 'done' | 'connected' | 'history';

interface LogPayload {
  type: LogType;
  message?: string;
  time: string;
  [key: string]: any;
}

class LogManager {
  private static instance: LogManager;
  private clients: Set<ReadableStreamDefaultController> = new Set();
  private logBuffer: LogPayload[] = [];
  private readonly MAX_BUFFER = 200;
  private aborted = false;

  private constructor() {}

  public static getInstance(): LogManager {
    if (!LogManager.instance) {
      LogManager.instance = new LogManager();
    }
    return LogManager.instance;
  }

  public registerClient(controller: ReadableStreamDefaultController) {
    this.clients.add(controller);
    
    // 연결 시 현재 상태 및 히스토리 전송
    const connectedPayload: LogPayload = {
      type: 'connected',
      message: 'Connected to Next.js Log Stream',
      time: new Date().toISOString()
    };
    this.sendToController(controller, connectedPayload);

    if (this.logBuffer.length > 0) {
      const historyPayload: LogPayload = {
        type: 'history',
        logs: this.logBuffer,
        time: new Date().toISOString()
      };
      this.sendToController(controller, historyPayload);
    }
  }

  public unregisterClient(controller: ReadableStreamDefaultController) {
    this.clients.delete(controller);
  }

  public broadcast(type: LogType, message: string, extra: Record<string, any> = {}) {
    const payload: LogPayload = {
      type,
      message,
      time: new Date().toISOString(),
      ...extra
    };

    if (['log', 'error', 'status', 'done'].includes(type)) {
      this.logBuffer.push(payload);
      if (this.logBuffer.length > this.MAX_BUFFER) {
        this.logBuffer.shift();
      }
    }

    const encoder = new TextEncoder();
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    
    for (const client of this.clients) {
      try {
        client.enqueue(encoder.encode(data));
      } catch (e) {
        this.clients.delete(client);
      }
    }

    if (type === 'error') console.error(`[SSE][${type}] ${message}`);
    else console.log(`[SSE][${type}] ${message}`);
  }

  private sendToController(controller: ReadableStreamDefaultController, payload: LogPayload) {
    const encoder = new TextEncoder();
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    try {
      controller.enqueue(encoder.encode(data));
    } catch (e) {
      this.clients.delete(controller);
    }
  }

  public clearLogs() {
    this.logBuffer = [];
    this.broadcast('log', 'Log buffer cleared');
  }

  // Abort (중지) 제어
  public setAborted(val: boolean) {
    this.aborted = val;
    if (val) {
      this.broadcast('status', 'aborted', { message: '실행 중지 신호가 입력되었습니다.' });
    }
  }

  public isAborted(): boolean {
    return this.aborted;
  }
}

// HMR(Hot Module Replacement) 환경에서도 싱글톤을 유지하기 위한 처리
const globalForLogManager = global as unknown as { logManager: LogManager };
export const logManager = globalForLogManager.logManager || LogManager.getInstance();

if (process.env.NODE_ENV !== 'production') {
  globalForLogManager.logManager = logManager;
}

