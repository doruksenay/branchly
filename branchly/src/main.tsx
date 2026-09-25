import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Tema, ilk çizimden önce sistem tercihine göre ayarlanır (yanıp sönmeyi önler)
document.documentElement.dataset.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
