"use client";

import {
    createContext,
    useContext,
    useReducer,
    type Dispatch,
    type ReactNode,
} from "react";
import {
    initialState,
    type ImportState,
    type ImportAction,
    type ColumnRole,
} from "./import-types";

function reducer(state: ImportState, action: ImportAction): ImportState {
    switch (action.type) {
        case "set_step":
            return { ...state, step: action.step, direction: action.direction };
        case "set_file":
            return {
                ...state,
                file: action.file,
                fileName: action.file.name,
                fileSize: action.file.size,
                columns: action.columns,
                parsedRows: action.rows,
                // Reset downstream mapping when a new file is uploaded.
                mapping: {},
                skipEmpty: {},
                fieldDescriptions: {},
                error: null,
                listName: defaultListNameFromFile(action.file.name, state.listName),
            };
        case "clear_file":
            return {
                ...state,
                file: null,
                fileName: "",
                fileSize: 0,
                columns: [],
                parsedRows: [],
                mapping: {},
                skipEmpty: {},
                fieldDescriptions: {},
            };
        case "set_mapping": {
            const next = { ...state.mapping, [action.column]: action.role };
            // If the user mapped to skip, auto-set skip-empty to true (no-op semantically).
            return { ...state, mapping: next };
        }
        case "init_mapping":
            return { ...state, mapping: action.mapping };
        case "set_skip_empty":
            return {
                ...state,
                skipEmpty: { ...state.skipEmpty, [action.column]: action.value },
            };
        case "set_field_description":
            return {
                ...state,
                fieldDescriptions: {
                    ...state.fieldDescriptions,
                    [action.column]: { text: action.text, dirty: true },
                },
            };
        case "set_drop_unmapped":
            return { ...state, dropUnmapped: action.value };
        case "set_create_list":
            return { ...state, createList: action.value };
        case "set_list_name":
            return { ...state, listName: action.value };
        case "set_list_description":
            return { ...state, listDescription: action.value };
        case "set_tag_ids":
            return { ...state, selectedTagIds: action.value };
        case "set_enroll_sequence":
            return { ...state, enrollIntoSequenceId: action.value };
        case "set_consent":
            return { ...state, consent: action.value };
        case "set_submitting":
            return { ...state, submitting: action.value };
        case "set_error":
            return { ...state, error: action.value };
        default:
            return state;
    }
}

function defaultListNameFromFile(filename: string, current: string): string {
    if (current.trim()) return current;
    // Strip ext, replace separators with spaces, title-case.
    const base = filename.replace(/\.[^.]+$/, "");
    return base
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const ImportContext = createContext<{
    state: ImportState;
    dispatch: Dispatch<ImportAction>;
} | null>(null);

export function ImportProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(reducer, initialState);
    return (
        <ImportContext.Provider value={{ state, dispatch }}>{children}</ImportContext.Provider>
    );
}

export function useImport() {
    const ctx = useContext(ImportContext);
    if (!ctx) throw new Error("useImport must be used inside ImportProvider");
    return ctx;
}

export type { ColumnRole };
