import { GoogleGenAI } from "@google/genai";

export const config = {
  maxDuration: 120,
};

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, imageBase64, refImageBase64, model, aspectRatio, promptMode } = req.body;

    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI API_KEY not configured' });
    }

    const ai = new GoogleGenAI({ apiKey });

    // Clean base64 (remove data:image/... prefix if present)
    const cleanBase64 = (b64: string) => b64.includes(',') ? b64.split(',')[1] : b64;
    const getMimeType = (b64: string) => b64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';

    const selectedModel = model || 'gemini-2.5-flash-preview-05-20';
    const mimeType = getMimeType(imageBase64);
    const cleanedImage = cleanBase64(imageBase64);

    // Build aspect ratio config
    let apiAspectRatio = '9:16';
    if (aspectRatio === '16:9') apiAspectRatio = '16:9';
    if (aspectRatio === '9:16') apiAspectRatio = '9:16';
    if (aspectRatio === '3:2') apiAspectRatio = '4:3';
    if (aspectRatio === '2:3') apiAspectRatio = '3:4';

    // Build prompt
    let finalPrompt = prompt;
    if (promptMode === 'wrapped') {
      finalPrompt = `Edit the provided photo.
Rules:
- Detect ALL people in the photo and keep the SAME number of people.
- Preserve each person's identity (face, skin tone, age, gender, expression).
- Do not remove, merge, replace, or add any person.
Instruction: ${prompt}`;
    }

    // Build parts
    const parts: any[] = [
      { inlineData: { data: cleanedImage, mimeType: mimeType } }
    ];

    // Add reference image if provided
    if (refImageBase64 && refImageBase64.trim() !== '') {
      console.log("[Gemini API] Adding Reference Image");
      const refClean = cleanBase64(refImageBase64);
      parts.push({ inlineData: { data: refClean, mimeType: 'image/png' } });
      finalPrompt += `\n\n[IMPORTANT]: The SECOND image provided is a VISUAL REFERENCE for the style, background, or clothing. Combine the person from the FIRST image with the style/aesthetics of the SECOND image.`;
    }

    parts.push({ text: finalPrompt });

    const usePro = selectedModel.includes('pro') || selectedModel === 'gemini-3-pro-image-preview';
    const imageConfig: any = { aspectRatio: apiAspectRatio };
    if (usePro) imageConfig.imageSize = '1K';

    const geminiModel = usePro ? 'gemini-2.0-flash-exp-image-generation' : 'gemini-2.0-flash-exp-image-generation';

    console.log(`[Gemini API] Generating with model: ${geminiModel}, aspectRatio: ${apiAspectRatio}`);

    const response = await ai.models.generateContent({
      model: geminiModel,
      contents: { parts: parts },
      config: { 
        responseModalities: ['Text', 'Image'],
      }
    });

    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      const candidate = candidates[0];
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData) {
            const mt = part.inlineData.mimeType || 'image/png';
            return res.status(200).json({
              imageBase64: `data:${mt};base64,${part.inlineData.data}`,
              provider: 'gemini'
            });
          }
        }
        // Check for text response (rejection)
        for (const part of candidate.content.parts) {
          if (part.text) {
            console.warn("[Gemini API] Text response:", part.text);
            return res.status(400).json({ error: `AI refused: ${part.text}` });
          }
        }
      }
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        return res.status(400).json({ error: `Generation blocked: ${candidate.finishReason}` });
      }
    }

    return res.status(500).json({ error: 'No image data returned from Gemini' });

  } catch (error: any) {
    console.error("[Gemini API] Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
