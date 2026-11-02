
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
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

    const messages = [
      {
        role: "system",
        content: "You are CLARIO, an intelligent AI assistant created by ZELQORA Technologies. Be helpful, accurate and friendly."
      },
      ...history.slice(-10),
      {
        role: "user",
        content: message.slice(0, 8000)
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
      return res.status(502).json({
        error: "AI provider request failed."
      });
    }

    return res.status(200).json({
      reply: data.choices?.[0]?.message?.content || "No response received."
    });

  } catch (error) {
    return res.status(500).json({
      error: "Something went wrong."
    });
  }
};
