(() => {
  const DOWNLOAD_BASE = "/local-forwarder/";
  const VERSION_PLACEHOLDER = "读取中";

  const versionNodes = [...document.querySelectorAll("[data-version]")];
  const windowsLink = document.querySelector('[data-download="windows"]');
  const macIntelLink = document.querySelector('[data-download="mac-x64"]');
  const macArm64Link = document.querySelector('[data-download="mac-arm64"]');
  const hasMacDownloads = macIntelLink !== null || macArm64Link !== null;
  const downloadStatus = document.querySelector("[data-download-status]");
  const nav = document.querySelector("[data-nav]");
  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const prefersReducedMotion = () => reduceMotionQuery.matches;

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
    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch {
      throw new Error("Invalid mac-update.json");
    }
    const version = typeof manifest?.version === "string" ? manifest.version : "";
    const files = Array.isArray(manifest?.files) ? manifest.files : [];
    const fileForArch = (arch) => {
      const file = files.find((entry) => entry?.arch === arch && typeof entry?.name === "string");
      return file?.name.trim() || undefined;
    };
    const x64FileName = fileForArch("x64");
    const arm64FileName = fileForArch("arm64");
    if (!version || !x64FileName || !arm64FileName) throw new Error("Invalid mac-update.json");
    return {
      version,
      x64FileName,
      arm64FileName,
      releaseDate: typeof manifest.releaseDate === "string" ? manifest.releaseDate : undefined,
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
      fetchText("latest.yml").then(parseWindowsManifest),
      hasMacDownloads ? fetchText("mac-update.json").then(parseMacManifest) : Promise.resolve(undefined),
    ]);
    const windowsManifest = windowsResult.status === "fulfilled" ? windowsResult.value : undefined;
    const macManifest = macResult.status === "fulfilled" ? macResult.value : undefined;

    if (windowsManifest) {
      setVersion(windowsManifest.version);
      setLinkReady(
        windowsLink,
        resolveAssetUrl(windowsManifest.fileName),
        "下载 Windows x64 安装包",
      );
      windowsLink?.setAttribute("download", "");
    } else {
      setLinkUnavailable(windowsLink, "Windows 版本读取失败");
    }

    if (hasMacDownloads) {
      if (macManifest) {
        setVersion(macManifest.version);
        setLinkReady(macIntelLink, resolveAssetUrl(macManifest.x64FileName), `DMG · v${macManifest.version}`);
        setLinkReady(macArm64Link, resolveAssetUrl(macManifest.arm64FileName), `DMG · v${macManifest.version}`);
        macIntelLink?.setAttribute("download", "");
        macArm64Link?.setAttribute("download", "");
      } else {
        setLinkUnavailable(macIntelLink, "Intel 版本读取失败", "无法读取 macOS Intel 安装包");
        setLinkUnavailable(macArm64Link, "Apple Silicon 版本读取失败", "无法读取 macOS Apple Silicon 安装包");
      }
    }

    if (!windowsManifest && !macManifest) {
      versionNodes.forEach((node) => {
        node.textContent = VERSION_PLACEHOLDER;
      });
      setStatus("无法读取最新版本信息，请稍后刷新页面", true);
      return;
    }

    if (windowsManifest && (!hasMacDownloads || macManifest)) {
      const releaseDate = formatReleaseDate(windowsManifest.releaseDate ?? macManifest?.releaseDate);
      setStatus(
        releaseDate
          ? `最新${hasMacDownloads ? " Windows 与 macOS " : " Windows "}版本已就绪 · 发布于 ${releaseDate}`
          : `最新${hasMacDownloads ? " Windows 与 macOS " : " Windows "}版本已就绪`,
      );
      return;
    }

    setStatus(
      windowsManifest
        ? "Windows 版本已就绪，macOS 下载信息读取失败，请稍后刷新"
        : "macOS 版本已就绪，Windows 下载信息读取失败，请稍后刷新",
      true,
    );
  };

  const setupImageLoadState = () => {
    const images = document.querySelectorAll(
      ".page-download .product-screen img, .page-download .scene-window img, .page-download .latest-window img",
    );

    images.forEach((image) => {
      const markLoaded = () => image.classList.add("is-loaded");
      if (image.complete) {
        markLoaded();
        return;
      }
      image.addEventListener("load", markLoaded, { once: true });
      image.addEventListener("error", markLoaded, { once: true });
    });
  };

  const setupReveals = () => {
    const nodes = [...document.querySelectorAll("[data-reveal]")];
    if (nodes.length === 0) return;

    const showAll = () => {
      nodes.forEach((node) => node.classList.add("is-revealed"));
    };

    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      showAll();
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          return;
        }
        if (entry.boundingClientRect.top > 0 || entry.boundingClientRect.bottom < 0) {
          entry.target.classList.remove("is-revealed");
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    nodes.forEach((node) => observer.observe(node));
    reduceMotionQuery.addEventListener?.("change", (event) => {
      if (!event.matches) return;
      observer.disconnect();
      showAll();
    });
  };

  const setupPointerParallax = () => {
    const host = document.querySelector("[data-pointer-parallax]");
    const frame = host?.querySelector(".product-frame");
    if (!host || !frame) return;

    let frameRequest = 0;
    let pointerX = 0;
    let pointerY = 0;

    const clamp = (value) => Math.max(-1, Math.min(1, value));

    const render = () => {
      frameRequest = 0;
      frame.style.setProperty("--frame-rotate-y", `${(pointerX * 2.4).toFixed(2)}deg`);
      frame.style.setProperty("--frame-rotate-x", `${(-pointerY * 1.6).toFixed(2)}deg`);
      frame.style.setProperty("--frame-shift-x", `${(pointerX * 4).toFixed(2)}px`);
      frame.style.setProperty("--frame-shift-y", `${(pointerY * 3).toFixed(2)}px`);
    };

    const scheduleRender = () => {
      if (frameRequest) return;
      frameRequest = window.requestAnimationFrame(render);
    };

    const reset = () => {
      if (frameRequest) window.cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      pointerX = 0;
      pointerY = 0;
      frame.style.removeProperty("--frame-rotate-y");
      frame.style.removeProperty("--frame-rotate-x");
      frame.style.removeProperty("--frame-shift-x");
      frame.style.removeProperty("--frame-shift-y");
    };

    host.addEventListener("pointermove", (event) => {
      if (prefersReducedMotion() || event.pointerType === "touch") return;
      const bounds = host.getBoundingClientRect();
      pointerX = clamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2);
      pointerY = clamp(((event.clientY - bounds.top) / bounds.height - 0.5) * 2);
      scheduleRender();
    }, { passive: true });

    host.addEventListener("pointerleave", reset);
    reduceMotionQuery.addEventListener?.("change", (event) => {
      if (event.matches) reset();
    });
  };

  const setupNav = () => {
    const links = [...document.querySelectorAll(".nav-links a[href^='#']")];
    const sections = links
      .map((link) => ({ link, section: document.querySelector(link.getAttribute("href")) }))
      .filter((item) => item.section);
    let frameRequest = 0;

    const update = () => {
      frameRequest = 0;
      nav?.classList.toggle("is-scrolled", window.scrollY > 12);
      if (sections.length === 0) return;

      const marker = window.scrollY + window.innerHeight * 0.7;
      let activeLink = null;
      sections.forEach(({ link, section }) => {
        const sectionTop = section.getBoundingClientRect().top + window.scrollY;
        if (sectionTop <= marker) activeLink = link;
      });

      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) {
        activeLink = sections[sections.length - 1].link;
      }

      links.forEach((link) => {
        link.classList.toggle("is-active", link === activeLink);
      });
    };

    const requestUpdate = () => {
      if (frameRequest) return;
      frameRequest = window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate, { passive: true });
    update();
  };

  setupImageLoadState();
  setupReveals();
  setupPointerParallax();
  setupNav();
  loadDownloads();
})();
