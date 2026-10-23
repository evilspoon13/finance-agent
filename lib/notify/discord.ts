/**
 * Post a message to a Discord channel webhook. Discord caps message content at
 * 2,000 characters, so long bodies are cut at a line break with a pointer to
 * the full text.
 */

const LIMIT = 2000;

export function formatDiscordMessage(title: string, body: string, link: string): string {
  const head = `**${title}**\n`;
  const tail = `\n\n[Continue in Claude →](<${link}>)`;
  const room = LIMIT - head.length - tail.length;
  let text = body.trim();
  if (text.length > room) {
    const marker = "\n…(full briefing in the app)";
    const cut = text.slice(0, room - marker.length);
    const lineEnd = cut.lastIndexOf("\n");
    text = (lineEnd > room / 2 ? cut.slice(0, lineEnd) : cut) + marker;
  }
  return head + text + tail;
}

/** Returns true when Discord accepted the message. Never throws. */
export async function postToDiscord(webhookUrl: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // allowed_mentions: none — the agent's text can't ping @everyone.
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) console.error(`discord webhook: ${res.status} ${await res.text()}`);
    return res.ok;
  } catch (err) {
    console.error("discord webhook:", err instanceof Error ? err.message : err);
    return false;
  }
}
