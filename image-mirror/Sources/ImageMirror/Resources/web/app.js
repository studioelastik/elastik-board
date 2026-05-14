"use strict";

const view = document.getElementById("view");
const placeholder = document.getElementById("placeholder");
const statusEl = document.getElementById("status");
const dot = document.getElementById("dot");

let currentVersion = -1;
let source = null;

function setOnline(online) {
  dot.classList.toggle("offline", !online);
  if (!online) {
    statusEl.textContent = "Reconnecting…";
  }
}

// Fetch whatever image the Mac is currently serving and swap it in.
async function loadImage() {
  try {
    const response = await fetch("current?ts=" + Date.now(), { cache: "no-store" });

    if (response.status === 204) {
      view.classList.remove("visible");
      placeholder.classList.add("visible");
      statusEl.textContent = "Waiting for an image…";
      const version = response.headers.get("X-Image-Version");
      if (version !== null) currentVersion = parseInt(version, 10);
      return;
    }
    if (!response.ok) throw new Error("HTTP " + response.status);

    const version = response.headers.get("X-Image-Version");
    if (version !== null) currentVersion = parseInt(version, 10);

    const blob = await response.blob();
    const objectURL = URL.createObjectURL(blob);
    const previous = view.src;

    view.onload = () => {
      placeholder.classList.remove("visible");
      view.classList.add("visible");
      if (previous && previous.startsWith("blob:")) {
        URL.revokeObjectURL(previous);
      }
    };
    view.src = objectURL;
  } catch (error) {
    setOnline(false);
  }
}

// Open the Server-Sent Events stream. The Mac pushes a version number whenever
// the image changes; we re-fetch only when it actually differs.
function connect() {
  if (source) source.close();
  source = new EventSource("events");

  source.onopen = () => {
    dot.classList.remove("offline");
  };

  source.onmessage = (event) => {
    const version = parseInt(event.data, 10);
    if (!Number.isNaN(version) && version !== currentVersion) {
      loadImage();
    }
  };

  source.onerror = () => {
    // EventSource reconnects on its own; reflect the gap in the UI meanwhile.
    setOnline(false);
  };
}

loadImage();
connect();

// Coming back from the lock screen or app switcher: the stream may have died
// and the image may have changed while we were away.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadImage();
    if (!source || source.readyState === EventSource.CLOSED) {
      connect();
    }
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
