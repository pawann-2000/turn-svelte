import type { TurnBookApi, TurnBookCallbacks, TurnBookOptions } from './types.js';
export declare function createTurnBook(element: HTMLElement, options: TurnBookOptions, callbacks?: TurnBookCallbacks): Promise<TurnBookApi>;
