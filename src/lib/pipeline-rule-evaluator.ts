/**
 * Shared condition evaluator for pipeline rules (stage rules + assignment rules).
 *
 * Conditions JSONB format:
 *   Simple: { "field": "value" }                         → exact match
 *   Array:  { "field": ["val1", "val2"] }                → any-of (IN)
 *   Object: { "field": { "operator": "gte", "value": 5 } } → comparison
 *   Nested: { "custom_fields.company": "Acme" }          → dot-notation access
 */

type ContactData = Record<string, any>;

function getNestedValue(obj: ContactData, path: string): any {
    const parts = path.split(".");
    let current: any = obj;
    for (const part of parts) {
        if (current == null) return undefined;
        current = current[part];
    }
    return current;
}

function evaluateSingleCondition(contactValue: any, conditionValue: any): boolean {
    // Null/undefined contact value — only matches if condition expects null
    if (contactValue === undefined || contactValue === null) {
        if (conditionValue === null || conditionValue === undefined) return true;
        // Object with "exists" operator
        if (typeof conditionValue === "object" && !Array.isArray(conditionValue) && conditionValue.operator === "exists") {
            return !conditionValue.value;
        }
        return false;
    }

    // Array condition → "any of" (IN check)
    if (Array.isArray(conditionValue)) {
        const normalizedContact = String(contactValue).toLowerCase();
        return conditionValue.some(
            (v: any) => String(v).toLowerCase() === normalizedContact
        );
    }

    // Object condition with operator
    if (typeof conditionValue === "object" && conditionValue !== null && !Array.isArray(conditionValue)) {
        const { operator, value } = conditionValue;
        switch (operator) {
            case "eq":
                return String(contactValue).toLowerCase() === String(value).toLowerCase();
            case "neq":
                return String(contactValue).toLowerCase() !== String(value).toLowerCase();
            case "gt":
                return Number(contactValue) > Number(value);
            case "gte":
                return Number(contactValue) >= Number(value);
            case "lt":
                return Number(contactValue) < Number(value);
            case "lte":
                return Number(contactValue) <= Number(value);
            case "in":
                return Array.isArray(value) && value.some(
                    (v: any) => String(v).toLowerCase() === String(contactValue).toLowerCase()
                );
            case "not_in":
                return !Array.isArray(value) || !value.some(
                    (v: any) => String(v).toLowerCase() === String(contactValue).toLowerCase()
                );
            case "contains":
                return String(contactValue).toLowerCase().includes(String(value).toLowerCase());
            case "exists":
                return value ? (contactValue !== undefined && contactValue !== null) : (contactValue === undefined || contactValue === null);
            default:
                return false;
        }
    }

    // Simple exact match (string comparison, case-insensitive)
    return String(contactValue).toLowerCase() === String(conditionValue).toLowerCase();
}

/**
 * Evaluate all conditions against contact data.
 * All conditions must match (AND logic).
 * Empty conditions = always matches.
 */
export function evaluateConditions(
    contactData: ContactData,
    conditions: Record<string, any>
): boolean {
    if (!conditions || Object.keys(conditions).length === 0) {
        return true;
    }

    for (const [field, conditionValue] of Object.entries(conditions)) {
        const contactValue = getNestedValue(contactData, field);
        if (!evaluateSingleCondition(contactValue, conditionValue)) {
            return false;
        }
    }

    return true;
}
