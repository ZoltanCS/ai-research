"use client";

import { useState, useRef, useCallback, type ChangeEvent } from "react";
import {
  User,
  Mail,
  Lock,
  Camera,
  Save,
  Check,
  X,
  Shield,
  AlertCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/store";
import { updateProfile, changePassword } from "@/lib/api";

// ── Avatar picker ─────────────────────────────────────────────────────────────

const EMOJI_AVATARS = [
  "🧠", "🤖", "👾", "🦊", "🐉", "🦋", "🌊", "⚡", "🔥", "🌙",
  "🎭", "🎨", "🚀", "🎸", "🏆", "💎", "🌈", "🦄", "🐺", "🦅",
];

function AvatarDisplay({
  avatarData,
  displayName,
  username,
  size = "lg",
}: {
  avatarData: string | null;
  displayName: string | null;
  username: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    sm: "w-8 h-8 text-sm",
    md: "w-10 h-10 text-base",
    lg: "w-20 h-20 text-3xl",
  };

  if (avatarData?.startsWith("data:image")) {
    return (
      <img
        src={avatarData}
        alt="Avatar"
        className={`${sizeClasses[size]} rounded-full object-cover ring-2 ring-zinc-700`}
      />
    );
  }

  if (avatarData && EMOJI_AVATARS.includes(avatarData)) {
    return (
      <div
        className={`${sizeClasses[size]} rounded-full bg-zinc-800 ring-2 ring-zinc-700 flex items-center justify-center`}
      >
        {avatarData}
      </div>
    );
  }

  // Initials fallback
  const initials = (displayName || username)
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-blue-600 to-purple-600 ring-2 ring-zinc-700 flex items-center justify-center font-semibold text-white`}
    >
      {size === "sm" || size === "md" ? (
        <User size={size === "sm" ? 14 : 16} />
      ) : (
        initials
      )}
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-zinc-800">
        <Icon size={15} className="text-zinc-500" />
        <span className="text-sm font-semibold text-zinc-300">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Input field ────────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
  hint,
  maxLength,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
  maxLength?: number;
  multiline?: boolean;
}) {
  const [showPw, setShowPw] = useState(false);
  const isPw = type === "password";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-400">{label}</label>
        {maxLength && (
          <span className="text-[10px] text-zinc-600">
            {value.length}/{maxLength}
          </span>
        )}
      </div>
      <div className="relative">
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            maxLength={maxLength}
            rows={3}
            className="w-full resize-none px-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50 transition-colors"
          />
        ) : (
          <input
            type={isPw && showPw ? "text" : type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            maxLength={maxLength}
            className="w-full px-3 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50 transition-colors"
          />
        )}
        {isPw && (
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      {hint && <p className="text-[11px] text-zinc-600">{hint}</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { authUser, updateAuthUser } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile fields
  const [displayName, setDisplayName] = useState(authUser?.display_name ?? "");
  const [username, setUsername] = useState(authUser?.username ?? "");
  const [email, setEmail] = useState(authUser?.email ?? "");
  const [bio, setBio] = useState(authUser?.bio ?? "");
  const [avatarData, setAvatarData] = useState<string | null>(authUser?.avatar_data ?? null);
  const [profileSaving, setProfileSaving] = useState(false);

  // Password fields
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  // Avatar modal
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  // ── Avatar handlers ────────────────────────────────────────────────────────

  const handleFileAvatar = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarData(reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const handleEmojiAvatar = useCallback((emoji: string) => {
    setAvatarData(emoji);
    setEmojiPickerOpen(false);
  }, []);

  const clearAvatar = useCallback(() => {
    setAvatarData(null);
  }, []);

  // ── Save profile ───────────────────────────────────────────────────────────

  const saveProfile = useCallback(async () => {
    setProfileSaving(true);
    try {
      const updated = await updateProfile({
        display_name: displayName.trim() || null,
        username: username.trim() || undefined,
        email: email.trim() || undefined,
        bio: bio.trim() || null,
        avatar_data: avatarData,
      });
      updateAuthUser({
        display_name: updated.display_name,
        bio: updated.bio,
        avatar_data: updated.avatar_data,
        username: updated.username,
        email: updated.email,
      });
      toast.success("Profile saved");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  }, [displayName, username, email, bio, avatarData, updateAuthUser]);

  // ── Change password ────────────────────────────────────────────────────────

  const savePassword = useCallback(async () => {
    if (newPw !== confirmPw) {
      toast.error("New passwords don't match");
      return;
    }
    if (newPw.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setPwSaving(true);
    try {
      await changePassword(currentPw, newPw);
      toast.success("Password changed");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPwSaving(false);
    }
  }, [currentPw, newPw, confirmPw]);

  if (!authUser) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600">
        <AlertCircle size={16} className="mr-2" /> Not signed in
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#0a0a0a]">
      <div className="max-w-2xl mx-auto py-10 px-6 space-y-6">
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Profile</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Manage your account settings and preferences.
          </p>
        </div>

        {/* ── Avatar + identity section ──────────────────────────────────── */}
        <Section title="Identity" icon={User}>
          <div className="flex items-start gap-6">
            {/* Avatar */}
            <div className="flex flex-col items-center gap-2 flex-shrink-0">
              <div className="relative group">
                <AvatarDisplay
                  avatarData={avatarData}
                  displayName={displayName}
                  username={username}
                  size="lg"
                />
                <button
                  onClick={() => setEmojiPickerOpen(true)}
                  className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                  title="Change avatar"
                >
                  <Camera size={18} className="text-white" />
                </button>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-0.5 bg-zinc-800 rounded"
                >
                  Upload
                </button>
                <button
                  onClick={() => setEmojiPickerOpen(true)}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-0.5 bg-zinc-800 rounded"
                >
                  Emoji
                </button>
                {avatarData && (
                  <button
                    onClick={clearAvatar}
                    className="text-[10px] text-red-500 hover:text-red-400 transition-colors px-2 py-0.5 bg-zinc-800 rounded"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={handleFileAvatar}
              />
            </div>

            {/* Fields */}
            <div className="flex-1 space-y-3 min-w-0">
              <Field
                label="Display Name"
                value={displayName}
                onChange={setDisplayName}
                placeholder="How you appear to others"
                maxLength={100}
              />
              <Field
                label="Username"
                value={username}
                onChange={setUsername}
                placeholder="username"
                hint="Used for login. 3–50 characters."
              />
              <Field
                label="Bio"
                value={bio}
                onChange={setBio}
                placeholder="A short description about yourself…"
                multiline
                maxLength={500}
              />
            </div>
          </div>

          {/* Emoji picker */}
          {emojiPickerOpen && (
            <div className="mt-4 p-3 bg-zinc-950 border border-zinc-800 rounded-xl animate-in fade-in duration-150">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-500 font-medium">Choose an emoji avatar</span>
                <button
                  onClick={() => setEmojiPickerOpen(false)}
                  className="text-zinc-600 hover:text-zinc-300"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="grid grid-cols-10 gap-1">
                {EMOJI_AVATARS.map((em) => (
                  <button
                    key={em}
                    onClick={() => handleEmojiAvatar(em)}
                    className={`text-xl p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${
                      avatarData === em ? "bg-zinc-700 ring-1 ring-blue-500" : ""
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* ── Email section ──────────────────────────────────────────────── */}
        <Section title="Email Address" icon={Mail}>
          <Field
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            placeholder="you@example.com"
          />
          <p className="mt-2 text-[11px] text-zinc-600">
            Used for account recovery. Must be unique.
          </p>
        </Section>

        {/* ── Admin badge ────────────────────────────────────────────────── */}
        {authUser.is_admin && (
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-950/30 border border-amber-800/40 rounded-xl">
            <Shield size={14} className="text-amber-400" />
            <span className="text-xs text-amber-300 font-medium">
              You are an administrator
            </span>
          </div>
        )}

        {/* ── Save profile button ────────────────────────────────────────── */}
        <button
          onClick={saveProfile}
          disabled={profileSaving}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
        >
          {profileSaving ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save size={14} />
              Save Profile
            </>
          )}
        </button>

        {/* ── Password section ───────────────────────────────────────────── */}
        <Section title="Change Password" icon={Lock}>
          <div className="space-y-3">
            <Field
              label="Current Password"
              value={currentPw}
              onChange={setCurrentPw}
              type="password"
              placeholder="••••••••"
            />
            <Field
              label="New Password"
              value={newPw}
              onChange={setNewPw}
              type="password"
              placeholder="••••••••"
              hint="At least 8 characters."
            />
            <Field
              label="Confirm New Password"
              value={confirmPw}
              onChange={setConfirmPw}
              type="password"
              placeholder="••••••••"
            />
            {newPw && confirmPw && newPw !== confirmPw && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <X size={12} /> Passwords don't match
              </p>
            )}
            {newPw && confirmPw && newPw === confirmPw && newPw.length >= 8 && (
              <p className="text-xs text-emerald-400 flex items-center gap-1">
                <Check size={12} /> Passwords match
              </p>
            )}
          </div>
          <button
            onClick={savePassword}
            disabled={pwSaving || !currentPw || !newPw || !confirmPw || newPw !== confirmPw}
            className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 text-sm font-medium rounded-xl transition-colors"
          >
            {pwSaving ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />
                Changing…
              </>
            ) : (
              <>
                <Lock size={14} />
                Change Password
              </>
            )}
          </button>
        </Section>

        {/* ── Account info ───────────────────────────────────────────────── */}
        <div className="pb-6 text-[11px] text-zinc-700 text-center">
          Account ID: {authUser.id}
        </div>
      </div>
    </div>
  );
}
