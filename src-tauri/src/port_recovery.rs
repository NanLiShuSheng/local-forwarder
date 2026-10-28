use std::time::{Duration, Instant};

const AUTO_RECOVERY_PORT_MIN: u16 = 8080;
const AUTO_RECOVERY_PORT_MAX: u16 = 8089;
const TERM_GRACE: Duration = Duration::from_millis(1000);
const KILL_GRACE: Duration = Duration::from_millis(1000);
const POLL_INTERVAL: Duration = Duration::from_millis(50);

pub fn is_auto_recoverable_port(port: u16) -> bool {
    (AUTO_RECOVERY_PORT_MIN..=AUTO_RECOVERY_PORT_MAX).contains(&port)
}

#[cfg(unix)]
async fn list_listening_pids(port: u16) -> Result<Vec<u32>, String> {
    let output = tokio::process::Command::new("lsof")
        .args(["-nP", "-t", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(format!("lsof failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    let mut pids: Vec<u32> = String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .filter_map(|token| token.parse::<u32>().ok())
        .filter(|pid| *pid > 0 && *pid != std::process::id())
        .collect();
    pids.sort_unstable();
    pids.dedup();
    Ok(pids)
}

#[cfg(unix)]
async fn signal_pids(pids: &[u32], signal: &str) -> Result<(), String> {
    for pid in pids {
        let _ = tokio::process::Command::new("kill").args([signal, &pid.to_string()]).output().await;
    }
    Ok(())
}

#[cfg(unix)]
pub async fn recover_occupied_port(port: u16) -> Result<(), String> {
    if !is_auto_recoverable_port(port) {
        return Ok(());
    }
    let pids = list_listening_pids(port).await?;
    if pids.is_empty() {
        return Ok(());
    }
    signal_pids(&pids, "-TERM").await?;
    if wait_for_port_release(port, TERM_GRACE).await? {
        return Ok(());
    }
    signal_pids(&pids, "-KILL").await?;
    if wait_for_port_release(port, KILL_GRACE).await? {
        return Ok(());
    }
    Err(format!("could not release port {port}"))
}

#[cfg(unix)]
async fn wait_for_port_release(port: u16, timeout: Duration) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if list_listening_pids(port).await?.is_empty() {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// netstat 输出解析（纯函数，跨平台可测）
pub fn parse_windows_listening_process_ids(output: &str, port: u16) -> Vec<u32> {
    let mut pids: Vec<u32> = Vec::new();
    for line in output.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 5 || !fields[0].eq_ignore_ascii_case("TCP") || !fields[3].eq_ignore_ascii_case("LISTENING") {
            continue;
        }
        let local_port = fields[1].rsplit(':').next().and_then(|value| value.parse::<u16>().ok());
        let pid = fields[4].parse::<u32>().ok().filter(|pid| *pid > 0);
        if local_port == Some(port) {
            if let Some(pid) = pid {
                pids.push(pid);
            }
        }
    }
    pids.sort_unstable();
    pids.dedup();
    pids
}

#[cfg(windows)]
async fn list_listening_pids(port: u16) -> Result<Vec<u32>, String> {
    let output = tokio::process::Command::new("netstat").args(["-ano", "-p", "tcp"]).output().await.map_err(|error| error.to_string())?;
    let mut pids = parse_windows_listening_process_ids(&String::from_utf8_lossy(&output.stdout), port);
    pids.retain(|pid| *pid != std::process::id());
    Ok(pids)
}

#[cfg(windows)]
async fn terminate_pids(pids: &[u32], force: bool) -> Result<(), String> {
    for pid in pids {
        let mut args = vec!["/PID".to_string(), pid.to_string(), "/T".to_string()];
        if force {
            args.push("/F".to_string());
        }
        let _ = tokio::process::Command::new("taskkill").args(&args).output().await;
    }
    Ok(())
}

// Windows 路径无法在 mac 上实测，按 TS 版逐行移植
#[cfg(windows)]
pub async fn recover_occupied_port(port: u16) -> Result<(), String> {
    if !is_auto_recoverable_port(port) {
        return Ok(());
    }
    let pids = list_listening_pids(port).await?;
    if pids.is_empty() {
        return Ok(());
    }
    terminate_pids(&pids, false).await?;
    if wait_for_port_release(port, TERM_GRACE).await? {
        return Ok(());
    }
    terminate_pids(&pids, true).await?;
    if wait_for_port_release(port, KILL_GRACE).await? {
        return Ok(());
    }
    Err(format!("could not release port {port}"))
}

#[cfg(windows)]
async fn wait_for_port_release(port: u16, timeout: Duration) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if list_listening_pids(port).await?.is_empty() {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

#[cfg(not(any(unix, windows)))]
pub async fn recover_occupied_port(port: u16) -> Result<(), String> {
    let _ = port;
    Err("port recovery is not implemented on this platform".to_string())
}
