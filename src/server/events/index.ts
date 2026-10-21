import { EventEmitter } from 'node:events';

export interface CrewEvent {
  type: string;
  data: unknown;
  timestamp: string;
}

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publishBoardEvent(boardId: string, event: Omit<CrewEvent, 'timestamp'>): void {
    const fullEvent: CrewEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    this.emitter.emit(`board:${boardId}`, fullEvent);
    if (boardId !== '*') this.emitter.emit('board:*', { boardId, ...fullEvent });
  }

  subscribeBoardEvents(boardId: string, listener: (event: CrewEvent) => void): () => void {
    const channel = `board:${boardId}`;
    this.emitter.on(channel, listener);
    // Global events go to each board, while aggregate '*' subscribers get each event once.
    const global = (event: CrewEvent & { boardId?: string }) => {
      if (event.boardId === undefined) listener(event);
    };
    if (boardId !== '*') this.emitter.on('board:*', global);
    return () => {
      this.emitter.off(channel, listener);
      if (boardId !== '*') this.emitter.off('board:*', global);
    };
  }

  publishRunEvent(runId: string, event: Omit<CrewEvent, 'timestamp'>): void {
    const fullEvent: CrewEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    this.emitter.emit(`run:${runId}`, fullEvent);
    this.emitter.emit('run:*', { runId, ...fullEvent });
  }

  subscribeRunEvents(runId: string, listener: (event: CrewEvent) => void): () => void {
    const channel = runId === '*' ? 'run:*' : `run:${runId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  clear(): void {
    this.emitter.removeAllListeners();
  }
}

let defaultEventBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!defaultEventBus) {
    defaultEventBus = new EventBus();
  }
  return defaultEventBus;
}
