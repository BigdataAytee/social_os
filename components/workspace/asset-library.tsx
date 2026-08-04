"use client";

import { useMemo, useState, useTransition } from "react";
import {
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import {
  createAssetAction,
  createFolderAction,
  deleteAssetAction,
} from "@/app/actions/workspace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Asset library (Phase 6).
 *
 * Storage is Supabase Storage in deployment; this screen records assets by URL
 * so the library, folders, tags and search all work before a bucket exists.
 */

export type AssetRow = {
  id: string;
  name: string;
  type: string;
  url: string;
  tags: string[];
  folderId: string | null;
  folderName: string | null;
};

export type FolderRow = { id: string; name: string; count: number };

const TYPE_ICONS: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  document: FileText,
  "brand-asset": Sparkles,
};

export function AssetLibrary({
  assets,
  folders,
  tags,
  canUpload,
}: {
  assets: AssetRow[];
  folders: FolderRow[];
  tags: string[];
  canUpload: boolean;
}) {
  const [items, setItems] = useState(assets);
  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState<string | "ALL">("ALL");
  const [tag, setTag] = useState<string | "ALL">("ALL");
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (a) =>
        (folderId === "ALL" || a.folderId === folderId) &&
        (tag === "ALL" || a.tags.includes(tag)) &&
        (q === "" ||
          a.name.toLowerCase().includes(q) ||
          a.tags.some((t) => t.includes(q)))
    );
  }, [items, query, folderId, tag]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets and tags…"
            className="pl-8"
          />
        </div>

        <Select value={folderId} onValueChange={(v) => setFolderId(v)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All folders</SelectItem>
            {folders.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name} ({f.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={tag} onValueChange={(v) => setTag(v)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All tags</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canUpload && (
          <>
            <NewFolderDialog />
            <NewAssetDialog
              folders={folders}
              onCreated={(asset) => setItems((prev) => [asset, ...prev])}
            />
          </>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={items.length === 0 ? "No assets yet" : "Nothing matches those filters"}
          description={
            items.length === 0
              ? "Add the brand files and campaign media your Studios reach for."
              : "Try a different folder, tag or search term."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((asset) => {
            const Icon = TYPE_ICONS[asset.type] ?? FileText;
            return (
              <div
                key={asset.id}
                className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised">
                    <Icon className="h-4 w-4 text-secondary" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm text-primary">
                      {asset.name}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                      {asset.type}
                      {asset.folderName ? ` · ${asset.folderName}` : ""}
                    </span>
                  </div>
                  {canUpload && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${asset.name}`}
                      disabled={pending}
                      className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={() => {
                        setItems((prev) => prev.filter((a) => a.id !== asset.id));
                        startTransition(async () => {
                          const result = await deleteAssetAction(asset.id);
                          if (!result.ok) toast.error(result.error);
                          else toast.success("Asset removed");
                        });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted" />
                    </Button>
                  )}
                </div>

                {asset.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {asset.tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTag(t)}
                        className={cn(
                          "rounded-sm border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:text-secondary"
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewFolderDialog() {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <FolderOpen />
          New folder
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="folder-name">Name</Label>
          <Input
            id="folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Q1 Campaign"
          />
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await createFolderAction({ name: name.trim() });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Folder created");
                setName("");
                setOpen(false);
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewAssetDialog({
  folders,
  onCreated,
}: {
  folders: FolderRow[];
  onCreated: (asset: AssetRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState("image");
  const [folderId, setFolderId] = useState("none");
  const [tags, setTags] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          Add asset
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add asset</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-name">Name</Label>
            <Input
              id="asset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Workshop promo — carousel base"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-url">URL</Label>
            <Input
              id="asset-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="asset-type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="asset-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Image</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="document">Document</SelectItem>
                  <SelectItem value="brand-asset">Brand asset</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="asset-folder">Folder</Label>
              <Select value={folderId} onValueChange={setFolderId}>
                <SelectTrigger id="asset-folder">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No folder</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-tags">Tags</Label>
            <Input
              id="asset-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="carousel, instagram, workshop"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={pending || !name.trim() || !url.trim()}
            onClick={() =>
              startTransition(async () => {
                const parsedTags = tags
                  .split(",")
                  .map((t) => t.trim().toLowerCase())
                  .filter(Boolean);

                const result = await createAssetAction({
                  name: name.trim(),
                  url: url.trim(),
                  type: type as AssetRow["type"] as never,
                  folderId: folderId === "none" ? null : folderId,
                  tags: parsedTags,
                });

                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }

                onCreated({
                  id: result.data.id,
                  name: name.trim(),
                  url: url.trim(),
                  type,
                  tags: parsedTags,
                  folderId: folderId === "none" ? null : folderId,
                  folderName:
                    folders.find((f) => f.id === folderId)?.name ?? null,
                });

                toast.success("Asset added");
                setName("");
                setUrl("");
                setTags("");
                setOpen(false);
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
