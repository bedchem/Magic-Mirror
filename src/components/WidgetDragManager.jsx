import { useState, useRef, useEffect, useCallback } from 'react';
import '/src/styles/WidgetDragManager.css';

const WIDGET_MODULES = import.meta.glob('../components/widgets/*.jsx', { eager: true });

const WIDGET_REGISTRY = Object.entries(WIDGET_MODULES).map(([path, mod]) => {
    const name = path.split('/').pop().replace('.jsx', '');
    const label = name.replace(/Widget$/, '');
    return { id: name, label, Component: mod.default };
});

const TRASH_HEIGHT = 110;

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

function DraggableWidget({ instance, onMouseDragStart, isBeingDragged }) {
    const entry = WIDGET_REGISTRY.find(w => w.id === instance.widgetId);
    if (!entry) return null;
    const { Component, label } = entry;

    return (
        <div
            data-widget-instance={instance.id}
            className={`draggable-widget${isBeingDragged ? ' draggable-widget--dragging' : ''}`}
            style={{ left: instance.x, top: instance.y }}
        >
            <div
                onMouseDown={e => onMouseDragStart(e, instance.id)}
                className={`draggable-widget__header${isBeingDragged ? ' draggable-widget__header--grabbing' : ''}`}
            >
                <span className="draggable-widget__title">{label}</span>
                <div className="draggable-widget__dots">
                    {[0, 1, 2].map(i => <div key={i} className="draggable-widget__dot" />)}
                </div>
            </div>
            <div className="draggable-widget__content">
                <Component />
            </div>
        </div>
    );
}

export default function WidgetDragManager({ handPositions = {}, spawnRef }) {
    const [activeWidgets, setActiveWidgets] = useState([]);
    const [dragging, setDragging] = useState(null);
    const [trashOver, setTrashOver] = useState(false);

    const nextId = useRef(1);
    const mouseDragRef = useRef(null);
    const handDragRef = useRef(null);
    const wasPinching = useRef({});

    const isDragging = dragging !== null;

    const spawnWidget = useCallback((widgetId) => {
        setActiveWidgets(prev => {
            if (prev.some(w => w.widgetId === widgetId)) return prev;
            const id = `w${nextId.current++}`;
            return [...prev, {
                id, widgetId,
                x: 120 + Math.random() * Math.max(100, window.innerWidth - 400),
                y: 100 + Math.random() * Math.max(100, window.innerHeight - 350),
            }];
        });
    }, []);

    useEffect(() => { if (spawnRef) spawnRef.current = spawnWidget; }, [spawnRef, spawnWidget]);

    const removeWidget = useCallback((id) =>
        setActiveWidgets(prev => prev.filter(w => w.id !== id)), []);

    const moveWidget = useCallback((id, x, y) =>
        setActiveWidgets(prev => prev.map(w => w.id === id ? { ...w, x, y } : w)), []);

    const handleMouseDragStart = useCallback((e, instanceId) => {
        e.preventDefault();
        const el = document.querySelector(`[data-widget-instance="${instanceId}"]`);
        const rect = el?.getBoundingClientRect();
        mouseDragRef.current = {
            instanceId,
            offsetX: e.clientX - (rect?.left ?? 0),
            offsetY: e.clientY - (rect?.top ?? 0),
        };
        setDragging({ instanceId, source: 'mouse' });
    }, []);

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
            setDragging(null);
            setTrashOver(false);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
    }, [dragging, moveWidget, removeWidget]);

    const prevHoverEls = useRef(new Set());
    const updateHover = useCallback((hx, hy) => {
        const els = document.elementsFromPoint(hx, hy);
        const btn = els.find(el => el.tagName === 'BUTTON' || el.closest?.('button'));
        const hEl = btn?.closest?.('button') ?? btn ?? null;
        const prev = prevHoverEls.current;
        const next = new Set(hEl ? [hEl] : []);
        for (const el of prev) { if (!next.has(el)) el.classList.remove('hand-hover'); }
        for (const el of next) { el.classList.add('hand-hover'); }
        prevHoverEls.current = next;
    }, []);

    useEffect(() => {
        for (const pos of Object.values(handPositions)) {
            const {
                handIndex, detected, palmVisible,
                isPinching,
                x: hx, y: hy,
            } = pos;

            const releaseHand = () => {
                if (handDragRef.current?.handIndex === handIndex) {
                    const { instanceId } = handDragRef.current;
                    if (hy > window.innerHeight - TRASH_HEIGHT) removeWidget(instanceId);
                    handDragRef.current = null;
                    setDragging(null);
                    setTrashOver(false);
                }
            };

            if (!detected || palmVisible === false) {
                releaseHand();
                wasPinching.current[handIndex] = false;
                continue;
            }

            updateHover(hx, hy);

            if (isPinching) {
                if (handDragRef.current?.handIndex === handIndex) {
                    const { instanceId, offsetX, offsetY } = handDragRef.current;
                    moveWidget(instanceId, hx - offsetX, hy - offsetY);
                    setTrashOver(hy > window.innerHeight - TRASH_HEIGHT);
                    setDragging(prev =>
                        prev?.instanceId === instanceId ? prev : { instanceId, source: 'hand' }
                    );
                } else if (!wasPinching.current[handIndex]) {
                    const els = document.elementsFromPoint(hx, hy);

                    const btn = els.find(el => el.tagName === 'BUTTON' || el.closest?.('button'));
                    const btnTarget = btn?.closest?.('button') ?? btn;
                    if (btnTarget) {
                        btnTarget.click();
                    } else {
                        const headerEl = els.find(el =>
                            el.classList.contains('draggable-widget__header') ||
                            el.closest?.('.draggable-widget__header')
                        );
                        if (headerEl) {
                            const instanceEl = headerEl.closest('[data-widget-instance]');
                            const instanceId = instanceEl?.dataset?.widgetInstance;
                            if (instanceId) {
                                const w = activeWidgets.find(w => w.id === instanceId);
                                if (w) {
                                    handDragRef.current = {
                                        instanceId,
                                        offsetX: hx - w.x,
                                        offsetY: hy - w.y,
                                        handIndex,
                                    };
                                    setDragging({ instanceId, source: 'hand' });
                                }
                            }
                        }
                    }
                }
            } else {
                releaseHand();
            }

            wasPinching.current[handIndex] = isPinching;
        }
    }, [handPositions, activeWidgets, moveWidget, removeWidget, updateHover]);

    return (
        <>
            {activeWidgets.map(instance => (
                <DraggableWidget
                    key={instance.id}
                    instance={instance}
                    onMouseDragStart={handleMouseDragStart}
                    isBeingDragged={dragging?.instanceId === instance.id}
                />
            ))}
            <TrashZone active={isDragging} isOver={trashOver} />
        </>
    );
}