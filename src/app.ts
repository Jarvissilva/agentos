import type { AppPaths } from "./lib/platform/paths";
import { ProviderManager } from "./lib/providers/manager";
import type { AppDatabase } from "./lib/storage/database";
import { providerMetadata } from "./lib/storage/schema";
import { AgentService } from "./modules/agents/service";
import { AutomationService } from "./modules/automations/service";
import { McpService } from "./modules/mcps/service";
import { NotificationService } from "./modules/notifications/service";
import { ProjectService } from "./modules/projects/service";
import { SessionService } from "./modules/sessions/service";
import { SettingsService } from "./modules/settings/service";
import { SkillService } from "./modules/skills/service";

export { directory } from "./lib/platform/paths";
export type { Session } from "./lib/storage/schema";
export { parseAgent } from "./modules/agents/definition";
export type {
  SessionLauncher,
  TerminalHandoff,
} from "./modules/sessions/service";

export class Application {
  readonly skills: SkillService;
  readonly mcps: McpService;
  readonly automations: AutomationService;
  private readonly settings: SettingsService;
  private readonly projects: ProjectService;
  private readonly agents: AgentService;
  private readonly notifications: NotificationService;
  private readonly sessions: SessionService;

  constructor(
    readonly db: AppDatabase,
    readonly paths: AppPaths,
    readonly providers = new ProviderManager(),
  ) {
    this.settings = new SettingsService(paths, providers, (provider, cwd) =>
      this.modelCatalog(provider, cwd),
    );
    this.projects = new ProjectService(db);
    this.agents = new AgentService(db, paths);
    this.notifications = new NotificationService(db);
    this.sessions = new SessionService(
      db,
      providers,
      this.projects,
      this.agents,
      this.settings,
      this.notifications,
    );
    this.skills = new SkillService(db, paths);
    this.mcps = new McpService(db);
    this.automations = new AutomationService(
      db,
      paths,
      providers,
      this.projects,
      this.agents,
      this.notifications,
    );
  }
  async detectProviders() {
    const list = await this.providers.list();
    for (const p of list)
      this.db
        .insert(providerMetadata)
        .values({
          id: p.id,
          metadata: JSON.stringify(p),
          checkedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: providerMetadata.id,
          set: { metadata: JSON.stringify(p), checkedAt: Date.now() },
        })
        .run();
    return list;
  }

  providerDefaults(...args: Parameters<SettingsService["providerDefaults"]>) {
    return this.settings.providerDefaults(...args);
  }
  modelCatalog(...args: Parameters<SettingsService["modelCatalog"]>) {
    return this.settings.modelCatalog(...args);
  }
  validateProviderDefaults(
    ...args: Parameters<SettingsService["validateProviderDefaults"]>
  ) {
    return this.settings.validateProviderDefaults(...args);
  }
  setProviderDefaults(
    ...args: Parameters<SettingsService["setProviderDefaults"]>
  ) {
    return this.settings.setProviderDefaults(...args);
  }
  preferredProvider(...args: Parameters<SettingsService["preferredProvider"]>) {
    return this.settings.preferredProvider(...args);
  }
  setPreferredProvider(
    ...args: Parameters<SettingsService["setPreferredProvider"]>
  ) {
    return this.settings.setPreferredProvider(...args);
  }
  defaultDirectory(...args: Parameters<SettingsService["defaultDirectory"]>) {
    return this.settings.defaultDirectory(...args);
  }
  setDefaultDirectory(
    ...args: Parameters<SettingsService["setDefaultDirectory"]>
  ) {
    return this.settings.setDefaultDirectory(...args);
  }
  listNotifications(
    ...args: Parameters<NotificationService["listNotifications"]>
  ) {
    return this.notifications.listNotifications(...args);
  }
  readNotification(
    ...args: Parameters<NotificationService["readNotification"]>
  ) {
    return this.notifications.readNotification(...args);
  }
  removeAgent(...args: Parameters<AgentService["removeAgent"]>) {
    return this.agents.removeAgent(...args);
  }
  listAgents(...args: Parameters<AgentService["listAgents"]>) {
    return this.agents.listAgents(...args);
  }
  agent(...args: Parameters<AgentService["agent"]>) {
    return this.agents.agent(...args);
  }
  agentFile(...args: Parameters<AgentService["agentFile"]>) {
    return this.agents.agentFile(...args);
  }
  agentDefinition(...args: Parameters<AgentService["agentDefinition"]>) {
    return this.agents.agentDefinition(...args);
  }
  createAgent(...args: Parameters<AgentService["createAgent"]>) {
    return this.agents.createAgent(...args);
  }
  syncAgent(...args: Parameters<AgentService["syncAgent"]>) {
    return this.agents.syncAgent(...args);
  }
  listProjects(...args: Parameters<ProjectService["listProjects"]>) {
    return this.projects.listProjects(...args);
  }
  project(...args: Parameters<ProjectService["project"]>) {
    return this.projects.project(...args);
  }
  createProject(...args: Parameters<ProjectService["createProject"]>) {
    return this.projects.createProject(...args);
  }
  updateProject(...args: Parameters<ProjectService["updateProject"]>) {
    return this.projects.updateProject(...args);
  }
  removeProject(...args: Parameters<ProjectService["removeProject"]>) {
    return this.projects.removeProject(...args);
  }
  instructionFile(...args: Parameters<SessionService["instructionFile"]>) {
    return this.sessions.instructionFile(...args);
  }
  readInstructions(...args: Parameters<SessionService["readInstructions"]>) {
    return this.sessions.readInstructions(...args);
  }
  saveInstructions(...args: Parameters<SessionService["saveInstructions"]>) {
    return this.sessions.saveInstructions(...args);
  }
  recoverSessions(...args: Parameters<SessionService["recoverSessions"]>) {
    return this.sessions.recoverSessions(...args);
  }
  listSessions(...args: Parameters<SessionService["listSessions"]>) {
    return this.sessions.listSessions(...args);
  }
  onSessionsChanged(...args: Parameters<SessionService["onSessionsChanged"]>) {
    return this.sessions.onSessionsChanged(...args);
  }
  renameSession(...args: Parameters<SessionService["renameSession"]>) {
    return this.sessions.renameSession(...args);
  }
  syncSessionName(...args: Parameters<SessionService["syncSessionName"]>) {
    return this.sessions.syncSessionName(...args);
  }
  syncSessionNames(...args: Parameters<SessionService["syncSessionNames"]>) {
    return this.sessions.syncSessionNames(...args);
  }
  assignSessionProject(
    ...args: Parameters<SessionService["assignSessionProject"]>
  ) {
    return this.sessions.assignSessionProject(...args);
  }
  session(...args: Parameters<SessionService["session"]>) {
    return this.sessions.session(...args);
  }
  newSession(...args: Parameters<SessionService["newSession"]>) {
    return this.sessions.newSession(...args);
  }
  settleInteractiveSessions(
    ...args: Parameters<SessionService["settleInteractiveSessions"]>
  ) {
    return this.sessions.settleInteractiveSessions(...args);
  }
  resumeSession(...args: Parameters<SessionService["resumeSession"]>) {
    return this.sessions.resumeSession(...args);
  }
  history(...args: Parameters<SessionService["history"]>) {
    return this.sessions.history(...args);
  }
}
