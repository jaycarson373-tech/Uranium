const MAX_NAME_LENGTH = 24;
const MAX_MESSAGE_LENGTH = 280;

class ChatRateLimitError extends Error {}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function configuration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const salt = process.env.CHAT_RATE_LIMIT_SALT;
  return url && key && salt ? { url, key, salt } : null;
}

function cleanSingleLine(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

async function senderHash(request: Request, salt: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function supabase(
  config: NonNullable<ReturnType<typeof configuration>>,
  path: string,
  options: RequestInit = {},
) {
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    if (text.includes("chat_rate_limited")) throw new ChatRateLimitError();
    throw new Error("Chat storage request failed");
  }
  return text ? JSON.parse(text) : null;
}

export async function GET() {
  const config = configuration();
  if (!config) return json({ error: "Chat is not configured", messages: [] }, 503);

  try {
    const rows = await supabase(
      config,
      "/rest/v1/chat_messages?select=id,name,message,created_at&order=created_at.desc&limit=80",
    ) as Array<{ id: number; name: string; message: string; created_at: string }>;
    return json({ messages: Array.isArray(rows) ? rows.reverse() : [] });
  } catch {
    return json({ error: "Chat is temporarily unavailable", messages: [] }, 502);
  }
}

export async function POST(request: Request) {
  const config = configuration();
  if (!config) return json({ error: "Chat is not configured" }, 503);

  try {
    const body = await request.json();
    const name = cleanSingleLine(body?.name, MAX_NAME_LENGTH);
    const message = cleanSingleLine(body?.message, MAX_MESSAGE_LENGTH);
    if (!name || !message) return json({ error: "Enter a display name and message" }, 400);

    const rows = await supabase(config, "/rest/v1/rpc/post_chat_message", {
      method: "POST",
      body: JSON.stringify({
        p_name: name,
        p_message: message,
        p_sender_hash: await senderHash(request, config.salt),
      }),
    });
    return json({ message: Array.isArray(rows) ? rows[0] : rows }, 201);
  } catch (error) {
    if (error instanceof ChatRateLimitError) {
      return json({ error: "Slow down—wait a few seconds before posting again" }, 429);
    }
    return json({ error: "Message was not sent" }, 400);
  }
}
