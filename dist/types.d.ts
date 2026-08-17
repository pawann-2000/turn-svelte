export type TurnDisplay = 'single' | 'double';
export type TurnCorner = 'tl' | 'tr' | 'bl' | 'br';
export type TurnCornerPreset = 'backward' | 'forward' | 'all';
export type TurnCorners = TurnCornerPreset | TurnCorner[];
export interface TurnSize {
    width: number;
    height: number;
}
export interface TurnBookOptions {
    page?: number;
    pages?: number;
    width?: number;
    height?: number;
    gradients?: boolean;
    duration?: number;
    display?: TurnDisplay;
    cornerSize?: number;
    corners?: TurnCorners;
}
export type TurnBookEventType = 'ready' | 'turn' | 'turning' | 'turned' | 'first' | 'last' | 'start';
export interface TurnBookEvent {
    type: TurnBookEventType;
    api: TurnBookApi;
    page: number;
    view: number[];
    originalEvent?: unknown;
    corner?: string;
}
export interface TurnBookCallbacks {
    ready?: (event: TurnBookEvent) => void;
    turn?: (event: TurnBookEvent) => void;
    turning?: (event: TurnBookEvent) => void;
    turned?: (event: TurnBookEvent) => void;
    first?: (event: TurnBookEvent) => void;
    last?: (event: TurnBookEvent) => void;
    start?: (event: TurnBookEvent) => void;
}
export interface TurnBookApi {
    readonly element: HTMLElement;
    next: () => number;
    previous: () => number;
    page: (page?: number) => number;
    pages: (pages?: number) => number;
    view: (page?: number) => number[];
    range: (page?: number) => [number, number];
    size: (width?: number, height?: number) => TurnSize;
    display: (display?: TurnDisplay) => TurnDisplay;
    disable: (disabled?: boolean) => void;
    stop: () => void;
    animating: () => boolean;
    hasPage: (page: number) => boolean;
    addPage: (element: HTMLElement, page?: number) => void;
    removePage: (page: number) => void;
    destroy: () => void;
}
