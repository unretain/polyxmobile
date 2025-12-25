"use client";

import { useState, useEffect } from "react";
import { X, User, Users, UserPlus, Settings, Camera, Loader2 } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { ProfileForm } from "./ProfileForm";
import { FriendsList } from "./FriendsList";
import { AddFriendForm } from "./AddFriendForm";
import { FriendRequests } from "./FriendRequests";
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

interface ProfilePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "profile" | "friends";

export function ProfilePanel({ isOpen, onClose }: ProfilePanelProps) {
  const { isDark } = useThemeStore();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch profile on open
  useEffect(() => {
    if (isOpen) {
      fetchProfile();
    }
  }, [isOpen]);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/users/profile");
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      }
    } catch (error) {
      console.error("Failed to fetch profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleProfileUpdate = (updatedProfile: ProfileData) => {
    setProfile(updatedProfile);
  };

  const handleImageUpdate = (newImage: string | null) => {
    if (profile) {
      setProfile({ ...profile, image: newImage });
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed left-0 top-0 bottom-0 z-[70] w-full max-w-md border-r shadow-2xl transform transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        } ${
          isDark
            ? "bg-[#0f0f0f] border-white/10"
            : "bg-white border-gray-200"
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between p-4 border-b ${
            isDark ? "border-white/10" : "border-gray-200"
          }`}
        >
          <h2
            className={`text-lg font-bold ${
              isDark ? "text-white" : "text-gray-900"
            }`}
          >
            Profile
          </h2>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${
              isDark
                ? "hover:bg-white/10 text-white/60"
                : "hover:bg-gray-100 text-gray-600"
            }`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Profile Header */}
        {!loading && profile && (
          <div
            className={`p-4 border-b ${
              isDark ? "border-white/10" : "border-gray-200"
            }`}
          >
            <div className="flex items-center gap-4">
              {/* Profile Picture */}
              <div className="relative">
                {profile.image ? (
                  <Image
                    src={profile.image}
                    alt="Profile"
                    width={64}
                    height={64}
                    className="w-16 h-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF8F6B] flex items-center justify-center">
                    <User className="h-8 w-8 text-white" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={`font-semibold truncate ${
                    isDark ? "text-white" : "text-gray-900"
                  }`}
                >
                  {profile.name || profile.email}
                </p>
                {profile.username && (
                  <p
                    className={`text-sm ${
                      isDark ? "text-white/60" : "text-gray-600"
                    }`}
                  >
                    @{profile.username}
                  </p>
                )}
                {!profile.username && (
                  <p
                    className={`text-sm italic ${
                      isDark ? "text-white/40" : "text-gray-400"
                    }`}
                  >
                    No username set
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div
          className={`flex border-b ${
            isDark ? "border-white/10" : "border-gray-200"
          }`}
        >
          <button
            onClick={() => setActiveTab("profile")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "profile"
                ? isDark
                  ? "text-white border-b-2 border-[#FF6B4A]"
                  : "text-gray-900 border-b-2 border-[#FF6B4A]"
                : isDark
                ? "text-white/60 hover:text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Settings className="h-4 w-4" />
            Edit Profile
          </button>
          <button
            onClick={() => setActiveTab("friends")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "friends"
                ? isDark
                  ? "text-white border-b-2 border-[#FF6B4A]"
                  : "text-gray-900 border-b-2 border-[#FF6B4A]"
                : isDark
                ? "text-white/60 hover:text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Users className="h-4 w-4" />
            Friends
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4" style={{ height: "calc(100vh - 220px)" }}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2
                className={`h-8 w-8 animate-spin ${
                  isDark ? "text-white/40" : "text-gray-400"
                }`}
              />
            </div>
          ) : activeTab === "profile" && profile ? (
            <ProfileForm
              profile={profile}
              onUpdate={handleProfileUpdate}
              onImageUpdate={handleImageUpdate}
            />
          ) : activeTab === "friends" ? (
            <div className="space-y-6">
              <AddFriendForm />
              <FriendRequests />
              <FriendsList />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
