async function verifyUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) return null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("AUTH_NOT_CONFIGURED");
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) return null;

  return await response.json();
}

const SYSTEM_PROMPT =
  "You are CLARIO, a friendly AI assistant built by ZELQORA Technologies. " +
  "Your name is CLARIO and your maker is ZELQORA Technologies. " +
  "If anyone asks who made you, who built you, or which company you belong to, answer that you are CLARIO, built by ZELQORA Technologies. " +
  "Never say you were made by any other company or person. " +
  "If someone asks which AI model runs behind you, say you are not sure about the technical details. " +
  "Talk like a smart, warm friend having a normal conversation. " +
  "Write in plain, natural sentences and short paragraphs. " +
  "Never use markdown: no asterisks for bold or italics, no # headings, no tables, no horizontal lines. " +
  "If you need to give steps, write them as plain sentences or simple numbers like 1. 2. 3. only when really needed. " +
  "Keep replies as short as the question deserves. Do not over-explain, do not open with filler like Certainly or Great question, and do not end with a long summary or a list of offers. " +
  "Match the user's tone and language. " +
  "Be honest: if you do not know something, say so. " +
  "If someone sincerely asks whether you are an AI, tell them the truth. " +
  "When the user needs code, put it inside a code block with triple backticks and keep the explanation short and plain.";

const IDENTITY_REMINDER =
  "Reminder: you are CLARIO, built by ZELQORA Technologies, and you never name any other company as your maker.";

const STYLE_BY_MODE = {
  code:
    "The user is on the Code Assistant page. Act like a senior software engineer. Give complete, working code inside code blocks, then explain briefly what it does and how to run or use it. Mention pitfalls only when they really matter. If the request is too vague to build, ask one short question first.",
  research:
    "The user is on the Research page. Give accurate, well organised answers. Separate what is well established from what is uncertain, and say plainly when you are not sure. Never invent sources, statistics or quotes. Suggest what the user could look up to double check important claims.",
  learn:
    "The user is on the Learn page. Act like a patient teacher. Start from the basics, use one simple everyday example, then build up step by step. End with one short question to check understanding.",
  documents:
    "The user attached a document. Base your answer on the document content. If something is not in the document, say so instead of guessing. Be specific and refer to the relevant parts briefly.",
  voice:
    "The user is talking to you by voice and your reply will be read aloud. Answer in one to three short, easy to say sentences. No lists and no code."
};

// Safety net: removes markdown symbols the model may still add (code blocks are left alone)
function cleanReply(text) {
  return String(text)
    .split(/(```[\s\S]*?```)/g)
    .map(part => {
      if (part.startsWith("```")) return part;
      return part
        .replace(/^#{1,6}\s*/gm, "")
        .replace(/\*\*(.+?)\*\*/gs, "$1")
        .replace(/__(.+?)__/gs, "$1")
        .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, "$1$2")
        .replace(/^\s*[*\u2022]\s+/gm, "- ")
        .replace(/^\s*([-*_]){3,}\s*$/gm, "")
        .replace(/\n{3,}/g, "\n\n");
    })
    .join("")
    .trim();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // Only logged-in users may chat
    let user;
    try {
      user = await verifyUser(req);
    } catch (authError) {
      console.error("CLARIO auth config error:", authError);
      return res.status(500).json({
        error: "Login check is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel."
      });
    }

    if (!user || !user.id) {
      return res.status(401).json({
        error: "Please log in to chat."
      });
    }

    const { message, history = [], stream: wantsStream = false, mode = "chat" } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.CLARIO_MODEL;

    if (!apiKey || !model) {
      return res.status(500).json({
        error: "CLARIO AI is not configured yet."
      });
    }

    // Only allow real user/assistant messages from the browser
    const safeHistory = Array.isArray(history)
      ? history
          .filter(
            m =>
              m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string"
          )
          .slice(-10)
          .map(m => ({
            role: m.role,
            content: m.content.slice(0, 8000)
          }))
      : [];

    const styleText =
      typeof mode === "string" && Object.prototype.hasOwnProperty.call(STYLE_BY_MODE, mode)
        ? " " + STYLE_BY_MODE[mode]
        : "";
    const systemPrompt = SYSTEM_PROMPT + styleText + " " + IDENTITY_REMINDER;

    const messages = [
      {
        role: "system",
        content: systemPrompt
      },
      ...safeHistory,
      {
        role: "user",
        // Large enough for message + up to 30,000 characters of PDF text
        content: message.slice(0, 35000)
      }
    ];

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          stream: wantsStream === true
        })
      }
    );

    // Streaming: send the reply to the browser piece by piece
    if (wantsStream === true) {
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error("CLARIO provider error:", response.status, errorText);
        return res.status(502).json({ error: "AI provider request failed." });
      }

      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no"
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;

            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;

            try {
              const json = JSON.parse(payload);
              const piece = json.choices?.[0]?.delta?.content;
              if (piece) res.write(piece);
            } catch (parseError) {}
          }
        }
      } catch (streamError) {
        console.error("CLARIO stream error:", streamError);
      }

      return res.end();
    }

    const data = await response.json();

    if (!response.ok) {
      console.error("CLARIO provider error:", response.status, JSON.stringify(data));
      return res.status(502).json({
        error: "AI provider request failed."
      });
    }

    return res.status(200).json({
      reply: cleanReply(data.choices?.[0]?.message?.content || "No response received.")
    });

  } catch (error) {
    console.error("CLARIO chat error:", error);
    return res.status(500).json({
      error: "Something went wrong."
    });
  }
};





