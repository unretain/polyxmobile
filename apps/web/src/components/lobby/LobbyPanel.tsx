"use client";

// Mobile app: Lobby features removed - not available in wallet-only auth mode

interface LobbyPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LobbyPanel({ isOpen, onClose }: LobbyPanelProps) {
  // Social/lobby features are not available on mobile
  return null;
}
