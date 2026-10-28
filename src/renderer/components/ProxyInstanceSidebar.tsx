import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from "react";
import type { ProxyInstanceSummary } from "../../shared/contracts";

interface ProxyInstanceSidebarProps {
  instances: ProxyInstanceSummary[];
  onSelect: (id: string) => Promise<void>;
  onCreate: () => Promise<void>;
  onDelete: (id: string) => Promise<boolean>;
  onDuplicate: () => Promise<void>;
  onToggle: (instance: ProxyInstanceSummary) => Promise<void>;
  onStartAll: () => Promise<void>;
  onStopAll: () => Promise<void>;
  bulkBusy: boolean;
}

function statusText(instance: ProxyInstanceSummary): string {
  if (instance.status.state === "running") return "运行中";
  if (instance.status.state === "error") return "启动失败";
  return "已停止";
}

type DropPosition = "before" | "after";

const INSTANCE_ORDER_STORAGE_KEY = "local-forwarder.proxy-instance-order.v1";

function readInstanceOrder(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(INSTANCE_ORDER_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  } catch {
    return [];
  }
}

function writeInstanceOrder(ids: string[]): void {
  try {
    window.localStorage.setItem(INSTANCE_ORDER_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Keep the current-session order if persistent storage is unavailable.
  }
}

function moveInstance(ids: string[], sourceId: string, targetId: string, position: DropPosition): string[] | undefined {
  const sourceIndex = ids.indexOf(sourceId);
  if (sourceIndex < 0 || sourceId === targetId) return undefined;

  const next = [...ids];
  const [movedId] = next.splice(sourceIndex, 1);
  if (movedId === undefined) return undefined;

  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) return undefined;
  next.splice(targetIndex + (position === "after" ? 1 : 0), 0, movedId);
  return next.every((id, index) => id === ids[index]) ? undefined : next;
}

export function ProxyInstanceSidebar({ instances, onSelect, onCreate, onDelete, onDuplicate, onToggle, onStartAll, onStopAll, bulkBusy }: ProxyInstanceSidebarProps) {
  const [deletingId, setDeletingId] = useState<string>();
  const [contextMenu, setContextMenu] = useState<{ instance: ProxyInstanceSummary; x: number; y: number }>();
  const [instanceOrder, setInstanceOrder] = useState(readInstanceOrder);
  const [draggedId, setDraggedId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition }>();
  const [dragPreviewOrder, setDragPreviewOrder] = useState<string[]>();
  const instanceListRef = useRef<HTMLDivElement | null>(null);
  const dragPointerYRef = useRef<number | undefined>(undefined);
  const dragScrollFrameRef = useRef<number | undefined>(undefined);
  const cardPositionsBeforeReorderRef = useRef<Map<string, number> | undefined>(undefined);
  const cardAnimationsRef = useRef(new Map<string, Animation>());

  const orderedInstances = useMemo(() => {
    const instancesById = new Map(instances.map((instance) => [instance.id, instance] as const));
    const order = dragPreviewOrder ?? instanceOrder;
    const ordered = order.map((id) => instancesById.get(id)).filter((instance): instance is ProxyInstanceSummary => instance !== undefined);
    for (const instance of instances) {
      if (!order.includes(instance.id)) ordered.push(instance);
    }
    return ordered;
  }, [dragPreviewOrder, instanceOrder, instances]);

  useEffect(() => {
    const availableIds = new Set(instances.map((instance) => instance.id));
    setInstanceOrder((current) => {
      const next = current.filter((id) => availableIds.has(id));
      for (const instance of instances) {
        if (!next.includes(instance.id)) next.push(instance.id);
      }
      if (next.length === current.length && next.every((id, index) => id === current[index])) return current;
      writeInstanceOrder(next);
      return next;
    });
  }, [instances]);

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(undefined);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };
    document.addEventListener("pointerdown", closeContextMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeContextMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => () => {
    dragPointerYRef.current = undefined;
    if (dragScrollFrameRef.current !== undefined) window.cancelAnimationFrame(dragScrollFrameRef.current);
    for (const animation of cardAnimationsRef.current.values()) animation.cancel();
    cardAnimationsRef.current.clear();
  }, []);

  useLayoutEffect(() => {
    const previousPositions = cardPositionsBeforeReorderRef.current;
    if (previousPositions === undefined) return;
    cardPositionsBeforeReorderRef.current = undefined;

    const list = instanceListRef.current;
    if (list === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    for (const card of list.querySelectorAll<HTMLElement>(".proxy-instance-sidebar-card[data-instance-id]")) {
      const id = card.dataset.instanceId;
      if (id === undefined) continue;
      const previousTop = previousPositions.get(id);
      if (previousTop === undefined) continue;

      const deltaY = previousTop - card.getBoundingClientRect().top;
      if (Math.abs(deltaY) < 1) continue;

      const animation = card.animate(
        [{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }],
        { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
      cardAnimationsRef.current.set(id, animation);
      animation.onfinish = () => {
        if (cardAnimationsRef.current.get(id) === animation) cardAnimationsRef.current.delete(id);
      };
    }
  }, [orderedInstances]);

  const selectCard = (instance: ProxyInstanceSummary) => {
    if (!instance.selected) void onSelect(instance.id);
  };

  const requestDelete = async (instance: ProxyInstanceSummary) => {
    if (instances.length <= 1 || deletingId !== undefined) return;
    if (!window.confirm(`确定删除代理“${instance.name}”吗？`)) return;
    setDeletingId(instance.id);
    try {
      await onDelete(instance.id);
    } finally {
      setDeletingId(undefined);
    }
  };

  const openContextMenu = (event: MouseEvent<HTMLDivElement>, instance: ProxyInstanceSummary) => {
    event.preventDefault();
    const menuWidth = 156;
    const menuHeight = 82;
    setContextMenu({ instance, x: Math.min(event.clientX, window.innerWidth - menuWidth - 8), y: Math.min(event.clientY, window.innerHeight - menuHeight - 8) });
  };

  const duplicateInstance = async (instance: ProxyInstanceSummary) => {
    setContextMenu(undefined);
    if (!instance.selected) await onSelect(instance.id);
    await onDuplicate();
  };

  const reorderInstance = (sourceId: string, targetId: string, position: DropPosition) => {
    const next = moveInstance(orderedInstances.map((instance) => instance.id), sourceId, targetId, position);
    if (next === undefined) return;
    setInstanceOrder(next);
    writeInstanceOrder(next);
  };

  const captureInstanceCardPositions = () => {
    const list = instanceListRef.current;
    if (list === null) return;

    const positions = new Map<string, number>();
    for (const card of list.querySelectorAll<HTMLElement>(".proxy-instance-sidebar-card[data-instance-id]")) {
      const id = card.dataset.instanceId;
      if (id === undefined) continue;
      positions.set(id, card.getBoundingClientRect().top);
      const animation = cardAnimationsRef.current.get(id);
      if (animation !== undefined) {
        animation.cancel();
        cardAnimationsRef.current.delete(id);
      }
    }
    cardPositionsBeforeReorderRef.current = positions;
  };

  const stopDragAutoScroll = () => {
    dragPointerYRef.current = undefined;
    if (dragScrollFrameRef.current !== undefined) {
      window.cancelAnimationFrame(dragScrollFrameRef.current);
      dragScrollFrameRef.current = undefined;
    }
  };

  const scrollDraggedList = (): void => {
    dragScrollFrameRef.current = undefined;
    const list = instanceListRef.current;
    const pointerY = dragPointerYRef.current;
    if (list === null || pointerY === undefined) return;

    const bounds = list.getBoundingClientRect();
    if (pointerY < bounds.top || pointerY > bounds.bottom) return;

    const edgeSize = Math.min(48, bounds.height / 3);
    if (edgeSize <= 0) return;

    let scrollDelta = 0;
    const distanceFromTop = pointerY - bounds.top;
    const distanceFromBottom = bounds.bottom - pointerY;
    if (distanceFromTop < edgeSize) {
      scrollDelta = -Math.max(1, Math.ceil(((edgeSize - distanceFromTop) / edgeSize) * 8));
    } else if (distanceFromBottom < edgeSize) {
      scrollDelta = Math.max(1, Math.ceil(((edgeSize - distanceFromBottom) / edgeSize) * 8));
    }

    if (scrollDelta === 0) return;
    const previousScrollTop = list.scrollTop;
    list.scrollTop += scrollDelta;
    if (list.scrollTop !== previousScrollTop) {
      dragScrollFrameRef.current = window.requestAnimationFrame(scrollDraggedList);
    }
  };

  const handleListDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (draggedId === undefined || bulkBusy || deletingId !== undefined) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    dragPointerYRef.current = event.clientY;
    if (dragScrollFrameRef.current === undefined) {
      dragScrollFrameRef.current = window.requestAnimationFrame(scrollDraggedList);
    }
  };

  const handleListDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    stopDragAutoScroll();
  };

  const getDropPosition = (event: DragEvent<HTMLDivElement>): DropPosition => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };

  const handleCardDragOver = (event: DragEvent<HTMLDivElement>, id: string) => {
    if (draggedId === undefined || bulkBusy || deletingId !== undefined) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (draggedId === id) {
      setDropTarget((current) => current === undefined ? current : undefined);
      return;
    }
    const position = getDropPosition(event);
    setDropTarget((current) => current?.id === id && current.position === position ? current : { id, position });

    const nextOrder = moveInstance(orderedInstances.map((instance) => instance.id), draggedId, id, position);
    if (nextOrder !== undefined) {
      captureInstanceCardPositions();
      setDragPreviewOrder(nextOrder);
    }
  };

  const handleCardDrop = (event: DragEvent<HTMLDivElement>, id: string) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain") || draggedId;
    if (sourceId !== undefined && !bulkBusy && deletingId === undefined) {
      const currentOrder = orderedInstances.map((instance) => instance.id);
      const nextOrder = moveInstance(currentOrder, sourceId, id, getDropPosition(event)) ?? currentOrder;
      captureInstanceCardPositions();
      setInstanceOrder(nextOrder);
      setDragPreviewOrder(undefined);
      writeInstanceOrder(nextOrder);
    }
    stopDragAutoScroll();
    setDropTarget(undefined);
  };

  const handleReorderKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    const index = orderedInstances.findIndex((instance) => instance.id === id);
    const target = orderedInstances[index + direction];
    if (index >= 0 && target !== undefined) reorderInstance(id, target.id, direction < 0 ? "before" : "after");
  };

  return <section className="proxy-instance-sidebar" aria-label="代理实例列表">
    <div className="proxy-instance-sidebar-heading">
      <div className="proxy-instance-sidebar-bulk-actions">
        <button className="proxy-instance-sidebar-action start" type="button" disabled={bulkBusy || instances.length === 0} onClick={() => void onStartAll()}>一键开启</button>
        <button className="proxy-instance-sidebar-action stop" type="button" disabled={bulkBusy || instances.length === 0} onClick={() => void onStopAll()}>一键关闭</button>
      </div>
      <button className="proxy-instance-sidebar-action create" type="button" disabled={bulkBusy} onClick={() => void onCreate()}>＋ 新增</button>
    </div>
    <div className="proxy-instance-sidebar-list" ref={instanceListRef} onDragOver={handleListDragOver} onDragLeave={handleListDragLeave}>
      {instances.length === 0 && <p className="proxy-instance-sidebar-empty">暂无代理实例</p>}
      {orderedInstances.map((instance) => <div key={instance.id} data-instance-id={instance.id} className={`proxy-instance-sidebar-card ${instance.selected ? "selected" : ""}${draggedId === instance.id ? " dragging" : ""}${dropTarget?.id === instance.id ? ` drop-${dropTarget.position}` : ""}`} role="group" aria-label={instance.name} onContextMenu={(event) => openContextMenu(event, instance)} onDragOver={(event) => handleCardDragOver(event, instance.id)} onDrop={(event) => handleCardDrop(event, instance.id)}>
        <button className="proxy-instance-sidebar-card-main" type="button" aria-pressed={instance.selected} onClick={() => selectCard(instance)} onDoubleClick={() => void onToggle(instance)}>
          <span className="proxy-instance-sidebar-title"><span className={`status-dot ${instance.status.state}`} /><span className="proxy-instance-sidebar-name">{instance.name}</span><span className={`proxy-instance-sidebar-status ${instance.status.state}`}>{statusText(instance)}</span><code>:{instance.port}</code></span>
          <span className="proxy-instance-sidebar-target"><code>{instance.target}</code></span>
        </button>
        {instances.length > 1 && <button className="proxy-instance-sidebar-reorder-handle" type="button" draggable={!bulkBusy && deletingId === undefined} disabled={bulkBusy || deletingId !== undefined} aria-label={`拖动调整${instance.name}顺序`} title="拖动调整顺序，也可用方向键微调" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => handleReorderKeyDown(event, instance.id)} onDragStart={(event) => {
          if (bulkBusy || deletingId !== undefined) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", instance.id);
          setDragPreviewOrder(orderedInstances.map((item) => item.id));
          setDraggedId(instance.id);
        }} onDragEnd={() => {
          if (dragPreviewOrder !== undefined) {
            captureInstanceCardPositions();
            setDragPreviewOrder(undefined);
          }
          stopDragAutoScroll();
          setDraggedId(undefined);
          setDropTarget(undefined);
        }}>
          <svg className="proxy-instance-sidebar-reorder-icon" viewBox="0 0 12 18" aria-hidden="true"><circle cx="3" cy="3" r="1.3" /><circle cx="9" cy="3" r="1.3" /><circle cx="3" cy="9" r="1.3" /><circle cx="9" cy="9" r="1.3" /><circle cx="3" cy="15" r="1.3" /><circle cx="9" cy="15" r="1.3" /></svg>
        </button>}
      </div>)}
    </div>
    {contextMenu && <div className="proxy-instance-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" role="menuitem" disabled={bulkBusy} onClick={() => void duplicateInstance(contextMenu.instance)}>复制此代理</button>
      <button type="button" role="menuitem" disabled={instances.length <= 1 || bulkBusy || deletingId !== undefined} onClick={() => { setContextMenu(undefined); void requestDelete(contextMenu.instance); }}>删除代理</button>
    </div>}
  </section>;
}
