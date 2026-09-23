import { useEffect, useState, type MouseEvent } from "react";
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

export function ProxyInstanceSidebar({ instances, onSelect, onCreate, onDelete, onDuplicate, onToggle, onStartAll, onStopAll, bulkBusy }: ProxyInstanceSidebarProps) {
  const [deletingId, setDeletingId] = useState<string>();
  const [contextMenu, setContextMenu] = useState<{ instance: ProxyInstanceSummary; x: number; y: number }>();

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

  return <section className="proxy-instance-sidebar" aria-label="代理实例列表">
    <div className="proxy-instance-sidebar-heading">
      <div className="proxy-instance-sidebar-bulk-actions">
        <button className="proxy-instance-sidebar-action start" type="button" disabled={bulkBusy || instances.length === 0} onClick={() => void onStartAll()}>一键开启</button>
        <button className="proxy-instance-sidebar-action stop" type="button" disabled={bulkBusy || instances.length === 0} onClick={() => void onStopAll()}>一键关闭</button>
      </div>
      <button className="proxy-instance-sidebar-action create" type="button" disabled={bulkBusy} onClick={() => void onCreate()}>＋ 新增</button>
    </div>
    <div className="proxy-instance-sidebar-list">
      {instances.length === 0 && <p className="proxy-instance-sidebar-empty">暂无代理实例</p>}
      {instances.map((instance) => <div key={instance.id} className={`proxy-instance-sidebar-card ${instance.selected ? "selected" : ""}`} role="group" aria-label={instance.name} onContextMenu={(event) => openContextMenu(event, instance)}>
        <button className="proxy-instance-sidebar-card-main" type="button" aria-pressed={instance.selected} onClick={() => selectCard(instance)} onDoubleClick={() => void onToggle(instance)}>
          <span className="proxy-instance-sidebar-title"><span className={`status-dot ${instance.status.state}`} /><span className="proxy-instance-sidebar-name">{instance.name}</span><span className={`proxy-instance-sidebar-status ${instance.status.state}`}>{statusText(instance)}</span><code>:{instance.port}</code></span>
          <span className="proxy-instance-sidebar-target"><code>{instance.target}</code></span>
        </button>
      </div>)}
    </div>
    {contextMenu && <div className="proxy-instance-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" role="menuitem" disabled={bulkBusy} onClick={() => void duplicateInstance(contextMenu.instance)}>复制此代理</button>
      <button type="button" role="menuitem" disabled={instances.length <= 1 || bulkBusy || deletingId !== undefined} onClick={() => { setContextMenu(undefined); void requestDelete(contextMenu.instance); }}>删除代理</button>
    </div>}
  </section>;
}
