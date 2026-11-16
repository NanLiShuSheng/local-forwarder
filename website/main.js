(() => {
  const DOWNLOAD_BASE = "/local-forwarder/";
  const VERSION_PLACEHOLDER = "读取中";

  const versionNodes = [...document.querySelectorAll("[data-version]")];
  const windowsLink = document.querySelector('[data-download="windows"]');
  const macIntelLink = document.querySelector('[data-download="mac-intel"]');
  const macArm64Link = document.querySelector('[data-download="mac-arm64"]');
  const downloadStatus = document.querySelector("[data-download-status]");
  const nav = document.querySelector("[data-nav]");

  const setVersion = (version) => {
    if (!version) return;
    versionNodes.forEach((node) => {
      node.textContent = `v${version}`;
    });
  };

  const resolveAssetUrl = (fileName) => {
    const base = new URL(DOWNLOAD_BASE, window.location.origin);
    const asset = new URL(fileName, base);
    if (asset.origin !== base.origin || !asset.pathname.startsWith(base.pathname)) {
      throw new Error("Invalid download asset path");
    }
    return asset.href;
  };

  const setLinkReady = (link, href, label) => {
    if (!link) return;
    link.href = href;
    link.removeAttribute("aria-disabled");
    link.classList.remove("is-loading", "is-unavailable");
    const labelNode = link.querySelector("[data-download-label]");
    if (labelNode && label) labelNode.textContent = label;
  };

  const setLinkUnavailable = (link, label, errorMessage) => {
    if (!link) return;
    link.href = "#download";
    link.setAttribute("aria-disabled", "true");
    link.classList.remove("is-loading");
    link.classList.add("is-unavailable");
    const labelNode = link.querySelector("[data-download-label]");
    if (labelNode) labelNode.textContent = label;
    link.addEventListener("click", (event) => event.preventDefault());
    if (errorMessage) link.title = errorMessage;
  };

  const fetchText = async (path) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const manifestBase = new URL(DOWNLOAD_BASE, `${window.location.origin}/`);
      const response = await fetch(new URL(path, manifestBase), {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return await response.text();
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const parseWindowsManifest = (text) => {
    const version = text.match(/^version:\s*["']?([^\s"']+)/m)?.[1];
    const fileName = text.match(/^\s*-\s*url:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1]
      ?? text.match(/^path:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1];
    const releaseDate = text.match(/^releaseDate:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1];
    if (!version || !fileName) throw new Error("Invalid latest.yml");
    return { version, fileName: fileName.trim(), releaseDate };
  };

  const parseMacManifest = (text) => {
    const manifest = JSON.parse(text);
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (!manifest.version || files.length === 0) throw new Error("Invalid mac-update.json");
    return {
      version: String(manifest.version),
      releaseDate: manifest.releaseDate,
      intel: files.find((file) => file.arch === "x64"),
      arm64: files.find((file) => file.arch === "arm64"),
    };
  };

  const formatReleaseDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
  };

  const setStatus = (message, isError = false) => {
    if (!downloadStatus) return;
    downloadStatus.classList.toggle("is-error", isError);
    downloadStatus.innerHTML = "";
    const dot = document.createElement("span");
    dot.className = "status-dot";
    const text = document.createElement("span");
    text.textContent = message;
    downloadStatus.append(dot, text);
  };

  const loadDownloads = async () => {
    const [windowsResult, macResult] = await Promise.allSettled([
      fetchText("latest.yml"),
      fetchText("mac-update.json"),
    ]);

    let windowsManifest = null;
    let macManifest = null;

    if (windowsResult.status === "fulfilled") {
      try {
        windowsManifest = parseWindowsManifest(windowsResult.value);
        setVersion(windowsManifest.version);
        setLinkReady(
          windowsLink,
          resolveAssetUrl(windowsManifest.fileName),
          "下载 Windows x64 安装包",
        );
        windowsLink?.setAttribute("download", "");
      } catch {
        setLinkUnavailable(windowsLink, "Windows 版本信息不可用");
      }
    } else {
      setLinkUnavailable(windowsLink, "Windows 版本读取失败");
    }

    if (macResult.status === "fulfilled") {
      try {
        macManifest = parseMacManifest(macResult.value);
        setVersion(macManifest.version);

        if (macManifest.intel?.name) {
          setLinkReady(
            macIntelLink,
            resolveAssetUrl(macManifest.intel.name),
            "DMG · Intel 安装包",
          );
          macIntelLink?.setAttribute("download", "");
        } else {
          setLinkUnavailable(macIntelLink, "Intel 安装包不可用");
        }

        if (macManifest.arm64?.name) {
          setLinkReady(
            macArm64Link,
            resolveAssetUrl(macManifest.arm64.name),
            "DMG · Apple Silicon",
          );
          macArm64Link?.setAttribute("download", "");
        } else {
          setLinkUnavailable(macArm64Link, "Apple Silicon 安装包不可用");
        }
      } catch {
        setLinkUnavailable(macIntelLink, "Intel 安装包读取失败");
        setLinkUnavailable(macArm64Link, "Apple Silicon 读取失败");
      }
    } else {
      setLinkUnavailable(macIntelLink, "Intel 安装包读取失败");
      setLinkUnavailable(macArm64Link, "Apple Silicon 读取失败");
    }

    const versions = [windowsManifest?.version, macManifest?.version].filter(Boolean);
    if (versions.length > 0) {
      setVersion(versions[0]);
    } else {
      versionNodes.forEach((node) => {
        node.textContent = VERSION_PLACEHOLDER;
      });
    }

    const releaseDate = formatReleaseDate(windowsManifest?.releaseDate ?? macManifest?.releaseDate);
    if (windowsManifest && macManifest) {
      setStatus(releaseDate ? `最新版本已就绪 · 发布于 ${releaseDate}` : "最新版本已就绪");
      return;
    }
    if (windowsManifest || macManifest) {
      setStatus("部分平台信息暂不可用，请刷新页面重试", true);
      return;
    }
    setStatus("无法读取最新版本信息，请稍后刷新页面", true);
  };

  const setNavState = () => {
    nav?.classList.toggle("is-scrolled", window.scrollY > 12);
  };

  setNavState();
  window.addEventListener("scroll", setNavState, { passive: true });
  loadDownloads().catch(() => setStatus("无法读取最新版本信息，请稍后刷新页面", true));
})();
