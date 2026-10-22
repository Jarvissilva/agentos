import type { Dispatch, SetStateAction } from "react";
import type { Application, SessionLauncher, TerminalHandoff } from "../../app";
import type { ProviderId, ProviderInfo } from "../../lib/providers/types";

export interface PaletteItem {
  name: string;
  description: string;
}

export interface HintItem {
  key: string;
  label: string;
}

export interface ListRowData {
  id: string;
  name: string;
  meta?: string;
  description?: string;
  glyph?: string;
  glyphColor?: string;
}

export interface FormField {
  label: string;
  value: string;
  multiline?: boolean;
}

export interface FormSpec {
  title: string;
  subtitle?: string;
  fields: FormField[];
  save: (values: string[]) => void | Promise<void>;
}

export type SectionKey =
  | "sessions"
  | "projects"
  | "agents"
  | "skills"
  | "mcps"
  | "providers"
  | "automations"
  | "runs"
  | "notifications"
  | "settings";

export type View =
  | { kind: "home" }
  | { kind: "section"; section: SectionKey }
  | { kind: "detail"; section: SectionKey; id: string };

export interface Row extends ListRowData {
  body: () => string;
}

export interface Command {
  name: string;
  description: string;
  group: "context" | "create" | "navigate" | "system";
  run: () => void;
}

export interface PickerOption extends PaletteItem {
  id: string;
}

export interface Picker {
  options?: PickerOption[];
  interactiveOnly?: boolean;
  title: string;
  action: (provider: string) => void;
}

export interface Wizard {
  step: "project" | "directory" | "agent" | "provider";
  cwd?: string;
  projectId?: string;
  agentId?: string;
}

export interface WizardOption {
  id: string;
  name: string;
  meta?: string;
  description?: string;
  glyph?: string;
  choose: () => void;
}

export interface GroupFilter {
  id: string;
  name: string;
}
export interface ResourceFilter {
  /** `null` represents the unfiltered "All" choice. */
  id: string | null;
  name: string;
}
export interface RunFilter {
  automationId: string;
  name: string;
}
export interface Report {
  title: string;
  body: string;
}
export interface Confirmation {
  message: string;
  action: () => void;
}
export interface ResourceContext {
  app: Application;
  providers: ProviderInfo[];
  preferredProvider: ProviderId | undefined;
  setPreferredProvider: Dispatch<SetStateAction<ProviderId | undefined>>;
  defaultDirectory: string | undefined;
  projectFilter: GroupFilter | null;
  runFilter: RunFilter | null;
  setView: Dispatch<SetStateAction<View>>;
  setSelected: Dispatch<SetStateAction<number>>;
  setForm: Dispatch<SetStateAction<FormSpec | null>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setConfirm: Dispatch<SetStateAction<Confirmation | null>>;
  setReport: Dispatch<SetStateAction<Report | null>>;
  setRunFilter: Dispatch<SetStateAction<RunFilter | null>>;
  setProjectFilter: Dispatch<SetStateAction<GroupFilter | null>>;
  setDefaultDirectory: Dispatch<SetStateAction<string | undefined>>;
  setHomeDirectory: Dispatch<SetStateAction<string>>;
  refresh: () => void;
  fail: (error: unknown) => void;
  perform: (run: () => Promise<unknown>) => Promise<void>;
  handoff: TerminalHandoff;
  sessionLauncher?: SessionLauncher;
  activateSession?: (id: string) => boolean;
  openForm: (spec: FormSpec) => void;
  openPicker: (
    title: string,
    action: (provider: string) => void,
    interactiveOnly?: boolean,
  ) => void;
  openSection: (section: SectionKey, group?: GroupFilter) => void;
  configureProviderDefaults: (provider: ProviderId) => void;
  selectDefaultProvider: () => void;
  startSession: () => void;
}
export interface ResourceView {
  navigation: Command;
  copy: {
    title: string;
    noun: string;
    glyph: string;
    empty: string;
    hint: string;
  };
  rows: Row[];
  commands: (row: Row) => Command[];
  sectionCommands: Command[];
  creation?: Command;
  open?: (row: Row) => boolean;
  /** Horizontal filter strip shown above the list, selected with left/right. */
  filters?: ResourceFilter[];
  filterIndex?: number;
  selectFilter?: (index: number) => void;
}
