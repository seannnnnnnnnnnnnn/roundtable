import React from "react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Roundtable UI render failed", error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="render-fallback">
          <div>
            <span>界面保护已生效</span>
            <h1>有一段模型结果无法正常展示</h1>
            <p>数据仍然保存在当前会话。刷新后将使用兼容格式重新读取。</p>
            <button onClick={() => window.location.reload()}>重新载入工作台</button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
