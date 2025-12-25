"use client";

import { useState, useRef } from "react";
import { User, Camera, Loader2, Check, X } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import Image from "next/image";

interface ProfileData {
  id: string;
  email: string;
  name: string | null;
  username: string | null;
  bio: string | null;
  image: string | null;
  walletAddress: string | null;
}

interface ProfileFormProps {
  profile: ProfileData;
  onUpdate: (profile: ProfileData) => void;
  onImageUpdate: (image: string | null) => void;
}

export function ProfileForm({ profile, onUpdate, onImageUpdate }: ProfileFormProps) {
  const { isDark } = useThemeStore();
  const [name, setName] = useState(profile.name || "");
  const [username, setUsername] = useState(profile.username || "");
  const [bio, setBio] = useState(profile.bio || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, bio }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save profile");
      }

      onUpdate(data);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      setError("Image must be less than 5MB");
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      setError("Please upload a JPEG, PNG, WebP, or GIF image");
      return;
    }

    setUploadingImage(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/users/profile-picture", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to upload image");
      }

      onImageUpdate(data.image);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setUploadingImage(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveImage = async () => {
    setUploadingImage(true);
    setError(null);

    try {
      const res = await fetch("/api/users/profile-picture", {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to remove image");
      }

      onImageUpdate(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove image");
    } finally {
      setUploadingImage(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Profile Picture */}
      <div>
        <label
          className={`text-sm font-medium ${
            isDark ? "text-white/80" : "text-gray-700"
          }`}
        >
          Profile Picture
        </label>
        <div className="mt-2 flex items-center gap-4">
          <div className="relative">
            {profile.image ? (
              <Image
                src={profile.image}
                alt="Profile"
                width={80}
                height={80}
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center">
                <User className="h-10 w-10 text-white" />
              </div>
            )}
            {uploadingImage && (
              <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                <Loader2 className="h-6 w-6 text-white animate-spin" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isDark
                  ? "bg-white/10 hover:bg-white/20 text-white"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-900"
              }`}
            >
              <Camera className="h-4 w-4" />
              Change Photo
            </button>
            {profile.image && (
              <button
                onClick={handleRemoveImage}
                disabled={uploadingImage}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <X className="h-4 w-4" />
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleImageUpload}
            className="hidden"
          />
        </div>
      </div>

      {/* Name */}
      <div>
        <label
          className={`text-sm font-medium ${
            isDark ? "text-white/80" : "text-gray-700"
          }`}
        >
          Display Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your display name"
          className={`mt-1 w-full px-3 py-2 rounded-lg border outline-none focus:border-[#FF6B4A]/50 text-sm ${
            isDark
              ? "bg-white/5 text-white border-white/10 placeholder:text-white/30"
              : "bg-white text-gray-900 border-gray-200 placeholder:text-gray-400"
          }`}
        />
      </div>

      {/* Username */}
      <div>
        <label
          className={`text-sm font-medium ${
            isDark ? "text-white/80" : "text-gray-700"
          }`}
        >
          Username
        </label>
        <div className="relative mt-1">
          <span
            className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${
              isDark ? "text-white/40" : "text-gray-400"
            }`}
          >
            @
          </span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z]/g, ""))}
            placeholder="username"
            maxLength={9}
            className={`w-full pl-8 pr-3 py-2 rounded-lg border outline-none focus:border-[#FF6B4A]/50 text-sm ${
              isDark
                ? "bg-white/5 text-white border-white/10 placeholder:text-white/30"
                : "bg-white text-gray-900 border-gray-200 placeholder:text-gray-400"
            }`}
          />
        </div>
        <p
          className={`mt-1 text-xs ${
            isDark ? "text-white/40" : "text-gray-400"
          }`}
        >
          1-9 letters only
        </p>
      </div>

      {/* Bio */}
      <div>
        <label
          className={`text-sm font-medium ${
            isDark ? "text-white/80" : "text-gray-700"
          }`}
        >
          Bio
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Tell us about yourself..."
          rows={3}
          maxLength={160}
          className={`mt-1 w-full px-3 py-2 rounded-lg border outline-none focus:border-[#FF6B4A]/50 text-sm resize-none ${
            isDark
              ? "bg-white/5 text-white border-white/10 placeholder:text-white/30"
              : "bg-white text-gray-900 border-gray-200 placeholder:text-gray-400"
          }`}
        />
        <p
          className={`mt-1 text-xs ${
            isDark ? "text-white/40" : "text-gray-400"
          }`}
        >
          {bio.length}/160
        </p>
      </div>

      {/* Error/Success */}
      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 p-3 rounded-lg">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-green-400 bg-green-500/10 p-3 rounded-lg flex items-center gap-2">
          <Check className="h-4 w-4" />
          Profile saved successfully!
        </p>
      )}

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 ${
          saving
            ? isDark
              ? "bg-white/10 text-white/40 cursor-not-allowed"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
            : "bg-[#FF6B4A] text-white hover:bg-[#FF8F6B]"
        }`}
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : (
          "Save Changes"
        )}
      </button>
    </div>
  );
}
