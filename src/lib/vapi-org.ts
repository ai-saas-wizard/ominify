import { VapiAgent } from './vapi';

const VAPI_BASE_URL = 'https://api.vapi.ai';

/**
 * Fetch the Vapi organization ID from an API key
 * The org ID is included in agent responses
 */
export async function getVapiOrgId(apiKey: string): Promise<string | null> {
    try {
        const res = await fetch(`${VAPI_BASE_URL}/assistant?limit=1`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            }
        });

        if (!res.ok) return null;

        const agents = await res.json();
        if (agents && agents.length > 0 && agents[0].orgId) {
            return agents[0].orgId;
        }

        // Try phone numbers if no agents
        const phoneRes = await fetch(`${VAPI_BASE_URL}/phone-number?limit=1`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            }
        });

        if (phoneRes.ok) {
            const phones = await phoneRes.json();
            if (phones && phones.length > 0 && phones[0].orgId) {
                return phones[0].orgId;
            }
        }

        return null;
    } catch (error) {
        console.error('Error fetching Vapi org ID:', error);
        return null;
    }
}
