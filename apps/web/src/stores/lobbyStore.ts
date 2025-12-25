"use client";

import { create } from "zustand";

export interface LobbyMember {
  odId: string;
  odIdIndex?: string; // Alias for socket ID
  odIdIsSocket?: boolean;
  userId: string;
  username: string | null;
  name: string | null;
  image: string | null;
  inVoice: boolean;
}

export interface Lobby {
  id: string;
  name: string;
  ownerId: string;
  members: LobbyMember[];
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  odId: string;
  userId: string;
  username: string | null;
  name: string | null;
  image: string | null;
  content: string;
  timestamp: number;
}

export interface LobbyInvite {
  lobbyId: string;
  lobbyName: string;
  invitedBy: {
    userId: string;
    username: string | null;
    name: string | null;
    image: string | null;
  };
}

export interface OnlineFriend {
  odId: string;
  odIdIndex?: string;
  userId: string;
  username: string | null;
  name: string | null;
  image: string | null;
  lobbyId: string | null;
  lobbyName: string | null;
}

interface LobbyState {
  // Current lobby
  currentLobby: Lobby | null;
  messages: ChatMessage[];
  typingUsers: Map<string, string>; // odId -> username

  // Invites
  pendingInvites: LobbyInvite[];

  // Voice
  inVoice: boolean;
  voiceMembers: LobbyMember[];

  // Online friends
  onlineFriends: OnlineFriend[];

  // Actions
  setCurrentLobby: (lobby: Lobby | null) => void;
  updateMembers: (members: LobbyMember[]) => void;
  addMember: (member: LobbyMember) => void;
  removeMember: (odId: string) => void;
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  setTyping: (odId: string, username: string | null, isTyping: boolean) => void;
  addInvite: (invite: LobbyInvite) => void;
  removeInvite: (lobbyId: string) => void;
  setInVoice: (inVoice: boolean) => void;
  setVoiceMembers: (members: LobbyMember[]) => void;
  addVoiceMember: (member: LobbyMember) => void;
  removeVoiceMember: (odId: string) => void;
  setOnlineFriends: (friends: OnlineFriend[]) => void;
  updateOnlineFriend: (friend: OnlineFriend) => void;
  removeOnlineFriend: (odId: string) => void;
  reset: () => void;
}

export const useLobbyStore = create<LobbyState>((set, get) => ({
  currentLobby: null,
  messages: [],
  typingUsers: new Map(),
  pendingInvites: [],
  inVoice: false,
  voiceMembers: [],
  onlineFriends: [],

  setCurrentLobby: (lobby) => set({ currentLobby: lobby, messages: [], typingUsers: new Map() }),

  updateMembers: (members) => set((state) => ({
    currentLobby: state.currentLobby
      ? { ...state.currentLobby, members }
      : null,
  })),

  addMember: (member) => set((state) => ({
    currentLobby: state.currentLobby
      ? { ...state.currentLobby, members: [...state.currentLobby.members, member] }
      : null,
  })),

  removeMember: (odId) => set((state) => ({
    currentLobby: state.currentLobby
      ? { ...state.currentLobby, members: state.currentLobby.members.filter((m) => m.odId !== odId) }
      : null,
  })),

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message].slice(-100), // Keep last 100 messages
  })),

  clearMessages: () => set({ messages: [] }),

  setTyping: (odId, username, isTyping) => set((state) => {
    const newTypingUsers = new Map(state.typingUsers);
    if (isTyping && username) {
      newTypingUsers.set(odId, username);
    } else {
      newTypingUsers.delete(odId);
    }
    return { typingUsers: newTypingUsers };
  }),

  addInvite: (invite) => set((state) => {
    // Prevent duplicate invites from same lobby
    if (state.pendingInvites.some((i) => i.lobbyId === invite.lobbyId)) {
      return state;
    }
    return { pendingInvites: [...state.pendingInvites, invite] };
  }),

  removeInvite: (lobbyId) => set((state) => ({
    pendingInvites: state.pendingInvites.filter((i) => i.lobbyId !== lobbyId),
  })),

  setInVoice: (inVoice) => set({ inVoice }),

  setVoiceMembers: (members) => set({ voiceMembers: members }),

  addVoiceMember: (member) => set((state) => ({
    voiceMembers: [...state.voiceMembers, member],
  })),

  removeVoiceMember: (odId) => set((state) => ({
    voiceMembers: state.voiceMembers.filter((m) => m.odId !== odId),
  })),

  setOnlineFriends: (friends) => set({ onlineFriends: friends }),

  updateOnlineFriend: (friend) => set((state) => {
    const existing = state.onlineFriends.find((f) => f.userId === friend.userId);
    if (existing) {
      return {
        onlineFriends: state.onlineFriends.map((f) =>
          f.userId === friend.userId ? friend : f
        ),
      };
    }
    return { onlineFriends: [...state.onlineFriends, friend] };
  }),

  removeOnlineFriend: (odId) => set((state) => ({
    onlineFriends: state.onlineFriends.filter((f) => f.odId !== odId),
  })),

  reset: () => set({
    currentLobby: null,
    messages: [],
    typingUsers: new Map(),
    inVoice: false,
    voiceMembers: [],
  }),
}));
