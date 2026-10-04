"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download, ImagePlus, Lock, RotateCcw, Upload } from "lucide-react";
import { decodePhoto } from "@/lib/photo-decoder";
import { loadCubeLut, LutRenderer } from "@/lib/lut-renderer";

const looks = [
  { key: "ETERNA", name: "ETERNA", description: "柔和电影感" },
  { key: "CNEG", name: "CLASSIC NEG.", description: "浓郁街头" },
  { key: "CHROME", name: "CLASSIC CHROME", description: "克制人文" },
  { key: "REALA", name: "REALA ACE", description: "自然耐看" },
  { key: "PROVIA", name: "PROVIA", description: "清晰标准" },
  { key: "ASTIA", name: "ASTIA", description: "柔和人像" },
  { key: "VELVIA", name: "VELVIA", description: "鲜艳风景" },
  { key: "PNEG", name: "PRO NEG. STD", description: "低反差肤色" },
  { key: "ETBB", name: "ETERNA BB", description: "漂白旁路" },
  { key: "ACROS", name: "ACROS", description: "黑白" },
] as const;

const inputProfiles = [
  {
    key: "iphone14-photo",
    name: "iPhone 14 Pro Max · 照片",
    lutProfile: "iphone14-sdr",
    note: "适用于原生相机 HEIC、JPEG 与 ProRAW DNG。",
  },
  {
    key: "iphone17-photo",
    name: "iPhone 17 Pro · 照片",
    lutProfile: "iphone14-sdr",
    note: "适用于原生相机 HEIC、JPEG 与 ProRAW DNG。",
  },
  {
    key: "s5m2-photo",
    name: "Panasonic S5M2 · 照片",
    lutProfile: "iphone14-sdr",
    note: "适用于相机直出 JPEG 与 RW2；RAW 会先在本机转换为标准照片色彩。",
  },
  {
    key: "iphone17-log",
    name: "iPhone 17 Pro · Apple Log 截帧",
    lutProfile: "iphone17-apple-log",
    note: "仅用于未经还原的 Apple Log 画面截帧，不适用于普通 iPhone 照片。",
  },
  {
    key: "s5m2-vlog",
    name: "Panasonic S5M2 · V-Log 截帧",
    lutProfile: "s5m2-vlog",
    note: "仅用于未经还原的 V-Gamut / V-Log 画面截帧。",
  },
] as const;

type Status = { kind: "idle" | "working" | "ready" | "error"; text: string };

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LutRenderer | null>(null);
  const decodeSequence = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [device, setDevice] = useState("iphone17-photo");
  const [look, setLook] = useState("ETERNA");
  const [strength, setStrength] = useState(100);
  const [format, setFormat] = useState<"jpeg" | "png">("jpeg");
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "照片不会离开这台设备" });
  const [dimensions, setDimensions] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      rendererRef.current = new LutRenderer(canvasRef.current);
    } catch (error) {
      queueMicrotask(() => setStatus({ kind: "error", text: error instanceof Error ? error.message : "初始化失败" }));
    }
    return () => rendererRef.current?.dispose();
    // The renderer is created only once for this canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const profile = inputProfiles.find((item) => item.key === device) ?? inputProfiles[0];
    loadCubeLut(profile.lutProfile, look)
      .then((lut) => {
        if (cancelled) return;
        rendererRef.current?.setLut(lut);
      })
      .catch((error) => setStatus({ kind: "error", text: error instanceof Error ? error.message : "LUT 加载失败" }));
    return () => { cancelled = true; };
  }, [device, look]);

  useEffect(() => {
    rendererRef.current?.setStrength(showOriginal ? 0 : strength / 100);
  }, [strength, showOriginal]);

  const processFile = useCallback(async (nextFile: File) => {
    const sequence = ++decodeSequence.current;
    setFile(nextFile);
    setStatus({ kind: "working", text: /\.(dng|rw2)$/i.test(nextFile.name) ? "正在解码 RAW，可能需要几秒…" : "正在读取照片…" });

    try {
      const decoded = await decodePhoto(nextFile);
      if (sequence !== decodeSequence.current) {
        decoded.bitmap.close();
        return;
      }
      const output = rendererRef.current?.setImage(decoded.bitmap);
      if (!output) throw new Error("图像处理器尚未就绪，请重试。");
      const size = `${output.width} × ${output.height}${output.resized ? " · 已适配当前设备" : ""}`;
      setDimensions(size);
      setStatus({ kind: "ready", text: `${decoded.format} · ${size}` });
    } catch (error) {
      setFile(null);
      setDimensions("");
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "无法读取这张照片" });
    }
  }, []);

  const clear = () => {
    decodeSequence.current += 1;
    setFile(null);
    setDimensions("");
    setStatus({ kind: "idle", text: "照片不会离开这台设备" });
    if (inputRef.current) inputRef.current.value = "";
  };

  const exportPhoto = async () => {
    if (!file || !rendererRef.current) return;
    setStatus({ kind: "working", text: "正在生成照片…" });
    try {
      const type = format === "png" ? "image/png" : "image/jpeg";
      const blob = await rendererRef.current.export(type);
      const baseName = file.name.replace(/\.[^.]+$/, "");
      downloadBlob(blob, `${baseName}-${device}-${look}.${format === "png" ? "png" : "jpg"}`);
      setStatus({ kind: "ready", text: `已导出 ${format.toUpperCase()} · ${dimensions}` });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "导出失败" });
    }
  };

  const selectedLook = looks.find((item) => item.key === look)!;
  const selectedProfile = inputProfiles.find((item) => item.key === device) ?? inputProfiles[0];
  const isReady = file && status.kind !== "working" && status.kind !== "error";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">L</span>
          <span>LUT Studio</span>
        </div>
        <div className="privacy"><Lock size={13} strokeWidth={2.2} />本地处理</div>
      </header>

      <div className="workspace">
        <aside className="controls">
          <div className="controls-heading">
            <p>照片调色</p>
            <h1>给照片一种<br />熟悉的富士色彩。</h1>
            <span>支持 iPhone 与 Panasonic 相机照片，所有处理都在你的浏览器中完成。</span>
          </div>

          <section className="control-section">
            <label className="control-label">照片</label>
            <button
              type="button"
              className={`upload-card ${dragging ? "is-dragging" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragEnter={() => setDragging(true)}
              onDragLeave={() => setDragging(false)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const next = event.dataTransfer.files[0];
                if (next) processFile(next);
              }}
            >
              <span className="upload-icon"><Upload size={18} /></span>
              <span className="upload-copy">
                <strong>{file ? file.name : "选择照片"}</strong>
                <small>{file ? "点击更换照片" : "或拖到这里 · HEIC / JPG / DNG / RW2"}</small>
              </span>
            </button>
            <input ref={inputRef} hidden type="file" accept="image/*,.heic,.heif,.dng,.rw2" onChange={(event) => { const next = event.target.files?.[0]; if (next) processFile(next); }} />
          </section>

          <section className="control-section two-columns">
            <label className="control-label">输入配置</label>
            <div className="select-wrap">
              <select value={device} onChange={(event) => setDevice(event.target.value)}>
                {inputProfiles.map((profile) => <option key={profile.key} value={profile.key}>{profile.name}</option>)}
              </select>
              <ChevronDown size={14} />
            </div>
            <p className="profile-note">{selectedProfile.note}</p>
          </section>

          <section className="control-section">
            <label className="control-label">富士风格</label>
            <div className="look-list">
              {looks.map((item) => (
                <button type="button" key={item.key} className={look === item.key ? "selected" : ""} onClick={() => setLook(item.key)}>
                  <span><strong>{item.name}</strong><small>{item.description}</small></span>
                  {look === item.key && <Check size={16} strokeWidth={2.5} />}
                </button>
              ))}
            </div>
          </section>

          <section className="control-section">
            <div className="range-heading"><label className="control-label" htmlFor="strength">强度</label><span>{strength}%</span></div>
            <input id="strength" className="strength-range" type="range" min="0" max="100" value={strength} onChange={(event) => setStrength(Number(event.target.value))} style={{ "--progress": `${strength}%` } as React.CSSProperties} />
          </section>

          <section className="export-row">
            <div className="format-toggle" aria-label="导出格式">
              <button type="button" className={format === "jpeg" ? "active" : ""} onClick={() => setFormat("jpeg")}>JPEG</button>
              <button type="button" className={format === "png" ? "active" : ""} onClick={() => setFormat("png")}>PNG</button>
            </div>
            <button type="button" className="download-button" disabled={!isReady} onClick={exportPhoto}><Download size={16} />导出照片</button>
          </section>
        </aside>

        <section className="stage">
          <div className="stage-toolbar">
            <div className={`status ${status.kind}`}><span />{status.text}</div>
            {file && <button type="button" className="clear-button" onClick={clear}><RotateCcw size={14} />重新选择</button>}
          </div>

          <div className={`canvas-frame ${file ? "has-photo" : ""}`}>
            <canvas ref={canvasRef} aria-label="应用 LUT 后的照片预览" />
            {!file && (
              <button type="button" className="empty-state" onClick={() => inputRef.current?.click()}>
                <span className="empty-icon"><ImagePlus size={24} /></span>
                <strong>添加一张照片</strong>
                <small>HEIC、JPEG、PNG、WebP、ProRAW DNG 与 Panasonic RW2</small>
              </button>
            )}
          </div>

          {file && (
            <div className="preview-footer">
              <div><strong>{selectedLook.name}</strong><span>{selectedLook.description} · {strength}%</span></div>
              <button
                type="button"
                className="compare-button"
                onPointerDown={() => setShowOriginal(true)}
                onPointerUp={() => setShowOriginal(false)}
                onPointerLeave={() => setShowOriginal(false)}
                onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") setShowOriginal(true); }}
                onKeyUp={() => setShowOriginal(false)}
              >
                {showOriginal ? "原图" : "按住查看原图"}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
