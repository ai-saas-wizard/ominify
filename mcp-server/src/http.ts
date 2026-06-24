import { config } from "./config.js";

type Query = Record<string, string | number | boolean | null | undefined>;

async function request(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown } = {}
): Promise<any> {
    const url = new URL(path, config.baseUrl);
    if (opts.query) {
        for (const [k, v] of Object.entries(opts.query)) {
            if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
        }
    }

    const res = await fetch(url, {
        method,
        headers: {
            authorization: `Bearer ${config.adminToken}`,
            ...(opts.body ? { "content-type": "application/json" } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    let json: any;
    try {
        json = text ? JSON.parse(text) : {};
    } catch {
        json = { raw: text };
    }

    if (!res.ok) {
        throw new Error(json?.error || `HTTP ${res.status} from ${path}`);
    }
    return json;
}

export const api = {
    get: (path: string, query?: Query) => request("GET", path, { query }),
    post: (path: string, body?: unknown) => request("POST", path, { body }),
    patch: (path: string, body?: unknown) => request("PATCH", path, { body }),
};
