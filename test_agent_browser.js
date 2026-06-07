// Paste this into the browser console on https://aifinops-frontend.onrender.com
// while logged in as an admin user.
// It fires 5 sensitive-data calls + 8 rapid loop calls to trigger both alerts.

(async () => {
  const API_KEY = "gk-PkdKHCmt9F6SiLrI9rruHkTCBK-dz8n7SGelbl2zqMQ";
  // Derive backend URL from the frontend's VITE_API_BASE or fall back to Render default
  const BASE = window.__VITE_API_BASE__ || "https://aifinops-backend.onrender.com";

  const headers = {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    "X-Guard-Team":  "Developer",
    "X-Guard-Agent": "test-loop-agent",
  };

  const call = async (prompt) => {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    return r.status;
  };

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // Phase 1: Sensitive data exposure
  console.log("=== Phase 1: Sensitive data exposure ===");
  const sensitivePrompts = [
    "Process employee record: John Doe, SSN 123-45-6789.",
    "Charge card 4111 1111 1111 1111 for the order.",
    "Email alice@example.com or call +1 (555) 867-5309.",
    "Deployment uses AKIAIOSFODNN7EXAMPLE for S3 — rotate it.",
    "Wire refund to IBAN GB29NWBK60161331926819.",
  ];
  for (let i = 0; i < sensitivePrompts.length; i++) {
    const s = await call(sensitivePrompts[i]);
    console.log(`  [${s}] sensitive ${i+1}/${sensitivePrompts.length}`);
    await delay(400);
  }

  // Phase 2: Looping agent (8 calls)
  console.log("=== Phase 2: Looping agent ===");
  for (let i = 1; i <= 8; i++) {
    const s = await call("ping");
    console.log(`  [${s}] loop ${i}/8`);
    await delay(200);
  }

  console.log("Done — refresh the Alerts / Security page in the dashboard.");
})();
