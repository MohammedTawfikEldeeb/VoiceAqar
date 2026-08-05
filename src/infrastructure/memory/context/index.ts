import { ContextWindowService } from './context_window.js';
import { IContextWindowService } from './interface.js';

export class ContextWindowFactory {
  static create(): IContextWindowService {
    return new ContextWindowService();
  }
}

export const contextWindow = ContextWindowFactory.create();
export default contextWindow;
export * from './interface.js';
