import "dotenv/config";
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TeamsInfo,
  type TurnContext,
} from "botbuilder";
import express from "express";

const auth = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: process.env.BOT_ID,
  MicrosoftAppPassword: process.env.BOT_PASSWORD,
  MicrosoftAppTenantId: process.env.BOT_TENANT_ID,
  MicrosoftAppType: "SingleTenant",
});
const adapter = new CloudAdapter(auth);

adapter.onTurnError = async (context, error) => {
  console.error(error);
  await context.sendActivity("Error occurred");
};

const app = express();
app.use(express.json());

// Get Microsoft Graph API token
async function getGraphToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.BOT_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.BOT_ID!,
        client_secret: process.env.BOT_PASSWORD!,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  const data = await res.json();
  return data.access_token;
}

// Extract text content from Adaptive Card JSON
function extractCardText(card: any): string {
  const texts: string[] = [];
  function traverse(obj: any) {
    if (!obj) return;
    if (obj.type === "TextBlock" && obj.text) texts.push(obj.text);
    if (obj.type === "FactSet" && obj.facts) {
      for (const fact of obj.facts) {
        if (fact.title && fact.value)
          texts.push(`${fact.title}: ${fact.value}`);
      }
    }
    if (Array.isArray(obj.body)) obj.body.forEach(traverse);
    if (Array.isArray(obj.items)) obj.items.forEach(traverse);
    if (Array.isArray(obj.columns)) {
      obj.columns.forEach((col: any) => col.items?.forEach(traverse));
    }
  }
  traverse(card);
  return texts.join("\n");
}

// Fetch thread history from Microsoft Graph API
async function getThreadHistory(
  teamId: string,
  channelId: string,
  messageId: string,
): Promise<string | null> {
  try {
    const token = await getGraphToken();
    const parentRes = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/${messageId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!parentRes.ok) return null;
    const parent = await parentRes.json();

    const repliesRes = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/${messageId}/replies`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const replies = repliesRes.ok ? await repliesRes.json() : { value: [] };

    const messages = [parent, ...(replies.value || [])];
    return messages
      .map((m: any) => {
        const sender = m.from?.user?.displayName || "User";
        let content = m.body?.content || "";
        // Extract Adaptive Card content if present
        if (m.attachments?.length) {
          for (const att of m.attachments) {
            if (att.contentType === "application/vnd.microsoft.card.adaptive") {
              try {
                const card =
                  typeof att.content === "string"
                    ? JSON.parse(att.content)
                    : att.content;
                const cardText = extractCardText(card);
                if (cardText) content += "\n" + cardText;
              } catch (e) {}
            }
          }
        }
        return `${sender}: ${content}`;
      })
      .join("\n");
  } catch (e) {
    return null;
  }
}

// Strip HTML tags and bot mentions
function cleanMessage(text: string): string {
  return text
    .replace(/<at>.*?<\/at>\s*/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}

app.post("/api/messages", async (req, res) => {
  await adapter.process(req, res, async (context: TurnContext) => {
    if (context.activity.type === "message") {
      let messageText = cleanMessage(context.activity.text || "");

      // Get thread history if in a thread
      const match = context.activity.conversation.id.match(/messageid=(\d+)/);
      if (match) {
        try {
          const teamDetails = await TeamsInfo.getTeamDetails(context);
          const teamId = teamDetails.aadGroupId;
          const channelId = context.activity.channelData?.channel?.id;
          if (teamId && channelId) {
            const history = await getThreadHistory(teamId, channelId, match[1]);
            if (history) {
              messageText = `Thread context:\n${cleanMessage(history)}\n\nUser question: ${messageText}`;
            }
          }
        } catch (e) {}
      }

      const response = await fetch(process.env.ARCHESTRA_PROMPT_A2A_ENDPOINT!, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.ARCHESTRA_PROMPT_A2A_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "message/send",
          params: {
            message: { parts: [{ kind: "text", text: messageText }] },
          },
        }),
      });
      const data = await response.json();
      await context.sendActivity(
        data.result?.parts?.[0]?.text ?? "No response",
      );
    }
  });
});

app.listen(3978, () => console.log("Bot listening on 3978"));
