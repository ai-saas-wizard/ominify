import "server-only";
import OpenAI from 'openai';

/**
 * Extract contact information (name and email) from a call transcript using OpenAI.
 * Used as a fallback when VAPI's built-in extraction doesn't capture this data.
 * 
 * @param transcript - The full call transcript text
 * @returns Object with extracted name and email (null if not found)
 */
export async function extractContactInfo(transcript: string): Promise<{
    name: string | null;
    email: string | null;
}> {
    // Skip if transcript is too short or empty
    if (!transcript || transcript.length < 50) {
        return { name: null, email: null };
    }

    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 5000 // 5 second timeout to stay within webhook limits
        });

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            max_tokens: 100,
            temperature: 0,
            messages: [
                {
                    role: 'system',
                    content: `You are extracting caller information from a phone call transcript.
Extract the caller's name and email address if they provided them during the call.
Return a JSON object with exactly this format:
{"name": "string or null", "email": "string or null"}

Rules:
- Only extract information the caller explicitly stated about themselves
- Do not extract agent/business names
- Email must be a valid email format
- Name should be the caller's full name if available
- Return null for any field not clearly stated by the caller`
                },
                {
                    role: 'user',
                    content: `Extract caller name and email from this transcript:\n\n${transcript.slice(0, 4000)}`
                }
            ]
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            return { name: null, email: null };
        }

        const parsed = JSON.parse(content);

        // Validate email format if present
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const validEmail = parsed.email && emailRegex.test(parsed.email) ? parsed.email : null;

        return {
            name: parsed.name && typeof parsed.name === 'string' ? parsed.name : null,
            email: validEmail
        };
    } catch (error) {
        console.error('[OpenAI Extractor] Error extracting contact info:', error);
        return { name: null, email: null };
    }
}
