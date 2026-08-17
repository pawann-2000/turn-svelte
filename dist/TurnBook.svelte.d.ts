import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';
import type { TurnBookApi, TurnBookEvent, TurnBookOptions, TurnCorners, TurnDisplay } from './types.js';
interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    children?: Snippet;
    width?: number;
    height?: number;
    page?: number;
    pages?: number;
    display?: TurnDisplay;
    gradients?: boolean;
    duration?: number;
    cornerSize?: number;
    corners?: TurnCorners;
    disabled?: boolean;
    options?: TurnBookOptions;
    api?: TurnBookApi;
    onready?: (event: TurnBookEvent) => void;
    onturn?: (event: TurnBookEvent) => void;
    onturning?: (event: TurnBookEvent) => void;
    onturned?: (event: TurnBookEvent) => void;
    onfirst?: (event: TurnBookEvent) => void;
    onlast?: (event: TurnBookEvent) => void;
    onstart?: (event: TurnBookEvent) => void;
    oniniterror?: (error: unknown) => void;
}
declare const TurnBook: import("svelte").Component<Props, {
    next: () => number | undefined;
    previous: () => number | undefined;
    goTo: (nextPage: number) => number | undefined;
    getApi: () => TurnBookApi | undefined;
}, "page" | "api">;
type TurnBook = ReturnType<typeof TurnBook>;
export default TurnBook;
