import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  whatsappToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION || "v23.0",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  allowedTestNumbers: new Set(
    (process.env.ALLOWED_TEST_NUMBERS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ),
};
const processedMessageIds = new Map();
const processedMessageTtlMs = 10 * 60 * 1000;

const systemPrompt = `You are Hominal Healthcare Pvt Ltd's WhatsApp assistant.
You help patients and families with polite, concise answers about home healthcare services.

Business context:
- Hominal Healthcare Pvt Ltd provides home healthcare support.
- Typical requests include nursing care, attendant care, doctor visits, physiotherapy, elder care, patient billing support, service availability, and callbacks.
- Ask for the user's city/locality, patient condition, service needed, preferred date/time, and contact name when a booking or callback is needed.
- Do not diagnose, prescribe medicine, or replace emergency care. For emergencies, tell the user to call local emergency services or visit the nearest hospital immediately.
- Keep replies short enough for WhatsApp.
- If the user asks for price, explain that the team can confirm pricing after service, duration, location, and patient needs are known.`;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { ok: true, service: "hominal-whatsapp-ai-chatbot" });
    }

    if (request.method === "GET" && url.pathname === "/webhook") {
      return verifyWebhook(url, response);
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      const rawBody = await readRawBody(request);
      if (!isValidWhatsAppSignature(request.headers["x-hub-signature-256"], rawBody)) {
        return sendJson(response, 403, { error: "Invalid signature" });
      }

      const payload = parseJsonBody(rawBody);
      sendJson(response, 200, { received: true });
      queueMicrotask(() => {
        handleWebhook(payload).catch((error) => {
          console.error("Webhook processing failed", error);
        });
      });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Hominal WhatsApp AI chatbot listening on http://${config.host}:${config.port}`);
});

function verifyWebhook(url, response) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === config.verifyToken && challenge) {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(challenge);
    return;
  }

  sendJson(response, 403, { error: "Webhook verification failed" });
}

async function handleWebhook(payload) {
  const messages = extractIncomingMessages(payload);

  for (const message of messages) {
    if (!shouldProcessMessage(message)) {
      continue;
    }

    if (config.allowedTestNumbers.size && !config.allowedTestNumbers.has(message.from)) {
      console.log(`Ignored message from non-allowed number ${message.from}`);
      continue;
    }

    const userText = getMessageText(message);
    if (!userText) {
      await sendWhatsAppText(message.from, "Thank you for contacting Hominal Healthcare. Please send your request in text and our assistant will help.");
      continue;
    }

    const reply = await generateAiReply(userText);
    try {
      await sendWhatsAppText(message.from, reply);
    } catch (error) {
      console.error(`Failed to send WhatsApp reply to ${message.from}`, error);
    }
  }
}

function extractIncomingMessages(payload) {
  const messages = [];

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const message of value.messages || []) {
        messages.push(message);
      }
    }
  }

  return messages;
}

function getMessageText(message) {
  if (message.type === "text") {
    return message.text?.body?.trim();
  }

  if (message.type === "button") {
    return message.button?.text?.trim();
  }

  if (message.type === "interactive") {
    return (
      message.interactive?.button_reply?.title?.trim() ||
      message.interactive?.list_reply?.title?.trim()
    );
  }

  return "";
}

async function generateAiReply(userText) {
  if (!config.openaiApiKey || config.openaiApiKey === "sk-your-key") {
    return fallbackReply(userText);
  }

  try {
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.openaiModel,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        max_output_tokens: 220,
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      throw new Error(`OpenAI request failed: ${openaiResponse.status} ${errorText}`);
    }

    const data = await openaiResponse.json();
    return (
      data.output_text?.trim() ||
      "Thank you for contacting Hominal Healthcare. Please share the service needed, city, patient condition, and preferred callback time."
    );
  } catch (error) {
    console.error("Falling back after OpenAI error", error);
    return fallbackReply(userText);
  }
}

function fallbackReply(userText) {
  const text = userText.toLowerCase();

  if (text.includes("emergency") || text.includes("urgent")) {
    return "If this is a medical emergency, please call local emergency services or visit the nearest hospital immediately. For Hominal Healthcare home care support, please share your city, patient condition, and contact name.";
  }

  if (text.includes("price") || text.includes("cost") || text.includes("charges")) {
    return "Hominal Healthcare can confirm pricing after checking the service needed, duration, location, and patient condition. Please share your city, service requirement, and preferred callback time.";
  }

  return "Thank you for contacting Hominal Healthcare Pvt Ltd. Please share the service needed, city/locality, patient condition, and preferred callback time. Our team will assist you shortly.";
}

async function sendWhatsAppText(to, body) {
  assertConfigured(config.whatsappToken, "WHATSAPP_ACCESS_TOKEN");
  assertConfigured(config.phoneNumberId, "WHATSAPP_PHONE_NUMBER_ID");

  const whatsappResponse = await fetch(
    `https://graph.facebook.com/${config.whatsappApiVersion}/${config.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.whatsappToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body,
        },
      }),
    },
  );

  if (!whatsappResponse.ok) {
    const errorText = await whatsappResponse.text();
    throw new Error(`WhatsApp send failed: ${whatsappResponse.status} ${errorText}`);
  }
}

function assertConfigured(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
}

async function readJson(request) {
  return parseJsonBody(await readRawBody(request));
}

async function readRawBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return chunks.length ? Buffer.concat(chunks) : Buffer.from("");
}

function parseJsonBody(rawBody) {
  if (!rawBody.length) {
    return {};
  }

  return JSON.parse(rawBody.toString("utf8"));
}

function isValidWhatsAppSignature(signatureHeader, rawBody) {
  if (!config.whatsappAppSecret) {
    return true;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const receivedSignature = signatureHeader.slice("sha256=".length);
  const expectedSignature = crypto
    .createHmac("sha256", config.whatsappAppSecret)
    .update(rawBody)
    .digest("hex");

  const received = Buffer.from(receivedSignature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");

  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function shouldProcessMessage(message) {
  if (!message?.id || !message?.from) {
    return false;
  }

  pruneProcessedMessages();
  if (processedMessageIds.has(message.id)) {
    console.log(`Skipping duplicate message ${message.id}`);
    return false;
  }

  processedMessageIds.set(message.id, Date.now());
  return true;
}

function pruneProcessedMessages() {
  const cutoff = Date.now() - processedMessageTtlMs;

  for (const [messageId, timestamp] of processedMessageIds) {
    if (timestamp < cutoff) {
      processedMessageIds.delete(messageId);
    }
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
