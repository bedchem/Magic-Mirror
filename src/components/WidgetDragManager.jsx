import { useState, useRef, useEffect, useCallback } from 'react';
import '/src/styles/WidgetDragManager.css';

const WIDGET_MODULES = import.meta.glob('../components/widgets/*.jsx', { eager: true });
const WIDGET_REGISTRY = Object.entries(WIDGET_MODULES).map(([path, mod]) => {
    const name = path.split('/').pop().replace('.jsx', '');
    return { id: name, label: name.replace(/Widget$/, ''), Component: mod.default };
});

const TRASH_HEIGHT        = 110;
const PINCH_GRACE_MS      = 600; // ignore pinch-off shorter than this

function TrashZone({ active, isOver }) {
    if (!active) return <div className="trash-zone" />;
    return (
        <div className={`trash-zone trash-zone--active${isOver ? ' trash-zone--over' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                className={`trash-zone__icon ${isOver ? 'trash-zone__icon--over' : 'trash-zone__icon--normal'}`}>
                <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span className={`trash-zone__label ${isOver ? 'trash-zone__label--over' : 'trash-zone__label--normal'}`}>
                {isOver ? 'Release to remove' : 'Drag here to remove'}
            </span>
        </div>
    );
}

function DraggableWidget({ instance, onMouseDragStart, isBeingDragged, handPositions, isFocused, onFocusWidget }) {
    const entry = WIDGET_REGISTRY.find(w => w.id === instance.widgetId);
    if (!entry) return null;
    const { Component, label } = entry;
    return (
        <div
            data-widget-instance={instance.id}
            className={['draggable-widget', isBeingDragged ? 'draggable-widget--dragging' : ''].filter(Boolean).join(' ')}
            style={{ left: instance.x, top: instance.y }}
        >
            <div
                className={`draggable-widget__header${isBeingDragged ? ' draggable-widget__header--grabbing' : ''}`}
                onMouseDown={e => onMouseDragStart(e, instance.id, instance.x, instance.y)}
            >
                <span className="draggable-widget__title">{label}</span>
                <div className="draggable-widget__dots">
                    {[0,1,2].map(i => <div key={i} className="draggable-widget__dot" />)}
                </div>
            </div>
            <div className="draggable-widget__content">
                <Component
                    handPositions={isFocused ? handPositions : {}}
                    isFocused={isFocused}
                    onFocus={onFocusWidget}
                />
            </div>
        </div>
    );
}

function clampPos(x, y, instanceId) {
    const el      = document.querySelector(`[data-widget-instance="${instanceId}"]`);
    const w       = el?.offsetWidth ?? 300;
    const headerH = el?.querySelector('.draggable-widget__header')?.offsetHeight ?? 40;
    return {
        x: Math.min(Math.max(x, 0), window.innerWidth  - w),
        y: Math.min(Math.max(y, 0), window.innerHeight - headerH),
    };
}

export default function WidgetDragManager({ handPositions = {}, spawnRef, initialWidgets = [], onWidgetsChange, onWidgetRemoved, onDraggingChange }) {
    const [activeWidgets, setActiveWidgets] = useState([]);
    const [focusOrder,    setFocusOrder]    = useState([]);
    const [dragging,      setDragging]      = useState(null);
    const onDraggingChangeRef = useRef(onDraggingChange);
    useEffect(() => { onDraggingChangeRef.current = onDraggingChange; }, [onDraggingChange]);
    const [trashOver,     setTrashOver]     = useState(false);

    const nextId             = useRef(1);
    const mouseDragRef       = useRef(null);
    const handDragRef        = useRef(null);
    const activeWidgetsRef   = useRef([]);
    const onWidgetsChangeRef = useRef(onWidgetsChange);
    const onWidgetRemovedRef = useRef(onWidgetRemoved);
    const initializedRef     = useRef(false);

    // Per-hand state for grace-period logic
    // effectivePinch: true while pinching OR within grace window
    const effectivePinch = useRef({}); // handIndex → bool
    const graceTimers    = useRef({}); // handIndex → timeoutId
    const lastHy         = useRef({}); // handIndex → last known hy (for trash on release)

    useEffect(() => { onWidgetsChangeRef.current = onWidgetsChange; }, [onWidgetsChange]);
    useEffect(() => { onWidgetRemovedRef.current = onWidgetRemoved; }, [onWidgetRemoved]);
    useEffect(() => { activeWidgetsRef.current = activeWidgets; }, [activeWidgets]);

    useEffect(() => {
        if (initializedRef.current || !initialWidgets.length) return;
        initializedRef.current = true;
        const restored = initialWidgets.map(w => {
            const id  = w.id || `w${nextId.current++}`;
            const num = parseInt(id.replace('w', ''));
            if (!isNaN(num) && num >= nextId.current) nextId.current = num + 1;
            return { id, widgetId: w.widgetId, x: w.x, y: w.y };
        });
        setActiveWidgets(restored);
        setFocusOrder(restored.map(w => w.id));
    }, [initialWidgets]);

    const notify = useCallback((widgets) => {
        onWidgetsChangeRef.current?.(widgets);
    }, []);

    useEffect(() => {
        if (activeWidgets.length > 0 || initializedRef.current) notify(activeWidgets);
    }, [activeWidgets, notify]);

    const bringToFront = useCallback((instanceId) => {
        setFocusOrder(prev => {
            if (prev[prev.length - 1] === instanceId) return prev;
            return [...prev.filter(id => id !== instanceId), instanceId];
        });
    }, []);

    const spawnWidget = useCallback((widgetId) => {
        setActiveWidgets(prev => {
            if (prev.some(w => w.widgetId === widgetId)) return prev;
            const id = `w${nextId.current++}`;
            setFocusOrder(order => [...order, id]);
            return [...prev, {
                id, widgetId,
                x: Math.max(0, (window.innerWidth  - 320) / 2),
                y: Math.max(0, (window.innerHeight - 400) / 2),
            }];
        });
    }, []);

    useEffect(() => { if (spawnRef) spawnRef.current = spawnWidget; }, [spawnRef, spawnWidget]);

    const removeWidget = useCallback((id) => {
        setActiveWidgets(prev => prev.filter(w => w.id !== id));
        setFocusOrder(prev => prev.filter(f => f !== id));
        onWidgetRemovedRef.current?.(id);
    }, []);

    // Notify parent whenever dragging starts/stops
    const setDraggingAndNotify = useCallback((val) => {
        setDragging(prev => {
            const next = typeof val === 'function' ? val(prev) : val;
            const wasActive = prev !== null;
            const isActive  = next !== null;
            if (wasActive !== isActive) onDraggingChangeRef.current?.(isActive);
            return next;
        });
    }, []);

    const moveWidget = useCallback((id, x, y) => {
        const { x: cx, y: cy } = clampPos(x, y, id);
        setActiveWidgets(prev => prev.map(w => w.id === id ? { ...w, x: cx, y: cy } : w));
    }, []);

    // ── Mouse drag ─────────────────────────────────────────────────────────────
    const handleMouseDragStart = useCallback((e, instanceId, instanceX, instanceY) => {
        e.preventDefault();
        bringToFront(instanceId);
        mouseDragRef.current = {
            instanceId,
            offsetX: e.clientX - instanceX,
            offsetY: e.clientY - instanceY,
        };
        setDraggingAndNotify({ instanceId, source: 'mouse' });
    }, [bringToFront]);

    useEffect(() => {
        if (!dragging || dragging.source !== 'mouse') return;
        const ref = mouseDragRef.current;
        if (!ref) return;
        const onMove = (e) => {
            moveWidget(ref.instanceId, e.clientX - ref.offsetX, e.clientY - ref.offsetY);
            setTrashOver(e.clientY > window.innerHeight - TRASH_HEIGHT);
        };
        const onUp = (e) => {
            if (e.clientY > window.innerHeight - TRASH_HEIGHT) removeWidget(ref.instanceId);
            mouseDragRef.current = null;
            setDraggingAndNotify(null);
            setTrashOver(false);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
        };
    }, [dragging, moveWidget, removeWidget]);

    // ── Hover highlight ────────────────────────────────────────────────────────
    const prevHoverEls = useRef(new Set());
    const updateHover  = useCallback((hx, hy) => {
        const els  = document.elementsFromPoint(hx, hy);
        const btn  = els.find(el => el.tagName === 'BUTTON' || el.closest?.('button'));
        const hEl  = btn?.closest?.('button') ?? btn ?? null;
        const prev = prevHoverEls.current;
        const next = new Set(hEl ? [hEl] : []);
        for (const el of prev) { if (!next.has(el)) el.classList.remove('hand-hover'); }
        for (const el of next) { el.classList.add('hand-hover'); }
        prevHoverEls.current = next;
    }, []);

    // ── Hand tracking ──────────────────────────────────────────────────────────
    useEffect(() => {
        for (const pos of Object.values(handPositions)) {
            const { handIndex, detected, palmVisible, isPinching, x: hx, y: hy } = pos;

            // Track last known hy for trash detection on delayed release
            if (detected && hy != null) lastHy.current[handIndex] = hy;

            // True release: fires after grace period expires
            const doRelease = (handIndex) => {
                if (handDragRef.current?.handIndex === handIndex) {
                    const { instanceId } = handDragRef.current;
                    const finalHy = lastHy.current[handIndex] ?? 0;
                    if (finalHy > window.innerHeight - TRASH_HEIGHT) removeWidget(instanceId);
                    handDragRef.current = null;
                    setDraggingAndNotify(null);
                    setTrashOver(false);
                }
                effectivePinch.current[handIndex] = false;
            };

            // Start grace timer — real pinch-off or hand lost
            const startGrace = (hi) => {
                if (graceTimers.current[hi]) return; // already running
                graceTimers.current[hi] = setTimeout(() => {
                    delete graceTimers.current[hi];
                    doRelease(hi);
                }, PINCH_GRACE_MS);
            };

            // Cancel grace — pinch came back
            const cancelGrace = (hi) => {
                if (graceTimers.current[hi]) {
                    clearTimeout(graceTimers.current[hi]);
                    delete graceTimers.current[hi];
                }
            };

            // Hand fully gone: start grace if was pinching, otherwise reset immediately
            if (!detected || palmVisible === false) {
                if (effectivePinch.current[handIndex]) {
                    startGrace(handIndex);
                } else {
                    cancelGrace(handIndex);
                }
                continue;
            }

            updateHover(hx, hy);

            if (isPinching) {
                // Pinch is back → cancel grace, stay/become effective
                cancelGrace(handIndex);
                const wasEffective = effectivePinch.current[handIndex];
                effectivePinch.current[handIndex] = true;

                // ── Continue active drag ──────────────────────────────────────
                if (handDragRef.current?.handIndex === handIndex) {
                    const { instanceId, offsetX, offsetY } = handDragRef.current;
                    moveWidget(instanceId, hx - offsetX, hy - offsetY);
                    setTrashOver(hy > window.innerHeight - TRASH_HEIGHT);
                    setDraggingAndNotify(prev =>
                        prev?.instanceId === instanceId ? prev : { instanceId, source: 'hand' }
                    );
                    continue;
                }

                // ── Leading edge (first frame of this pinch gesture) ──────────
                if (!wasEffective) {
                    const els = document.elementsFromPoint(hx, hy);

                    // Focus widget under hand
                    const widgetEl = els.find(el => el.closest?.('[data-widget-instance]'));
                    const focusId  = widgetEl?.closest('[data-widget-instance]')?.dataset?.widgetInstance;
                    if (focusId) bringToFront(focusId);

                    // Drum / kalender — let widget handle
                    const isDrum = els.some(el =>
                        el.hasAttribute?.('data-drum-index') ||
                        el.closest?.('[data-drum-index]') ||
                        el.classList?.contains('t-drum-col') ||
                        el.closest?.('.t-drum-col') ||
                        el.classList?.contains('kal-vp') ||
                        el.closest?.('.kal-vp')
                    );
                    if (isDrum) continue;

                    // Button click
                    const btn       = els.find(el => el.tagName === 'BUTTON' || el.closest?.('button'));
                    const btnTarget = btn?.closest?.('button') ?? btn;
                    if (btnTarget) { btnTarget.click(); continue; }

                    // Header → start drag
                    const headerEl = els.find(el =>
                        el.classList?.contains('draggable-widget__header') ||
                        el.closest?.('.draggable-widget__header')
                    );
                    if (headerEl) {
                        const instEl = headerEl.closest('[data-widget-instance]');
                        const iid    = instEl?.dataset?.widgetInstance;
                        if (iid) {
                            const w = activeWidgetsRef.current.find(w => w.id === iid);
                            if (w) {
                                handDragRef.current = { instanceId: iid, offsetX: hx - w.x, offsetY: hy - w.y, handIndex };
                                setDraggingAndNotify({ instanceId: iid, source: 'hand' });
                            }
                        }
                    }
                }

            } else {
                // Pinch off — start grace period
                if (effectivePinch.current[handIndex]) {
                    startGrace(handIndex);
                }
            }
        }
    }, [handPositions, moveWidget, removeWidget, updateHover, bringToFront]);

    useEffect(() => () => {
        Object.values(graceTimers.current).forEach(clearTimeout);
    }, []);

    const sortedWidgets = [...activeWidgets].sort((a, b) => {
        const ai = focusOrder.indexOf(a.id);
        const bi = focusOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return -1;
        if (bi === -1) return 1;
        return ai - bi;
    });

    return (
        <>
            {sortedWidgets.map(instance => (
                <DraggableWidget
                    key={instance.id}
                    instance={instance}
                    onMouseDragStart={handleMouseDragStart}
                    isBeingDragged={dragging?.instanceId === instance.id}
                    handPositions={handPositions}
                    isFocused={focusOrder[focusOrder.length - 1] === instance.id}
                    onFocusWidget={() => bringToFront(instance.id)}
                />
            ))}
            <TrashZone active={dragging !== null} isOver={trashOver} />
        </>
    );
}