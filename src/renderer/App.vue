<template>
  <main class="shell">
    <section class="card">
      <p class="eyebrow">Day 1 Scaffold</p>
      <h1>PKCS#12 Converter</h1>
      <p class="body">
        Electron main process, preload bridge, and Vue renderer are wired for the
        first milestone. Day 2 will attach IPC handlers and shared types.
      </p>
    </section>
  </main>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 24px;
  background:
    radial-gradient(circle at top, rgba(30, 64, 175, 0.18), transparent 40%),
    linear-gradient(160deg, #f8fafc 0%, #dbeafe 100%);
  color: #0f172a;
  font-family: "Segoe UI", "Noto Sans TC", sans-serif;
}

.card {
  width: min(560px, 100%);
  padding: 40px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
}

.eyebrow {
  margin: 0 0 12px;
  color: #1d4ed8;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 16px;
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05;
}

.body {
  margin: 0;
  font-size: 1rem;
  line-height: 1.7;
}
</style>

