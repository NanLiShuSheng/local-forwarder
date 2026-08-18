import { useEffect, useState } from "react";
import type { RuntimeStatus } from "../shared/contracts";

const initialStatus: RuntimeStatus = {
  state: "stopped",
  requestCount: 0,
  tcpConnections: 0,
};

function App() {
  const [status, setStatus] = useState<RuntimeStatus>(initialStatus);

  useEffect(() => {
    void window.forwarder.status().then(setStatus);
  }, []);

  return (
    <main className="app-shell">
      <p className="eyebrow">Electron local service</p>
      <h1>Local Forwarder</h1>
      <section className="status-card" aria-label="Runtime status">
        <span className={`status-dot status-${status.state}`} aria-hidden="true" />
        <div>
          <p className="card-label">Runtime status</p>
          <p className="status-value">{status.state}</p>
        </div>
      </section>
    </main>
  );
}

export default App;
