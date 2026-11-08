// 🎛️ Available models, selected with the numeric "model" field of the request.
// A request without "model" uses 1 (FLUX.1 schnell, steps 6): same behaviour as
// before the switch existed, so old clients keep working unchanged.
// Each entry knows how to build its input; the output is normalised in toBytes().
// Deprecated models (Workers AI, 2026-11-20) are left out: SDXL base/lightning,
// dreamshaper-8-lcm, SD 1.5 inpainting. SD 1.5 img2img needs an input image.
// Input/output shapes per model page, developers.cloudflare.com/workers-ai/models (2026-11-08).
const MODELS = {
    // FLUX.1 schnell: JSON input, returns { image: "<base64>" }. steps: max 8.
    1: {
        id: "@cf/black-forest-labs/flux-1-schnell",
        input: async (prompt) => ({ prompt, steps: 6 }),
    },
    // FLUX.2 family: multipart input, returns { image: "<base64>" }.
    2: { id: "@cf/black-forest-labs/flux-2-klein-9b", input: multipartInput },
    3: { id: "@cf/black-forest-labs/flux-2-klein-4b", input: multipartInput },
    4: { id: "@cf/black-forest-labs/flux-2-dev", input: multipartInput },
    // Leonardo Lucid Origin: JSON input, returns { image: "<base64>" }.
    5: {
        id: "@cf/leonardo/lucid-origin",
        input: async (prompt) => ({ prompt }),
    },
    // Leonardo Phoenix 1.0: JSON input, returns a stream with the image bytes.
    6: {
        id: "@cf/leonardo/phoenix-1.0",
        input: async (prompt) => ({ prompt }),
    },
};

async function multipartInput(prompt) {
    const form = new FormData();
    form.append("prompt", prompt);
    const formResponse = new Response(form);
    return {
        multipart: {
            body: formResponse.body,
            contentType: formResponse.headers.get("content-type"),
        },
    };
}

const DEFAULT_MODEL = 1;

export default {
    async fetch(request, env) {
        const API_KEY = env.API_KEY;
        const url = new URL(request.url);
        const auth = request.headers.get("Authorization");

        // 🔐 Simple API key check
        if (auth !== `Bearer ${API_KEY}`) {
            return json({ error: "Unauthorized" }, 401);
        }

        // 🚫 Only allow POST requests to /
        if (request.method !== "POST" || url.pathname !== "/") {
            return json({ error: "Not allowed" }, 405);
        }

        try {
            const { prompt, model = DEFAULT_MODEL } = await request.json();

            if (!prompt) return json({ error: "Prompt is required" }, 400);

            const selected = MODELS[model];
            if (!selected) {
                return json({ error: "Unknown model", available: Object.keys(MODELS).map(Number) }, 400);
            }

            // 🧠 Generate image from prompt
            const result = await env.AI.run(selected.id, await selected.input(prompt));
            const bytes = await toBytes(result);

            return new Response(bytes, {
                headers: { "Content-Type": imageType(bytes), "X-Model": selected.id },
            });
        } catch (err) {
            return json({ error: "Failed to generate image", details: err.message }, 500);
        }
    },
};

// 🖼️ Models answer either { image: "<base64>" } or raw bytes/stream.
async function toBytes(result) {
    if (result && typeof result.image === "string") {
        return Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0));
    }
    return new Uint8Array(await new Response(result).arrayBuffer());
}

// 🏷️ Not every model returns JPEG: read the magic bytes. Defaults to JPEG, as before.
function imageType(bytes) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
    return "image/jpeg";
}

// 📦 Function to return JSON responses
function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
