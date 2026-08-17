import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';
interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    children?: Snippet;
    page?: number;
}
declare const TurnPage: import("svelte").Component<Props, {}, "">;
type TurnPage = ReturnType<typeof TurnPage>;
export default TurnPage;
