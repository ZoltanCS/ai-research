"use client";

import { useState, useRef, useCallback } from "react";
import {
  Pencil,
  Trash2,
  Plus,
  Download,
  Upload,
  Copy,
  Check,
  Loader2,
  X,
} from "lucide-react";
import { useStore, type Personality } from "@/store";
import { generatePersonalityPrompt } from "@/lib/api";
import { toast } from "sonner";

// ── Constants ─────────────────────────────────────────────────────────────────

const EMOJI_GRID = [
  "🧠", "🔬", "💻", "✍️", "📚", "😈", "🎯", "🚀",
  "🎨", "🤖", "👨‍💼", "🧪", "📊", "🌍", "⚡", "🦊",
  "🐉", "💡", "🔮", "🎭",
];

const TAG_SUGGESTIONS = [
  "formal", "casual", "technical", "concise", "thorough",
  "creative", "academic", "code", "research", "friendly",
  "professional", "philosophical",
];

function generateId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeBlankPersonality(): Personality {
  return {
    id: generateId(),
    name: "",
    description: "",
    avatar: "🎯",
    systemPrompt: "",
    tags: [],
    isDefault: false,
    createdAt: new Date().toISOString(),
  };
}

// ── Tag input ─────────────────────────────────────────────────────────────────

function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (!t || tags.includes(t)) return;
    onChange([...tags, t]);
    setInputValue("");
  };

  const removeTag = (tag: string) => onChange(tags.filter((t) => t !== tag));

  const filtered = TAG_SUGGESTIONS.filter(
    (s) => s.includes(inputValue.toLowerCase()) && !tags.includes(s)
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[32px]">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-950/60 text-blue-300 text-xs rounded-full border border-blue-800/50"
          >
            {tag}
            <button
              onClick={() => removeTag(tag)}
              className="hover:text-blue-100 transition-colors"
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag(inputValue);
            }
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="Type a tag and press Enter or comma…"
          className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        {showSuggestions && filtered.length > 0 && (
          <div className="absolute z-10 top-full mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg overflow-hidden">
            {filtered.slice(0, 6).map((s) => (
              <button
                key={s}
                onMouseDown={() => addTag(s)}
                className="w-full text-left px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Personality card ──────────────────────────────────────────────────────────

function PersonalityCard({
  personality,
  isActive,
  onActivate,
  onEdit,
  onDelete,
}: {
  personality: Personality;
  isActive: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onActivate}
      className={`group relative cursor-pointer rounded-xl border p-3.5 transition-all ${
        isActive
          ? "border-blue-600/60 bg-blue-950/20 ring-1 ring-blue-600/30"
          : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none flex-shrink-0 mt-0.5">
          {personality.avatar}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-zinc-100 truncate">
              {personality.name}
            </span>
            {isActive && (
              <span className="px-1.5 py-0.5 bg-blue-600 text-white text-[10px] font-medium rounded-full leading-none flex-shrink-0">
                Active
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">
            {personality.description}
          </p>
          {personality.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {personality.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 text-[10px] rounded-md"
                >
                  {tag}
                </span>
              ))}
              {personality.tags.length > 3 && (
                <span className="px-1.5 py-0.5 text-zinc-600 text-[10px]">
                  +{personality.tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="p-1 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
          title="Edit"
        >
          <Pencil size={11} />
        </button>
        {!personality.isDefault && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors"
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Editor panel ──────────────────────────────────────────────────────────────

function EditorPanel({
  personality,
  onChange,
  onSave,
  onSaveAndActivate,
  onDuplicate,
}: {
  personality: Personality;
  onChange: (updates: Partial<Personality>) => void;
  onSave: () => void;
  onSaveAndActivate: () => void;
  onDuplicate: () => void;
}) {
  const { selectedModel, selectedProvider } = useStore();
  const [generating, setGenerating] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const handleGeneratePrompt = useCallback(async () => {
    if (!personality.name && !personality.description) {
      toast.error("Please enter a name and description first");
      return;
    }
    setGenerating(true);
    try {
      const prompt = await generatePersonalityPrompt({
        name: personality.name,
        description: personality.description,
        tags: personality.tags,
        provider: selectedProvider,
        model: selectedModel,
      });
      onChange({ systemPrompt: prompt });
      toast.success("System prompt generated!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [personality.name, personality.description, personality.tags, selectedModel, selectedProvider, onChange]);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(personality, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `personality-${personality.name.replace(/\s+/g, "-").toLowerCase() || "custom"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-5 space-y-5">
        {/* Basic info */}
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
            Basic Info
          </h3>
          <div className="space-y-3">
            {/* Avatar */}
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Avatar</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEmojiPickerOpen((v) => !v)}
                  className="text-3xl w-12 h-12 flex items-center justify-center bg-zinc-800 border border-zinc-700 rounded-xl hover:border-zinc-600 transition-colors"
                >
                  {personality.avatar}
                </button>
                <input
                  type="text"
                  value={personality.avatar}
                  onChange={(e) => onChange({ avatar: e.target.value })}
                  maxLength={4}
                  className="w-20 px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 text-center"
                  placeholder="Emoji"
                />
              </div>
              {emojiPickerOpen && (
                <div className="mt-2 p-2 bg-zinc-900 border border-zinc-700 rounded-xl">
                  <div className="grid grid-cols-10 gap-1">
                    {EMOJI_GRID.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => {
                          onChange({ avatar: emoji });
                          setEmojiPickerOpen(false);
                        }}
                        className="text-xl w-8 h-8 flex items-center justify-center hover:bg-zinc-800 rounded-lg transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Name */}
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Name</label>
              <input
                type="text"
                value={personality.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="e.g. Deep Researcher"
                className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Description</label>
              <input
                type="text"
                value={personality.description}
                onChange={(e) => onChange({ description: e.target.value })}
                placeholder="Brief description of this personality's style"
                className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Tags</label>
              <TagInput
                tags={personality.tags}
                onChange={(tags) => onChange({ tags })}
              />
            </div>
          </div>
        </div>

        {/* System prompt */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
              System Prompt
            </h3>
            <span className="text-[10px] text-zinc-600">
              {personality.systemPrompt.length} chars
            </span>
          </div>
          <textarea
            value={personality.systemPrompt}
            onChange={(e) => onChange({ systemPrompt: e.target.value })}
            placeholder="You are… (leave empty to use the default LocalMind system prompt)"
            rows={8}
            className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 resize-none leading-relaxed"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleGeneratePrompt}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-xs rounded-lg transition-colors border border-zinc-700"
            >
              {generating ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <span>✨</span>
              )}
              Generate from description
            </button>
            <button
              onClick={() => onChange({ systemPrompt: "" })}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded-lg transition-colors border border-zinc-700"
            >
              Reset to empty
            </button>
          </div>
        </div>

        {/* Actions */}
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
            Actions
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onSaveAndActivate}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors font-medium"
            >
              <Check size={13} />
              Save & Activate
            </button>
            <button
              onClick={onSave}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-lg transition-colors border border-zinc-700"
            >
              Save
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg transition-colors border border-zinc-700"
              title="Export as JSON"
            >
              <Download size={13} />
              Export JSON
            </button>
            <button
              onClick={onDuplicate}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg transition-colors border border-zinc-700"
              title="Duplicate this personality"
            >
              <Copy size={13} />
              Duplicate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PersonalitiesPage() {
  const {
    personalities,
    activePersonalityId,
    addPersonality,
    updatePersonality,
    deletePersonality,
    setActivePersonality,
  } = useStore();

  const [selectedId, setSelectedId] = useState<string | null>(
    activePersonalityId ?? personalities[0]?.id ?? null
  );
  const [editDraft, setEditDraft] = useState<Personality | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedPersonality = editDraft ?? personalities.find((p) => p.id === selectedId) ?? null;

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setEditDraft(null);
  };

  const handleEdit = (personality: Personality) => {
    setSelectedId(personality.id);
    setEditDraft({ ...personality });
  };

  const handleNewPersonality = () => {
    const blank = makeBlankPersonality();
    setEditDraft(blank);
    setSelectedId(blank.id);
  };

  const handleDraftChange = (updates: Partial<Personality>) => {
    setEditDraft((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  const handleSave = () => {
    if (!editDraft) return;
    const existing = personalities.find((p) => p.id === editDraft.id);
    if (existing) {
      updatePersonality(editDraft.id, editDraft);
    } else {
      addPersonality(editDraft);
    }
    setEditDraft(null);
    toast.success("Personality saved");
  };

  const handleSaveAndActivate = () => {
    if (!editDraft) return;
    const existing = personalities.find((p) => p.id === editDraft.id);
    if (existing) {
      updatePersonality(editDraft.id, editDraft);
    } else {
      addPersonality(editDraft);
    }
    setActivePersonality(editDraft.id);
    setEditDraft(null);
    toast.success(`"${editDraft.name}" is now active`);
  };

  const handleDelete = (id: string) => {
    const p = personalities.find((x) => x.id === id);
    if (!p || p.isDefault) return;
    deletePersonality(id);
    if (selectedId === id) {
      setSelectedId(personalities[0]?.id ?? null);
    }
    setEditDraft(null);
    toast.success("Personality deleted");
  };

  const handleDuplicate = () => {
    if (!selectedPersonality) return;
    const copy: Personality = {
      ...selectedPersonality,
      id: generateId(),
      name: `${selectedPersonality.name} (copy)`,
      isDefault: false,
      createdAt: new Date().toISOString(),
    };
    addPersonality(copy);
    setEditDraft(copy);
    setSelectedId(copy.id);
    toast.success("Personality duplicated");
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (!data.name || typeof data.name !== "string") {
          toast.error("Invalid personality file: missing name");
          return;
        }
        const imported: Personality = {
          id: generateId(),
          name: data.name,
          description: data.description ?? "",
          avatar: data.avatar ?? "🎯",
          systemPrompt: data.systemPrompt ?? "",
          tags: Array.isArray(data.tags) ? data.tags : [],
          isDefault: false,
          createdAt: new Date().toISOString(),
        };
        addPersonality(imported);
        setEditDraft(imported);
        setSelectedId(imported.id);
        toast.success(`Imported "${imported.name}"`);
      } catch {
        toast.error("Failed to parse JSON file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="flex h-full bg-[#0a0a0a]">
      {/* ── Left panel: personality list ── */}
      <div className="w-72 flex-shrink-0 border-r border-zinc-800/80 flex flex-col h-full">
        {/* Header */}
        <div className="px-4 pt-5 pb-3 border-b border-zinc-800/60">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-sm font-semibold text-zinc-100 tracking-tight">
              Personalities
            </h1>
            <div className="flex gap-1.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Import from JSON"
                className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <Upload size={13} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImport}
              />
              <button
                onClick={handleNewPersonality}
                title="New personality"
                className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors"
              >
                <Plus size={11} />
                New
              </button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 min-h-0">
          {personalities.map((p) => (
            <PersonalityCard
              key={p.id}
              personality={p}
              isActive={p.id === activePersonalityId}
              onActivate={() => {
                setActivePersonality(p.id);
                handleSelect(p.id);
                toast.success(`Switched to "${p.name}"`);
              }}
              onEdit={() => handleEdit(p)}
              onDelete={() => handleDelete(p.id)}
            />
          ))}
        </div>
      </div>

      {/* ── Right panel: editor ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {selectedPersonality ? (
          <>
            <div className="px-5 py-4 border-b border-zinc-800/60 flex items-center gap-3">
              <span className="text-2xl">{selectedPersonality.avatar}</span>
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">
                  {selectedPersonality.name || "New Personality"}
                </h2>
                <p className="text-xs text-zinc-500">
                  {editDraft ? "Editing…" : selectedPersonality.description}
                </p>
              </div>
              {editDraft && (
                <button
                  onClick={() => setEditDraft(null)}
                  className="ml-auto p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
                  title="Discard changes"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              <EditorPanel
                personality={editDraft ?? selectedPersonality}
                onChange={handleDraftChange}
                onSave={handleSave}
                onSaveAndActivate={handleSaveAndActivate}
                onDuplicate={handleDuplicate}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
            Select a personality or create a new one
          </div>
        )}
      </div>
    </div>
  );
}
