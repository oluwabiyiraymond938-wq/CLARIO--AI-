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

    const { message, history = [] } = req.body || {};

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

    const messages = [
      {
        role: "system",
        content: "You are CLARIO, an intelligent AI assistant created by ZELQORA Technologies. Be helpful, accurate and friendly."
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
          temperature: 0.7
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("CLARIO provider error:", response.status, JSON.stringify(data));
      return res.status(502).json({
        error: "AI provider request failed."
      });
    }

    return res.status(200).json({
      reply: data.choices?.[0]?.message?.content || "No response received."
    });

  } catch (error) {
    console.error("CLARIO chat error:", error);
    return res.status(500).json({
      error: "Something went wrong."
    });
  }
};

