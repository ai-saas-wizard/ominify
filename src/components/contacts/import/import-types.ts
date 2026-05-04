// Shared types for the Imports wizard.

export type ColumnRole =
    | "phone"
    | "email"
    | "first_name"
    | "last_name"
    | "company"
    | "custom_variable"
    | "skip";

export type StepKey = 1 | 2 | 3 | 4;

export interface FieldDescription {
    text: string;
    /** True once the user has typed in the textarea this session. Drives the
     *  "should we overwrite an existing description on re-import?" decision. */
    dirty: boolean;
}

export interface ImportState {
    step: StepKey;
    /** +1 for next, -1 for back. Used as `custom` for AnimatePresence variants. */
    direction: 1 | -1;
    objectType: "contacts";

    // Upload
    file: File | null;
    fileName: string;
    fileSize: number;
    columns: string[];
    parsedRows: Record<string, string>[];

    // Mapping
    mapping: Record<string, ColumnRole>;
    skipEmpty: Record<string, boolean>;
    fieldDescriptions: Record<string, FieldDescription>;
    dropUnmapped: boolean;

    // Verify preferences
    createList: boolean;
    listName: string;
    listDescription: string;
    selectedTagIds: string[];
    enrollIntoSequenceId: string | null;
    consent: boolean;

    submitting: boolean;
    error: string | null;
}

export type ImportAction =
    | { type: "set_step"; step: StepKey; direction: 1 | -1 }
    | { type: "set_file"; file: File; columns: string[]; rows: Record<string, string>[] }
    | { type: "clear_file" }
    | { type: "set_mapping"; column: string; role: ColumnRole }
    | { type: "init_mapping"; mapping: Record<string, ColumnRole> }
    | { type: "set_skip_empty"; column: string; value: boolean }
    | { type: "set_field_description"; column: string; text: string }
    | { type: "set_drop_unmapped"; value: boolean }
    | { type: "set_create_list"; value: boolean }
    | { type: "set_list_name"; value: string }
    | { type: "set_list_description"; value: string }
    | { type: "set_tag_ids"; value: string[] }
    | { type: "set_enroll_sequence"; value: string | null }
    | { type: "set_consent"; value: boolean }
    | { type: "set_submitting"; value: boolean }
    | { type: "set_error"; value: string | null };

export const initialState: ImportState = {
    step: 1,
    direction: 1,
    objectType: "contacts",
    file: null,
    fileName: "",
    fileSize: 0,
    columns: [],
    parsedRows: [],
    mapping: {},
    skipEmpty: {},
    fieldDescriptions: {},
    dropUnmapped: true,
    createList: true,
    listName: "",
    listDescription: "",
    selectedTagIds: [],
    enrollIntoSequenceId: null,
    consent: false,
    submitting: false,
    error: null,
};
