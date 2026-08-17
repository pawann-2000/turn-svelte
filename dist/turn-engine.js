const pageClasses = [
    'turn-page',
    'turn-page--visible',
    'turn-page--active',
    'turn-page--left',
    'turn-page--right',
    'turn-page--single',
    'turn-page--entering-forward',
    'turn-page--entering-backward',
    'turn-page--leaving-forward',
    'turn-page--leaving-backward'
];
const managedPageStyles = [
    'animation-duration',
    'display',
    'height',
    'inset',
    'left',
    'opacity',
    'pointer-events',
    'position',
    'top',
    'transform',
    'transform-origin',
    'visibility',
    'width',
    'will-change',
    'z-index'
];
const managedBookStyles = [
    '--turn-book-width',
    '--turn-book-height',
    '--turn-page-width',
    '--turn-duration'
];
const allCorners = ['tl', 'tr', 'bl', 'br'];
function toNumber(value, fallback, minimum = 0) {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.max(minimum, Math.round(numeric));
}
function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}
function normalizeDisplay(display) {
    return display === 'single' ? 'single' : 'double';
}
function normalizeCorners(corners) {
    if (!corners || corners === 'all')
        return new Set(allCorners);
    if (corners === 'forward')
        return new Set(['tr', 'br']);
    if (corners === 'backward')
        return new Set(['tl', 'bl']);
    return new Set(corners);
}
function visibleView(page, display, totalPages) {
    const currentPage = clamp(page, 1, totalPages);
    if (display === 'single')
        return [currentPage];
    if (currentPage <= 1)
        return [0, 1];
    const left = currentPage % 2 === 0 ? currentPage : currentPage - 1;
    const right = left + 1;
    return [left <= totalPages ? left : 0, right <= totalPages ? right : 0];
}
function nextPage(page, display, totalPages) {
    if (display === 'single')
        return clamp(page + 1, 1, totalPages);
    const candidate = page <= 1 ? 2 : page + 2;
    return clamp(candidate, 1, totalPages);
}
function previousPage(page, display, totalPages) {
    if (display === 'single')
        return clamp(page - 1, 1, totalPages);
    const candidate = page <= 2 ? 1 : page - 2;
    return clamp(candidate, 1, totalPages);
}
function pageSide(page, view, display) {
    if (display === 'single')
        return 'single';
    return view[0] === page ? 'left' : 'right';
}
function isHTMLElement(value) {
    return value instanceof HTMLElement;
}
function createEvent(type, api, originalEvent, page = api.page(), view = api.view(), corner) {
    return {
        type,
        api,
        page,
        view,
        originalEvent,
        corner
    };
}
function isInteractiveTarget(target) {
    if (!(target instanceof Element))
        return false;
    return Boolean(target.closest('a, button, input, label, select, textarea, summary, [contenteditable=""], [contenteditable="true"], [role="button"]'));
}
function snapshotStyles(element, properties) {
    const snapshot = new Map();
    for (const property of properties) {
        snapshot.set(property, element.style.getPropertyValue(property));
    }
    return snapshot;
}
function restoreStyles(element, snapshot) {
    for (const [property, value] of snapshot) {
        if (value) {
            element.style.setProperty(property, value);
        }
        else {
            element.style.removeProperty(property);
        }
    }
}
export async function createTurnBook(element, options, callbacks) {
    var _a, _b;
    let width = toNumber(options.width, element.clientWidth || 800, 1);
    let height = toNumber(options.height, element.clientHeight || 500, 1);
    let duration = toNumber(options.duration, 600, 0);
    let display = normalizeDisplay(options.display);
    let gradients = (_a = options.gradients) !== null && _a !== void 0 ? _a : true;
    let totalPages = Math.max(1, toNumber(options.pages, element.children.length || 1, 1));
    let explicitPageCount = typeof options.pages === 'number';
    let page = clamp(toNumber(options.page, 1, 1), 1, totalPages);
    let disabled = false;
    let destroyed = false;
    let animating = false;
    let pages = [];
    let turnTimer;
    const bookStyleSnapshot = snapshotStyles(element, managedBookStyles);
    const pageStyleSnapshots = new WeakMap();
    const originalRole = element.getAttribute('role');
    const originalTabIndex = element.getAttribute('tabindex');
    const allowedCorners = normalizeCorners(options.corners);
    const cornerSize = options.cornerSize;
    const api = {
        get element() {
            return element;
        },
        next() {
            return setPage(nextPage(page, display, totalPages));
        },
        previous() {
            return setPage(previousPage(page, display, totalPages));
        },
        page(next) {
            if (typeof next === 'number') {
                return setPage(next);
            }
            return page;
        },
        pages(nextTotal) {
            if (typeof nextTotal === 'number') {
                explicitPageCount = true;
                totalPages = Math.max(1, toNumber(nextTotal, totalPages, 1));
                page = clamp(page, 1, totalPages);
                render();
            }
            return totalPages;
        },
        view(next) {
            return visibleView(typeof next === 'number' ? next : page, display, totalPages);
        },
        range() {
            return [1, totalPages];
        },
        size(nextWidth, nextHeight) {
            if (typeof nextWidth === 'number' && typeof nextHeight === 'number') {
                width = toNumber(nextWidth, width, 1);
                height = toNumber(nextHeight, height, 1);
                render();
            }
            return { width, height };
        },
        display(nextDisplay) {
            if (nextDisplay) {
                display = normalizeDisplay(nextDisplay);
                render();
            }
            return display;
        },
        disable(nextDisabled = true) {
            disabled = nextDisabled;
            render();
        },
        stop() {
            stopAnimation();
        },
        animating() {
            return animating;
        },
        hasPage(targetPage) {
            return pages.some((record) => record.number === targetPage);
        },
        addPage(pageElement, targetPage) {
            const pageIndex = clamp(toNumber(targetPage, pages.length + 1, 1), 1, Math.max(1, pages.length + 1));
            const before = element.children.item(pageIndex - 1);
            element.insertBefore(pageElement, before);
            refreshPages();
            render();
        },
        removePage(targetPage) {
            const record = pages.find((item) => item.number === targetPage);
            if (!record)
                return;
            record.element.remove();
            refreshPages();
            render();
        },
        destroy() {
            if (destroyed)
                return;
            destroyed = true;
            stopAnimation();
            observer === null || observer === void 0 ? void 0 : observer.disconnect();
            element.removeEventListener('pointerup', handlePointerUp);
            element.removeEventListener('keydown', handleKeydown);
            element.classList.remove('turn-book--native');
            delete element.dataset.display;
            delete element.dataset.disabled;
            delete element.dataset.gradients;
            if (originalRole === null) {
                element.removeAttribute('role');
            }
            else {
                element.setAttribute('role', originalRole);
            }
            if (originalTabIndex === null) {
                element.removeAttribute('tabindex');
            }
            else {
                element.setAttribute('tabindex', originalTabIndex);
            }
            restoreStyles(element, bookStyleSnapshot);
            for (const record of pages) {
                restorePage(record.element);
            }
        }
    };
    const observer = typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver(() => {
            refreshPages();
            render();
        });
    function refreshPages() {
        pages = Array.from(element.children)
            .filter(isHTMLElement)
            .map((pageElement, index) => {
            if (!pageStyleSnapshots.has(pageElement)) {
                pageStyleSnapshots.set(pageElement, snapshotStyles(pageElement, managedPageStyles));
            }
            pageElement.dataset.pageNumber = String(index + 1);
            return {
                element: pageElement,
                number: index + 1
            };
        });
        if (!explicitPageCount) {
            totalPages = Math.max(1, pages.length);
        }
        else {
            totalPages = Math.max(totalPages, pages.length, 1);
        }
        page = clamp(page, 1, totalPages);
    }
    function prepareBook() {
        element.classList.add('turn-book--native');
        if (!element.hasAttribute('role'))
            element.setAttribute('role', 'group');
        if (!element.hasAttribute('tabindex'))
            element.setAttribute('tabindex', '0');
        element.addEventListener('pointerup', handlePointerUp);
        element.addEventListener('keydown', handleKeydown);
        observer === null || observer === void 0 ? void 0 : observer.observe(element, { childList: true });
    }
    function render(transition) {
        var _a, _b, _c;
        if (destroyed)
            return;
        const currentView = visibleView(page, display, totalPages);
        const currentPages = new Set(currentView.filter(Boolean));
        const fromPages = new Set((_a = transition === null || transition === void 0 ? void 0 : transition.from.filter(Boolean)) !== null && _a !== void 0 ? _a : []);
        const toPages = new Set((_b = transition === null || transition === void 0 ? void 0 : transition.to.filter(Boolean)) !== null && _b !== void 0 ? _b : []);
        const transientPages = new Set([...fromPages, ...toPages]);
        const visiblePages = transition ? transientPages : currentPages;
        const pageWidth = display === 'double' ? width / 2 : width;
        element.style.setProperty('--turn-book-width', `${width}px`);
        element.style.setProperty('--turn-book-height', `${height}px`);
        element.style.setProperty('--turn-page-width', `${pageWidth}px`);
        element.style.setProperty('--turn-duration', `${duration}ms`);
        element.dataset.display = display;
        element.dataset.disabled = String(disabled);
        element.dataset.gradients = String(gradients);
        for (const record of pages) {
            const isVisible = visiblePages.has(record.number);
            const isActive = currentPages.has(record.number);
            const entering = transition ? toPages.has(record.number) && !fromPages.has(record.number) : false;
            const leaving = transition ? fromPages.has(record.number) && !toPages.has(record.number) : false;
            const side = pageSide(record.number, isActive ? currentView : ((_c = transition === null || transition === void 0 ? void 0 : transition.from) !== null && _c !== void 0 ? _c : currentView), display);
            applyPageStyles(record, side, isVisible, isActive, entering, leaving, transition === null || transition === void 0 ? void 0 : transition.direction);
        }
    }
    function applyPageStyles(record, side, isVisible, isActive, entering, leaving, direction) {
        const pageElement = record.element;
        const isRight = side === 'right';
        const transformOrigin = side === 'single' ? '50% 50%' : isRight ? '0 50%' : '100% 50%';
        pageElement.classList.add('turn-page');
        pageElement.classList.toggle('turn-page--visible', isVisible);
        pageElement.classList.toggle('turn-page--active', isActive);
        pageElement.classList.toggle('turn-page--left', side === 'left');
        pageElement.classList.toggle('turn-page--right', side === 'right');
        pageElement.classList.toggle('turn-page--single', side === 'single');
        pageElement.classList.toggle('turn-page--entering-forward', entering && direction === 'forward');
        pageElement.classList.toggle('turn-page--entering-backward', entering && direction === 'backward');
        pageElement.classList.toggle('turn-page--leaving-forward', leaving && direction === 'forward');
        pageElement.classList.toggle('turn-page--leaving-backward', leaving && direction === 'backward');
        pageElement.style.position = 'absolute';
        pageElement.style.top = '0';
        pageElement.style.left = display === 'double' && isRight ? '50%' : '0';
        pageElement.style.width = display === 'double' ? '50%' : '100%';
        pageElement.style.height = '100%';
        pageElement.style.display = isVisible ? 'block' : 'none';
        pageElement.style.visibility = isVisible ? 'visible' : 'hidden';
        pageElement.style.opacity = isVisible ? '1' : '0';
        pageElement.style.pointerEvents = isActive && !disabled ? 'auto' : 'none';
        pageElement.style.transformOrigin = transformOrigin;
        pageElement.style.transform = 'translateZ(0)';
        pageElement.style.animationDuration = `${duration}ms`;
        pageElement.style.willChange = entering || leaving ? 'transform, opacity' : 'auto';
        pageElement.style.zIndex = String(leaving ? 40 : entering ? 30 : isActive ? 20 + record.number : 0);
        pageElement.setAttribute('aria-hidden', String(!isActive));
        pageElement.dataset.turnSide = side;
    }
    function setPage(next, originalEvent, corner) {
        var _a, _b;
        const requestedPage = clamp(toNumber(next, page, 1), 1, totalPages);
        if (destroyed || requestedPage === page)
            return page;
        const fromPage = page;
        const fromView = visibleView(fromPage, display, totalPages);
        const toView = visibleView(requestedPage, display, totalPages);
        const direction = requestedPage > fromPage ? 'forward' : 'backward';
        (_a = callbacks === null || callbacks === void 0 ? void 0 : callbacks.turning) === null || _a === void 0 ? void 0 : _a.call(callbacks, createEvent('turning', api, originalEvent, requestedPage, toView, corner));
        (_b = callbacks === null || callbacks === void 0 ? void 0 : callbacks.turn) === null || _b === void 0 ? void 0 : _b.call(callbacks, createEvent('turn', api, originalEvent, requestedPage, toView, corner));
        page = requestedPage;
        animating = duration > 0;
        render({ from: fromView, to: toView, direction });
        if (turnTimer)
            clearTimeout(turnTimer);
        if (animating) {
            turnTimer = setTimeout(() => {
                finishTurn(originalEvent, corner);
            }, duration);
        }
        else {
            finishTurn(originalEvent, corner);
        }
        return page;
    }
    function finishTurn(originalEvent, corner) {
        var _a, _b, _c;
        if (destroyed)
            return;
        animating = false;
        turnTimer = undefined;
        render();
        const event = createEvent('turned', api, originalEvent, page, visibleView(page, display, totalPages), corner);
        (_a = callbacks === null || callbacks === void 0 ? void 0 : callbacks.turned) === null || _a === void 0 ? void 0 : _a.call(callbacks, event);
        if (page === 1)
            (_b = callbacks === null || callbacks === void 0 ? void 0 : callbacks.first) === null || _b === void 0 ? void 0 : _b.call(callbacks, createEvent('first', api, originalEvent));
        if (page === totalPages)
            (_c = callbacks === null || callbacks === void 0 ? void 0 : callbacks.last) === null || _c === void 0 ? void 0 : _c.call(callbacks, createEvent('last', api, originalEvent));
    }
    function stopAnimation() {
        if (turnTimer)
            clearTimeout(turnTimer);
        turnTimer = undefined;
        animating = false;
        render();
    }
    function handlePointerUp(event) {
        var _a;
        if (destroyed || disabled || animating || isInteractiveTarget(event.target))
            return;
        const rect = element.getBoundingClientRect();
        const direction = event.clientX - rect.left >= rect.width / 2 ? 'forward' : 'backward';
        const corner = resolveCorner(event, rect, direction);
        if (!corner || !allowedCorners.has(corner))
            return;
        (_a = callbacks === null || callbacks === void 0 ? void 0 : callbacks.start) === null || _a === void 0 ? void 0 : _a.call(callbacks, createEvent('start', api, event, page, visibleView(page, display, totalPages), corner));
        if (direction === 'forward') {
            setPage(nextPage(page, display, totalPages), event, corner);
        }
        else {
            setPage(previousPage(page, display, totalPages), event, corner);
        }
    }
    function handleKeydown(event) {
        if (destroyed || disabled || animating)
            return;
        if (event.key === 'ArrowRight' || event.key === 'PageDown') {
            event.preventDefault();
            setPage(nextPage(page, display, totalPages), event, 'br');
        }
        if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            event.preventDefault();
            setPage(previousPage(page, display, totalPages), event, 'bl');
        }
        if (event.key === 'Home') {
            event.preventDefault();
            setPage(1, event);
        }
        if (event.key === 'End') {
            event.preventDefault();
            setPage(totalPages, event);
        }
    }
    function resolveCorner(event, rect, direction) {
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const top = y < rect.height / 2;
        const corner = direction === 'forward' ? (top ? 'tr' : 'br') : top ? 'tl' : 'bl';
        if (typeof cornerSize !== 'number')
            return corner;
        const size = clamp(cornerSize, 1, Math.max(rect.width, rect.height));
        const inHorizontalHotspot = direction === 'forward' ? x >= rect.width - size : x <= size;
        const inVerticalHotspot = top ? y <= size : y >= rect.height - size;
        return inHorizontalHotspot && inVerticalHotspot ? corner : undefined;
    }
    function restorePage(pageElement) {
        for (const className of pageClasses) {
            pageElement.classList.remove(className);
        }
        pageElement.removeAttribute('aria-hidden');
        delete pageElement.dataset.pageNumber;
        delete pageElement.dataset.turnSide;
        const snapshot = pageStyleSnapshots.get(pageElement);
        if (snapshot)
            restoreStyles(pageElement, snapshot);
    }
    prepareBook();
    refreshPages();
    render();
    (_b = callbacks === null || callbacks === void 0 ? void 0 : callbacks.ready) === null || _b === void 0 ? void 0 : _b.call(callbacks, createEvent('ready', api));
    return api;
}
