import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { atomicWrite } from "../platform/files";
import type { AppPaths } from "../platform/paths";
import { nativeSkillRoots } from "../providers/configuration";
import type { AppDatabase } from "../storage/database";
import { skillLinks, skills } from "../storage/schema";
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);
export function parseSkill(text: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(text);
  if (!m) throw new Error("SKILL.md requires frontmatter and instructions");
  return z
    .object({
      name: slugSchema,
      description: z.string().trim().min(1).max(1024),
    })
    .parse(parse(m[1] ?? ""));
}
function assertTree(path: string) {
  for (const e of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, e.name);
    if (e.isDirectory()) assertTree(p);
    else if (!e.isFile())
      throw new Error(
        "Skill imports must contain only regular files and directories",
      );
  }
}
export class SkillService {
  constructor(
    private db: AppDatabase,
    private paths: AppPaths,
    private home = homedir(),
  ) {}
  root() {
    return join(this.paths.data, "skills");
  }
  nativeRoot(provider: string) {
    const root = nativeSkillRoots(provider, this.home)[0];
    if (!root) throw new Error("No native skill location");
    return root;
  }

  list() {
    return this.db.select().from(skills).all();
  }
  get(id: string) {
    const s = this.list().find((s) => s.id === id || s.name === id);
    if (!s) throw new Error("Managed skill not found");
    return s;
  }
  file(id: string) {
    const s = this.get(id);
    const file = join(this.root(), s.name, "SKILL.md");
    if (
      !lstatSync(join(this.root(), s.name)).isDirectory() ||
      !lstatSync(file).isFile()
    )
      throw new Error("Managed skill path is not a regular directory/file");
    return file;
  }
  create(name: string, description: string, instructions: string) {
    const text = `---\n${stringify({ name, description })}---\n\n${z.string().trim().min(1).parse(instructions)}\n`;
    parseSkill(text);
    const directory = join(this.root(), name);
    mkdirSync(this.root(), { recursive: true, mode: 0o700 });
    mkdirSync(directory, { mode: 0o700 });
    try {
      atomicWrite(join(directory, "SKILL.md"), text);
      return this.db
        .insert(skills)
        .values({
          id: randomUUID(),
          name,
          description,
          directory: name,
          createdAt: Date.now(),
        })
        .returning()
        .get();
    } catch (e) {
      rmSync(directory, { recursive: true });
      throw e;
    }
  }
  import(path: string) {
    const source = resolve(path);
    if (!lstatSync(source).isDirectory())
      throw new Error("Import a regular skill directory");
    assertTree(source);
    const metadata = parseSkill(readFileSync(join(source, "SKILL.md"), "utf8"));
    const dest = join(this.root(), metadata.name);
    mkdirSync(this.root(), { recursive: true, mode: 0o700 });
    if (existsSync(dest)) throw new Error("Skill directory already exists");
    cpSync(source, dest, { recursive: true, errorOnExist: true, force: false });
    try {
      return this.db
        .insert(skills)
        .values({
          id: randomUUID(),
          ...metadata,
          directory: metadata.name,
          createdAt: Date.now(),
        })
        .returning()
        .get();
    } catch (e) {
      rmSync(dest, { recursive: true });
      throw e;
    }
  }
  sync(id: string) {
    const s = this.get(id);
    const m = parseSkill(readFileSync(this.file(s.id), "utf8"));
    if (m.name !== s.name)
      throw new Error(
        "Skill name must match its managed directory; import under a new name to rename",
      );
    this.db
      .update(skills)
      .set({ description: m.description })
      .where(eq(skills.id, s.id))
      .run();
  }
  links(id: string) {
    return this.db
      .select()
      .from(skillLinks)
      .where(eq(skillLinks.skillId, this.get(id).id))
      .all()
      .map((link) => ({
        ...link,
        status: this.linkState(link.path, link.target),
      }));
  }
  private linkState(path: string, target: string) {
    try {
      if (
        !lstatSync(path).isSymbolicLink() ||
        resolve(dirname(path), readlinkSync(path)) !== target
      )
        return "conflict";
      return existsSync(path) ? "linked" : "broken";
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      throw e;
    }
  }
  install(id: string, provider: string) {
    const s = this.get(id);
    this.sync(s.id);
    const path = join(this.nativeRoot(provider), s.name);
    const target = join(this.root(), s.name);
    const owned = this.db
      .select()
      .from(skillLinks)
      .where(eq(skillLinks.path, path))
      .get();
    if (owned) {
      if (owned.skillId !== s.id || this.linkState(path, target) === "conflict")
        throw new Error("Skill installation was modified externally");
      if (this.linkState(path, target) !== "missing") return;
    } else {
      try {
        lstatSync(path);
        throw new Error(
          "Native skill already exists; refusing to take ownership",
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    symlinkSync(target, path);
    if (!owned)
      this.db
        .insert(skillLinks)
        .values({
          path,
          target,
          skillId: s.id,
          provider: provider === "agy" ? "agy" : "codex,opencode",
        })
        .run();
  }
  uninstall(id: string, provider: string) {
    const s = this.get(id);
    const path = join(this.nativeRoot(provider), s.name);
    const owned = this.db
      .select()
      .from(skillLinks)
      .where(eq(skillLinks.path, path))
      .get();
    if (!owned || owned.skillId !== s.id)
      throw new Error("This link is not managed by Agent OS");
    const state = this.linkState(path, owned.target);
    if (state === "conflict")
      throw new Error("Native link changed externally; nothing removed");
    if (state !== "missing") unlinkSync(path);
    this.db.delete(skillLinks).where(eq(skillLinks.path, path)).run();
  }
  remove(id: string) {
    const s = this.get(id);
    if (this.links(s.id).some((l) => l.status === "conflict"))
      throw new Error(
        "Resolve externally modified skill links before deletion",
      );
    for (const link of this.links(s.id))
      this.uninstall(s.id, link.provider === "agy" ? "agy" : "codex");
    this.file(s.id);
    rmSync(join(this.root(), s.name), { recursive: true });
    this.db.delete(skills).where(eq(skills.id, s.id)).run();
  }
  discover(provider: string) {
    const roots = nativeSkillRoots(provider, this.home);
    return roots.flatMap((root) =>
      existsSync(root)
        ? readdirSync(root).flatMap((name) => {
            const file = join(root, name, "SKILL.md");
            try {
              return [
                { ...parseSkill(readFileSync(file, "utf8")), path: file },
              ];
            } catch {
              return [];
            }
          })
        : [],
    );
  }
}
